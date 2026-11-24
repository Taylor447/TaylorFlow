import { GAME_IDS, applyGameAction, filterRoomText, gameAlarmTime, makeGame, removeGamePlayer, updateGameClock, validGameTopic, visibleGame } from './arcade.js';

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const ROOM_TTL_MS = 2 * 60 * 60 * 1000;
const MAX_NAME = 32;
const MAX_PROMPTS = 8;
const MAX_ANSWER = 1600;
const MAX_NOTE = 240;
const MAX_CHAT_MESSAGE = 500;
// 550 KiB raw audio becomes about 734 KiB after base64 encoding.
const MAX_SOCKET_MESSAGE = 768 * 1024;
const MAX_COOP_AUDIO_BYTES = 550 * 1024;
const MAX_GAME_MESSAGE = 1600;
const GAME_ACTION_INTERVAL = 250;
const GAME_WINDOW_MS = 10_000;
const GAME_WINDOW_LIMIT = 30;
const CHAT_WINDOW_MS = 10_000;
const CHAT_WINDOW_LIMIT = 12;
const HOST_GRACE = 20_000;
const SIGNAL_WINDOW_MS = 10_000;
const SIGNAL_WINDOW_LIMIT = 80;
const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'X-Frame-Options': 'DENY',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  'Content-Security-Policy': "default-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  'Strict-Transport-Security': 'max-age=31536000'
};

const json = (body, status = 200, headers = {}) => new Response(JSON.stringify(body), {
  status,
  headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...SECURITY_HEADERS, ...headers }
});

function makeCode() {
  const bytes = new Uint8Array(7);
  crypto.getRandomValues(bytes);
  return [...bytes].map(value => CODE_CHARS[value % CODE_CHARS.length]).join('');
}

function makeSecret(byteCount = 24) {
  const bytes = new Uint8Array(byteCount);
  crypto.getRandomValues(bytes);
  return [...bytes].map(value => value.toString(16).padStart(2, '0')).join('');
}

async function digest(value) {
  const bytes = new TextEncoder().encode(value);
  const hash = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(hash)].map(value => value.toString(16).padStart(2, '0')).join('');
}

function cleanName(value) {
  return typeof value === 'string' ? filterRoomText(value.replace(/[<>\u0000-\u001f]/g, '').trim().slice(0, MAX_NAME)) : '';
}

function cleanChatMessage(value) {
  return typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, MAX_CHAT_MESSAGE) : '';
}

function cleanAudioDataUrl(value) {
  if (typeof value !== 'string') return null;
  const match = value.match(/^data:audio\/[a-z0-9.+-]+;base64,([a-z0-9+/]+={0,2})$/i);
  if (!match) return null;
  const encoded = match[1];
  const bytes = Math.floor(encoded.length * 3 / 4) - (encoded.endsWith('==') ? 2 : encoded.endsWith('=') ? 1 : 0);
  return bytes > 0 && bytes <= MAX_COOP_AUDIO_BYTES ? value : null;
}

function cleanCallSignal(value) {
  if (!value || typeof value !== 'object') return null;
  if (['offer', 'answer'].includes(value.kind) && value.description?.type === value.kind && typeof value.description.sdp === 'string' && value.description.sdp.length <= 16000) {
    return { kind: value.kind, description: { type: value.kind, sdp: value.description.sdp } };
  }
  if (value.kind === 'candidate' && value.candidate && typeof value.candidate.candidate === 'string' && value.candidate.candidate.length <= 2048) {
    return { kind: 'candidate', candidate: {
      candidate: value.candidate.candidate,
      sdpMid: typeof value.candidate.sdpMid === 'string' ? value.candidate.sdpMid.slice(0, 128) : null,
      sdpMLineIndex: Number.isInteger(value.candidate.sdpMLineIndex) ? value.candidate.sdpMLineIndex : null,
      usernameFragment: typeof value.candidate.usernameFragment === 'string' ? value.candidate.usernameFragment.slice(0, 128) : null
    } };
  }
  if (value.kind === 'restart-request') {
    return { kind: 'restart-request', reason: typeof value.reason === 'string' ? value.reason.slice(0, 100) : '' };
  }
  if (['hangup', 'reject'].includes(value.kind)) return { kind: value.kind };
  return null;
}

function cleanPrompts(value) {
  if (!Array.isArray(value) || value.length < 2 || value.length > MAX_PROMPTS) return null;
  const prompts = value.map(item => typeof item === 'string' ? item.trim().slice(0, 360) : '');
  return prompts.every(Boolean) ? prompts : null;
}

function publicState(state, onlineIds = new Set(), viewer = null) {
  const now = Date.now();
  return {
    code: state.code,
    mode: state.mode || 'speaking',
    game: visibleGame(state.game, viewer, now),
    hostId: state.hostId || state.players[0]?.id || null,
    gameOptions: state.mode === 'game' ? { id: state.gameId, topic: state.gameTopic, seconds: state.gameSeconds ?? null } : null,
    serverNow: now,
    part: state.part,
    topic: state.topic,
    prompts: state.prompts,
    phase: state.phase,
    turn: state.turn,
    currentAnswer: state.currentAnswer,
    answers: state.answers,
    chat: Array.isArray(state.chat) ? state.chat : [],
    createdAt: state.createdAt,
    expiresAt: state.expiresAt,
    players: state.players.map(player => ({ id: player.id, name: player.name, online: onlineIds.has(player.id) }))
  };
}

function sameOrigin(request, env) {
  const origin = request.headers.get('Origin');
  if (origin) return origin === env.ALLOWED_ORIGIN;
  return request.method !== 'POST' && request.headers.get('Upgrade')?.toLowerCase() !== 'websocket';
}

async function isRateLimited(binding, request, bucket) {
  if (!binding || typeof binding.limit !== 'function') throw new Error('Rate-limit binding is missing');
  const source = request.headers.get('CF-Connecting-IP') || 'unknown';
  // Keep raw client IPs out of the rate-limit key store.
  const key = await digest(`taylorflow:${bucket}:${source}`);
  const result = await binding.limit({ key });
  return !result?.success;
}

async function readBoundedJson(request, maxBytes) {
  const contentType = (request.headers.get('Content-Type') || '').split(';', 1)[0].trim().toLowerCase();
  if (contentType !== 'application/json') return { ok: false, status: 415, error: 'Hãy gửi dữ liệu JSON hợp lệ.' };
  const declared = request.headers.get('Content-Length');
  if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > maxBytes)) {
    return { ok: false, status: Number(declared) > maxBytes ? 413 : 400, error: 'Dữ liệu gửi lên không hợp lệ hoặc quá lớn.' };
  }
  if (!request.body) return { ok: false, status: 400, error: 'Dữ liệu gửi lên không hợp lệ.' };
  const reader = request.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => {});
        return { ok: false, status: 413, error: 'Dữ liệu gửi lên vượt quá giới hạn.' };
      }
      chunks.push(value);
    }
  } catch {
    return { ok: false, status: 400, error: 'Không đọc được dữ liệu gửi lên.' };
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  try { return { ok: true, value: JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) }; }
  catch { return { ok: false, status: 400, error: 'Dữ liệu JSON không hợp lệ.' }; }
}

function rateLimitedResponse(request, env) {
  return withCors(request, json({ error: 'Bạn thao tác hơi nhanh. Hãy đợi một chút rồi thử lại.' }, 429, { 'Retry-After': '10' }), env);
}

function withCors(request, response, env) {
  const origin = request.headers.get('Origin');
  if (!origin) return response;
  const headers = new Headers(response.headers);
  headers.set('Access-Control-Allow-Origin', env.ALLOWED_ORIGIN);
  headers.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  headers.set('Access-Control-Allow-Headers', 'Content-Type');
  headers.set('Access-Control-Max-Age', '86400');
  headers.append('Vary', 'Origin');
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

async function callRoom(env, code, path, body = null) {
  const id = env.COOP_ROOMS.idFromName(code);
  const stub = env.COOP_ROOMS.get(id);
  return stub.fetch('https://coop.internal' + path, {
    method: body ? 'POST' : 'GET',
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined
  });
}

export default {
  async fetch(request, env) {
    if (!sameOrigin(request, env)) return json({ error: 'Nguồn truy cập không được phép.' }, 403);
    if (request.method === 'OPTIONS') {
      return withCors(request, new Response(null, { status: 204 }), env);
    }

    const url = new URL(request.url);
    if (request.method === 'GET' && url.pathname === '/health') {
      return withCors(request, json({ ok: true, service: 'epu-speaking-coop', games: GAME_IDS, turnConfigured: Boolean(env.TURN_KEY_ID && env.TURN_API_TOKEN) }), env);
    }

    if (request.method === 'POST' && url.pathname === '/api/rooms') {
      try { if (await isRateLimited(env.RL_ROOM_CREATE, request, 'room-create')) return rateLimitedResponse(request, env); }
      catch { return withCors(request, json({ error: 'Dịch vụ đang bận. Hãy thử lại sau.' }, 503), env); }
      const parsed = await readBoundedJson(request, 8 * 1024);
      if (!parsed.ok) return withCors(request, json({ error: parsed.error }, parsed.status), env);
      const input = parsed.value;
      const name = cleanName(input?.displayName);
      const prompts = cleanPrompts(input?.prompts);
      const part = Number(input?.part);
      const topic = typeof input?.topic === 'string' ? input.topic.trim().slice(0, 80) : '';
      const mode = input?.mode ?? 'speaking';
      const gameId = input?.gameId, gameTopic = input?.gameTopic;
      const gameSeconds = input?.gameSeconds == null ? null : Number(input.gameSeconds);
      const validSeconds = gameSeconds === null || Number.isInteger(gameSeconds) && gameSeconds >= 5 && gameSeconds <= 60;
      const validMode = mode === 'game' ? GAME_IDS.includes(gameId) && (gameId !== 'letter-link' || validGameTopic(gameTopic)) && validSeconds
        : mode === 'speaking' && prompts && [1, 2, 3].includes(part) && topic;
      if (!name || !validMode) {
        return withCors(request, json({ error: 'Hãy nhập tên, chủ đề và câu hỏi hợp lệ.' }, 400), env);
      }
      for (let attempt = 0; attempt < 4; attempt++) {
        const code = makeCode();
        const id = makeSecret(8);
        const token = makeSecret();
        const config = mode === 'game' ? { mode, gameId, gameTopic: validGameTopic(gameTopic) ? gameTopic : 'Hometown', gameSeconds, prompts: [] }
          : { mode, part, topic, prompts };
        const result = await callRoom(env, code, '/create', { code, ...config, host: { id, token, name } });
        if (result.status === 409) continue;
        const payload = await result.json().catch(() => ({ error: 'Backend chưa tạo được phòng.' }));
        if (!result.ok) return withCors(request, json(payload, result.status), env);
        return withCors(request, json({ ...payload, playerId: id, playerToken: token, roomCode: code }), env);
      }
      return withCors(request, json({ error: 'Chưa tạo được mã phòng. Hãy thử lại.' }, 503), env);
    }

    const joinMatch = url.pathname.match(/^\/api\/rooms\/([A-HJ-NP-Z2-9]{7})\/join$/i);
    if (request.method === 'POST' && joinMatch) {
      try { if (await isRateLimited(env.RL_ROOM_JOIN, request, 'room-join')) return rateLimitedResponse(request, env); }
      catch { return withCors(request, json({ error: 'Dịch vụ đang bận. Hãy thử lại sau.' }, 503), env); }
      const parsed = await readBoundedJson(request, 2 * 1024);
      if (!parsed.ok) return withCors(request, json({ error: parsed.error }, parsed.status), env);
      const input = parsed.value;
      const name = cleanName(input?.displayName);
      if (!name) return withCors(request, json({ error: 'Hãy nhập tên hiển thị.' }, 400), env);
      if (input?.mode !== undefined && !['speaking', 'game'].includes(input.mode)) return withCors(request, json({ error: 'Chế độ phòng không hợp lệ.' }, 400), env);
      const id = makeSecret(8);
      const token = makeSecret();
      const result = await callRoom(env, joinMatch[1].toUpperCase(), '/join', { id, token, name, mode: input?.mode });
      return withCors(request, new Response(result.body, { status: result.status, headers: result.headers }), env);
    }

    const iceMatch = url.pathname.match(/^\/api\/rooms\/([A-HJ-NP-Z2-9]{7})\/ice-servers$/i);
    if (request.method === 'POST' && iceMatch) {
      try { if (await isRateLimited(env.RL_TURN, request, 'turn-credentials')) return rateLimitedResponse(request, env); }
      catch { return withCors(request, json({ error: 'Dịch vụ đang bận. Hãy thử lại sau.' }, 503), env); }
      const fallback = [{ urls: 'stun:stun.cloudflare.com:3478' }, { urls: 'stun:stun.l.google.com:19302' }];
      if (!env.TURN_KEY_ID || !env.TURN_API_TOKEN) {
        return withCors(request, json({ turnAvailable: false, iceServers: fallback }), env);
      }
      const parsed = await readBoundedJson(request, 2 * 1024);
      if (!parsed.ok) return withCors(request, json({ error: parsed.error }, parsed.status), env);
      const input = parsed.value;
      const playerId = typeof input?.playerId === 'string' ? input.playerId : '';
      const playerToken = typeof input?.playerToken === 'string' ? input.playerToken : '';
      if (!playerId || !playerToken) return withCors(request, json({ error: 'Phiên phòng đã hết. Hãy vào lại phòng coop.' }, 401), env);
      const auth = await callRoom(env, iceMatch[1].toUpperCase(), '/authorize-turn', { playerId, playerToken });
      if (!auth.ok) {
        const payload = await auth.json().catch(() => ({ error: 'Phiên phòng không hợp lệ.' }));
        return withCors(request, json(payload, auth.status), env);
      }
      try {
        const turnResponse = await fetch(`https://rtc.live.cloudflare.com/v1/turn/keys/${encodeURIComponent(env.TURN_KEY_ID)}/credentials/generate-ice-servers`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${env.TURN_API_TOKEN}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ ttl: 3600 })
        });
        if (!turnResponse.ok) throw new Error('TURN credential request failed');
        const payload = await turnResponse.json();
        const iceServers = Array.isArray(payload?.iceServers) ? payload.iceServers.filter(server => {
          const urls = Array.isArray(server?.urls) ? server.urls : [server?.urls];
          return urls.some(value => typeof value === 'string' && /^(stun|stuns|turn|turns):/i.test(value));
        }) : [];
        const turnAvailable = iceServers.some(server => (Array.isArray(server.urls) ? server.urls : [server.urls]).some(value => typeof value === 'string' && /^turns?:/i.test(value)));
        if (!turnAvailable) throw new Error('TURN servers missing from response');
        return withCors(request, json({ turnAvailable: true, iceServers }), env);
      } catch {
        return withCors(request, json({ turnAvailable: false, iceServers: fallback, warning: 'TURN chưa sẵn sàng; đang thử kết nối trực tiếp.' }), env);
      }
    }

    const socketMatch = url.pathname.match(/^\/api\/rooms\/([A-HJ-NP-Z2-9]{7})\/socket$/i);
    if (request.method === 'GET' && socketMatch && request.headers.get('Upgrade')?.toLowerCase() === 'websocket') {
      try { if (await isRateLimited(env.RL_SOCKET, request, 'socket-connect')) return rateLimitedResponse(request, env); }
      catch { return withCors(request, json({ error: 'Dịch vụ đang bận. Hãy thử lại sau.' }, 503), env); }
      // Forward the original request so Cloudflare preserves the WebSocket upgrade.
      const id = env.COOP_ROOMS.idFromName(socketMatch[1].toUpperCase());
      return env.COOP_ROOMS.get(id).fetch(request);
    }

    return withCors(request, json({ error: 'Không tìm thấy đường dẫn coop.' }, 404), env);
  }
};

export class CoopRoom {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
    this.pending = Promise.resolve();
  }

  // Serialize changes that cross awaits so a join, alarm, and socket action cannot overwrite one another.
  enqueue(operation) {
    const result = this.pending.then(operation);
    this.pending = result.catch(() => {});
    return result;
  }

  async fetch(request) {
    const url = new URL(request.url);
    if (request.method === 'POST' && url.pathname === '/create') return this.enqueue(() => this.create(request));
    if (request.method === 'POST' && url.pathname === '/join') return this.enqueue(() => this.join(request));
    if (request.method === 'POST' && url.pathname === '/authorize-turn') return this.enqueue(() => this.authorizeTurn(request));
    if (request.method === 'GET' && (url.pathname === '/socket' || /^\/api\/rooms\/[A-HJ-NP-Z2-9]{7}\/socket$/i.test(url.pathname))) return this.enqueue(() => this.connect(request));
    return json({ error: 'Không tìm thấy phòng.' }, 404);
  }

  async readState() {
    return this.ctx.storage.get('room');
  }

  async create(request) {
    const input = await request.json();
    if (await this.readState()) return json({ error: 'Mã phòng đã tồn tại.' }, 409);
    const now = Date.now();
    const state = {
      code: input.code,
      mode: input.mode || 'speaking',
      hostId: input.host.id,
      game: null,
      gameId: input.gameId ?? null,
      gameTopic: input.gameTopic ?? null,
      gameSeconds: input.gameSeconds ?? null,
      part: input.part ?? null,
      topic: input.topic ?? '',
      prompts: input.prompts,
      phase: 'waiting',
      turn: 0,
      currentAnswer: null,
      answers: [],
      chat: [],
      chatLastSentAt: {},
      players: [{ id: input.host.id, tokenHash: await digest(input.host.token), name: input.host.name }],
      createdAt: now,
      updatedAt: now,
      expiresAt: now + ROOM_TTL_MS
    };
    await this.ctx.storage.put('room', state);
    await this.ctx.storage.setAlarm(state.expiresAt);
    return json({ state: publicState(state) });
  }

  async join(request) {
    const input = await request.json();
    const state = await this.readState();
    if (!state || state.expiresAt <= Date.now()) return json({ error: 'Không tìm thấy phòng hoặc phòng đã hết hạn.' }, 404);
    const roomMode = state.mode || 'speaking';
    if (input.mode && input.mode !== roomMode) return json({ error: roomMode === 'game' ? 'Mã này thuộc phòng trò chơi. Hãy mở một trò rồi chọn “Chơi cùng bạn”.' : 'Mã này thuộc phòng luyện Speaking, không phải phòng trò chơi.' }, 409);
    if (state.players.some(player => player.id === input.id)) return json({ error: 'Bạn đã ở trong phòng.' }, 409);
    const isGame = roomMode === 'game';
    if (isGame && state.game?.turn) return json({ error: 'Ván đang diễn ra. Hãy chờ ván sau để tham gia.' }, 409);
    if (state.players.length >= (isGame ? 4 : 2)) return json({ error: isGame ? 'Phòng đã đủ bốn người.' : 'Phòng đã đủ hai người.' }, 409);
    state.players.push({ id: input.id, tokenHash: await digest(input.token), name: input.name });
    if (!isGame) state.phase = 'answer';
    state.updatedAt = Date.now();
    await this.ctx.storage.put('room', state);
    await this.broadcast(state);
    return json({ state: publicState(state), playerId: input.id, playerToken: input.token, roomCode: state.code });
  }

  async authorizeTurn(request) {
    const input = await request.json().catch(() => ({}));
    const state = await this.readState();
    if (!state || state.expiresAt <= Date.now()) return json({ error: 'Phòng đã hết hạn.' }, 410);
    const player = state.players.find(item => item.id === input.playerId);
    if (!player || !input.playerToken || player.tokenHash !== await digest(input.playerToken)) return json({ error: 'Phiên phòng không hợp lệ.' }, 403);
    const now = Date.now();
    if (player.turnIssuedAt && now - player.turnIssuedAt < 15000) return json({ error: 'Hãy đợi một chút trước khi thử lại đường truyền.' }, 429);
    player.turnIssuedAt = now;
    await this.ctx.storage.put('room', state);
    return json({ ok: true });
  }

  async connect(request) {
    if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') return json({ error: 'Cần kết nối WebSocket.' }, 426);
    const url = new URL(request.url);
    if (url.search || url.searchParams.has('playerId') || url.searchParams.has('token')) {
      return json({ error: 'Thông tin phiên không được gửi trong địa chỉ kết nối. Hãy tải lại ứng dụng.' }, 400);
    }
    const state = await this.readState();
    if (!state || state.expiresAt <= Date.now()) return json({ error: 'Phòng đã hết hạn.' }, 410);
    const unauthenticated = this.ctx.getWebSockets().filter(socket => !socket.deserializeAttachment()?.playerId);
    if (unauthenticated.length >= 4) return json({ error: 'Phòng đang bận. Hãy thử kết nối lại sau.' }, 429);

    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ connectedAt: Date.now() });
    return new Response(null, { status: 101, webSocket: client });
  }

  webSocketMessage(socket, message) {
    return this.enqueue(() => this.handleSocketMessage(socket, message));
  }

  async handleSocketMessage(socket, message) {
    const attachment = socket.deserializeAttachment();
    const incomingBytes = typeof message === 'string' ? new TextEncoder().encode(message).byteLength : message?.byteLength;
    if (!Number.isSafeInteger(incomingBytes) || incomingBytes > MAX_SOCKET_MESSAGE) {
      socket.send(JSON.stringify({ type: 'error', error: 'Tin nhắn vượt quá giới hạn.' }));
      try { socket.close(1009, 'Message too large'); } catch {}
      return;
    }
    let raw;
    try { raw = typeof message === 'string' ? message : new TextDecoder('utf-8', { fatal: true }).decode(message); }
    catch {
      socket.send(JSON.stringify({ type: 'error', error: 'Tin nhắn không hợp lệ.' }));
      try { socket.close(1007, 'Invalid text message'); } catch {}
      return;
    }
    let input;
    try { input = JSON.parse(raw); }
    catch { socket.send(JSON.stringify({ type: 'error', error: 'Tin nhắn không hợp lệ.' })); return; }

    const state = await this.readState();
    if (!state || state.expiresAt <= Date.now()) {
      socket.send(JSON.stringify({ type: 'expired', message: 'Phòng đã hết hạn.' }));
      return;
    }
    if (!attachment?.playerId) {
      if (input?.type !== 'auth' || raw.length > 4096) {
        socket.send(JSON.stringify({ type: 'error', error: 'Phiên kết nối không hợp lệ.' }));
        try { socket.close(4003, 'Authentication required'); } catch {}
        return;
      }
      const playerId = typeof input.playerId === 'string' && /^[a-f0-9]{16}$/.test(input.playerId) ? input.playerId : '';
      const token = typeof input.token === 'string' && /^[a-f0-9]{48}$/.test(input.token) ? input.token : '';
      const player = state.players.find(item => item.id === playerId);
      if (!player || !token || player.tokenHash !== await digest(token)) {
        socket.send(JSON.stringify({ type: 'error', error: 'Phiên phòng không hợp lệ.' }));
        try { socket.close(4003, 'Invalid session'); } catch {}
        return;
      }
      for (const oldSocket of this.ctx.getWebSockets()) {
        if (oldSocket !== socket && oldSocket.deserializeAttachment()?.playerId === playerId) {
          try { oldSocket.close(4001, 'Reconnected from another tab'); } catch {}
        }
      }
      socket.serializeAttachment({ playerId, connectedAt: attachment.connectedAt || Date.now(), signalWindowAt: 0, signalCount: 0 });
      if (state.mode === 'game') await this.refreshGameRoom(state);
      socket.send(JSON.stringify({ type: 'authenticated', state: publicState(state, this.onlineIds(), playerId) }));
      await this.broadcast(state);
      return;
    }
    const playerId = attachment.playerId;
    if (!state.players.some(player => player.id === playerId)) {
      socket.send(JSON.stringify({ type: 'error', error: 'Bạn không còn trong phòng.' }));
      return;
    }
    if (socket.readyState !== 1) return;
    if (input?.type === 'game') {
      if (raw.length > MAX_GAME_MESSAGE) {
        this.socketError(socket, 'Thao tác trò chơi vượt quá giới hạn.');
        return;
      }
      return this.handleGameMessage(state, socket, playerId, input);
    }
    if (state.mode === 'game' && input?.type !== 'chat') {
      this.socketError(socket, 'Thao tác này chỉ dùng trong phòng luyện nói.');
      return;
    }

    let outgoingAudio = null;
    if (input?.type === 'signal') {
      const now = Date.now();
      const signalWindowAt = Number(attachment.signalWindowAt) || 0;
      const signalCount = now - signalWindowAt >= SIGNAL_WINDOW_MS ? 0 : Number(attachment.signalCount) || 0;
      if (signalCount >= SIGNAL_WINDOW_LIMIT) {
        this.socketError(socket, 'Đường truyền gửi quá nhiều tín hiệu. Hãy đợi một chút.');
        return;
      }
      socket.serializeAttachment({ ...attachment, signalWindowAt: signalCount ? signalWindowAt : now, signalCount: signalCount + 1 });
      const targetId = typeof input.targetPlayerId === 'string' ? input.targetPlayerId : '';
      const signal = cleanCallSignal(input.signal);
      if (!targetId || targetId === playerId || !state.players.some(player => player.id === targetId) || !signal) {
        socket.send(JSON.stringify({ type: 'error', error: 'Tín hiệu cuộc gọi không hợp lệ.' }));
        return;
      }
      const payload = JSON.stringify({ type: 'signal', from: playerId, signal });
      let delivered = false;
      for (const peerSocket of this.ctx.getWebSockets()) {
        if (peerSocket.deserializeAttachment()?.playerId !== targetId || peerSocket.readyState !== 1) continue;
        try { peerSocket.send(payload); delivered = true; } catch {}
      }
      if (!delivered) socket.send(JSON.stringify({ type: 'error', error: 'Bạn học chưa kết nối. Hãy đợi bạn ấy vào phòng rồi thử gọi lại.' }));
      return;
    } else if (input?.type === 'chat') {
      if (typeof input.text !== 'string' || input.text.length > MAX_CHAT_MESSAGE) {
        this.socketError(socket, 'Tin nhắn tối đa 500 ký tự.');
        return;
      }
      const text = filterRoomText(cleanChatMessage(input.text));
      const now = Date.now();
      state.chat ||= [];
      state.chatLastSentAt ||= {};
      if (!text) {
        socket.send(JSON.stringify({ type: 'error', error: 'Hãy nhập tin nhắn trước khi gửi.' }));
        return;
      }
      const chatWindowAt = Number(attachment.chatWindowAt) || 0;
      const chatCount = now - chatWindowAt >= CHAT_WINDOW_MS ? 0 : Number(attachment.chatCount) || 0;
      if (chatCount >= CHAT_WINDOW_LIMIT) {
        this.socketError(socket, 'Bạn gửi tin nhắn hơi nhanh. Hãy chờ một chút rồi gửi tiếp.');
        return;
      }
      if (now - Number(state.chatLastSentAt[playerId] || 0) < 600) {
        socket.send(JSON.stringify({ type: 'error', error: 'Bạn gửi hơi nhanh. Hãy chờ một chút rồi gửi tiếp.' }));
        return;
      }
      socket.serializeAttachment({ ...attachment, chatWindowAt: chatCount ? chatWindowAt : now, chatCount: chatCount + 1 });
      state.chatLastSentAt[playerId] = now;
      state.chat.push({ playerId, text, sentAt: now });
      if (state.chat.length > 50) state.chat.splice(0, state.chat.length - 50);
      state.updatedAt = now;
      await this.ctx.storage.put('room', state);
      await this.broadcast(state);
      return;
    } else if (input?.type === 'answer') {
      const active = state.players[state.turn % 2];
      const answer = typeof input.answer === 'string' ? input.answer.trim().slice(0, MAX_ANSWER) : '';
      if (input.audio != null) {
        outgoingAudio = cleanAudioDataUrl(input.audio);
        if (!outgoingAudio) {
          socket.send(JSON.stringify({ type: 'error', error: 'Bản ghi không hợp lệ hoặc quá lớn. Hãy thu ngắn hơn rồi gửi lại.' }));
          return;
        }
      }
      if (state.phase !== 'answer' || active?.id !== playerId || answer.length < 10) {
        socket.send(JSON.stringify({ type: 'error', error: 'Chưa đến lượt bạn hoặc câu trả lời quá ngắn.' }));
        return;
      }
      state.currentAnswer = { playerId, text: filterRoomText(answer), question: state.prompts[state.turn], submittedAt: Date.now() };
      state.phase = 'review';
    } else if (input?.type === 'review') {
      const reviewer = state.players[(state.turn + 1) % 2];
      const current = state.currentAnswer;
      const checks = input.checks && typeof input.checks === 'object' ? input.checks : {};
      if (state.phase !== 'review' || reviewer?.id !== playerId || !current || ![current.playerId, reviewer.id].includes(playerId)) {
        socket.send(JSON.stringify({ type: 'error', error: 'Bạn chưa thể gửi góp ý cho lượt này.' }));
        return;
      }
      current.review = {
        by: reviewer.id,
        onTopic: checks.onTopic === true,
        reasonExample: checks.reasonExample === true,
        clear: checks.clear === true,
        note: typeof input.note === 'string' ? filterRoomText(input.note.replace(/[<>\u0000-\u001f]/g, '').trim().slice(0, MAX_NOTE)) : '',
        submittedAt: Date.now()
      };
      state.answers.push(current);
      state.currentAnswer = null;
      state.turn++;
      state.phase = state.turn >= state.prompts.length ? 'complete' : 'answer';
    } else {
      socket.send(JSON.stringify({ type: 'error', error: 'Thao tác không được hỗ trợ.' }));
      return;
    }

    state.updatedAt = Date.now();
    await this.ctx.storage.put('room', state);
    await this.broadcast(state);
    if (outgoingAudio) await this.broadcastAudio(state.turn, playerId, outgoingAudio);
  }

  socketError(socket, error) {
    socket.send(JSON.stringify({ type: 'error', error }));
  }

  onlineIds(excluded = null) {
    return new Set(this.ctx.getWebSockets().filter(socket => socket !== excluded && socket.readyState === 1)
      .map(socket => socket.deserializeAttachment()?.playerId).filter(Boolean));
  }

  async saveGameRoom(state) {
    state.updatedAt = Date.now();
    await this.ctx.storage.put('room', state);
    await this.ctx.storage.setAlarm(Math.min(state.expiresAt, state.hostAwayUntil || Infinity, gameAlarmTime(state.game)));
  }

  async refreshGameRoom(state, online = this.onlineIds()) {
    const now = Date.now(), hostOnline = online.has(state.hostId);
    const replacement = state.players.find(player => online.has(player.id) && player.id !== state.hostId);
    let changed = updateGameClock(state.game, online, now);
    if (hostOnline || !replacement) {
      if (state.hostAwayUntil) { state.hostAwayUntil = null; changed = true; }
    } else if (!state.hostAwayUntil) {
      state.hostAwayUntil = now + HOST_GRACE;
      changed = true;
    } else if (state.hostAwayUntil <= now) {
      state.hostId = replacement.id;
      state.hostAwayUntil = null;
      changed = true;
    }
    if (state.game) state.phase = state.game.turn ? 'playing' : 'complete';
    if (changed) await this.saveGameRoom(state);
    return changed;
  }

  async handleGameMessage(state, socket, playerId, input) {
    if (state.mode !== 'game') return this.socketError(socket, 'Đây là phòng luyện nói. Hãy tạo phòng trò chơi riêng.');
    const now = Date.now(), online = this.onlineIds();
    const session = socket.deserializeAttachment();
    if (now - (session.gameActionAt || 0) < GAME_ACTION_INTERVAL) {
      return this.socketError(socket, 'Bạn gửi hơi nhanh. Hãy thử lại sau một nhịp.');
    }
    const gameWindowAt = Number(session.gameWindowAt) || 0;
    const gameCount = now - gameWindowAt >= GAME_WINDOW_MS ? 0 : Number(session.gameWindowCount) || 0;
    if (gameCount >= GAME_WINDOW_LIMIT) return this.socketError(socket, 'Bạn thao tác trò chơi hơi nhanh. Hãy chờ một chút rồi thử lại.');
    socket.serializeAttachment({ ...session, gameActionAt: now, gameWindowAt: gameCount ? gameWindowAt : now, gameWindowCount: gameCount + 1 });
    const changed = await this.refreshGameRoom(state, online);
    const reject = async error => {
      if (changed) await this.broadcast(state);
      this.socketError(socket, error);
    };
    const payload = input.payload;
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return reject('Dữ liệu trò chơi không hợp lệ.');
    const allowedKeys = {
      leave: [], start: ['id', 'topic'], hint: ['runId', 'step'], skip: ['runId', 'step'], submit: ['runId', 'step', 'text']
    };
    if (!Object.hasOwn(allowedKeys, input.action) || Object.keys(payload).some(key => !allowedKeys[input.action].includes(key))) {
      return reject('Thao tác trò chơi không hợp lệ.');
    }
    if (input.action === 'leave') {
      removeGamePlayer(state.game, playerId, now);
      state.players = state.players.filter(player => player.id !== playerId);
      delete state.chatLastSentAt?.[playerId];
      if (state.hostId === playerId) {
        state.hostId = state.players.find(player => online.has(player.id))?.id || state.players[0]?.id || null;
        state.hostAwayUntil = null;
      }
      state.phase = state.game ? (state.game.turn ? 'playing' : 'complete') : 'waiting';
      await this.refreshGameRoom(state);
      await this.saveGameRoom(state);
      await this.broadcast(state);
      // Acknowledge on the existing connection before closing it.
      socket.send(JSON.stringify({ type: 'state', state: publicState(state, online, playerId) }));
      socket.close(1000, 'Left room');
      return;
    }
    if (input.action === 'start') {
      if (state.hostId !== playerId || state.game?.turn) return reject('Chỉ chủ phòng có thể mở ván mới khi ván cũ đã kết thúc.');
      const players = state.players.filter(player => online.has(player.id));
      if (players.length < 2) return reject('Cần ít nhất hai người đang kết nối.');
      const id = payload.id ?? state.gameId;
      const topic = payload.topic ?? state.gameTopic;
      if (!GAME_IDS.includes(id) || (id === 'letter-link' && !validGameTopic(topic))) return reject('Trò hoặc chủ đề chưa hợp lệ.');
      state.gameId = id;
      state.gameTopic = validGameTopic(topic) ? topic : 'Hometown';
      const seconds = payload.seconds ?? state.gameSeconds;
      if (seconds != null && (!Number.isInteger(seconds) || seconds < 5 || seconds > 60)) return reject('Thời gian mỗi lượt phải từ 5 đến 60 giây.');
      if (seconds != null) state.gameSeconds = seconds;
      state.game = makeGame(id, state.gameTopic, 'arcade_' + makeSecret(12), players, now, state.gameSeconds);
    } else {
      if (!state.game) return reject('Chủ phòng chưa bắt đầu ván.');
      const error = applyGameAction(state.game, playerId, input.action, payload, now);
      if (error) return reject(error);
    }
    state.phase = state.game.turn ? 'playing' : 'complete';
    await this.refreshGameRoom(state);
    await this.saveGameRoom(state);
    await this.broadcast(state);
  }

  async broadcast(state, online = this.onlineIds()) {
    for (const socket of this.ctx.getWebSockets()) {
      const viewer = socket.deserializeAttachment()?.playerId;
      if (!state.players.some(player => player.id === viewer) || socket.readyState !== 1) continue;
      try { socket.send(JSON.stringify({ type: 'state', state: publicState(state, online, viewer) })); } catch {}
    }
  }

  async broadcastAudio(turn, senderId, audio) {
    const payload = JSON.stringify({ type: 'audio', turn, audio });
    for (const socket of this.ctx.getWebSockets()) {
      const recipientId = socket.deserializeAttachment()?.playerId;
      if (!recipientId || recipientId === senderId || socket.readyState !== 1) continue;
      try { socket.send(payload); } catch {}
    }
  }

  webSocketClose(socket) {
    return this.enqueue(() => this.handleDisconnect(socket));
  }

  webSocketError(socket) {
    return this.enqueue(() => this.handleDisconnect(socket));
  }

  async handleDisconnect(socket) {
    const state = await this.readState();
    if (!state) return;
    const online = this.onlineIds(socket);
    if (state.mode === 'game') await this.refreshGameRoom(state, online);
    await this.broadcast(state, online);
  }

  alarm() {
    return this.enqueue(() => this.handleAlarm());
  }

  async handleAlarm() {
    const state = await this.readState();
    if (!state) return;
    if (state.expiresAt > Date.now()) {
      if (state.mode === 'game') {
        if (await this.refreshGameRoom(state)) await this.broadcast(state);
        else await this.saveGameRoom(state);
      } else await this.ctx.storage.setAlarm(state.expiresAt);
      return;
    }
    for (const socket of this.ctx.getWebSockets()) {
      try { socket.send(JSON.stringify({ type: 'expired', message: 'Phòng coop đã hết hạn.' })); socket.close(1000, 'Room expired'); } catch {}
    }
    await this.ctx.storage.deleteAll();
  }
}
