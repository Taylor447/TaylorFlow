import test from 'node:test';
import assert from 'node:assert/strict';
import worker, { CoopRoom } from '../src/index.js';

const APP_ORIGIN = 'https://taylor447.github.io';

class MemoryStorage {
  values = new Map();
  async get(key) { return this.values.get(key); }
  async put(key, value) { this.values.set(key, structuredClone(value)); }
  async setAlarm(value) { this.alarm = value; }
  async deleteAll() { this.values.clear(); }
}

class RoomNamespace {
  rooms = new Map();
  calls = 0;
  idFromName(name) { return name; }
  get(id) {
    return {
      fetch: async (input, init) => {
        this.calls++;
        const request = typeof input === 'string' ? new Request(input, init) : input;
        let room = this.rooms.get(id);
        if (!room) {
          const ctx = {
            storage: new MemoryStorage(),
            sockets: [],
            getWebSockets() { return this.sockets; },
            acceptWebSocket(socket) { this.sockets.push(socket); }
          };
          room = { ctx, instance: new CoopRoom(ctx, {}) };
          this.rooms.set(id, room);
        }
        return room.instance.fetch(request);
      }
    };
  }
}

function limiter({ allow = true } = {}) {
  const calls = [];
  return { calls, async limit(input) { calls.push(input); return { success: allow }; } };
}

function makeEnv(options = {}) {
  return {
    ALLOWED_ORIGIN: APP_ORIGIN,
    COOP_ROOMS: new RoomNamespace(),
    RL_ROOM_CREATE: limiter(options.create),
    RL_ROOM_JOIN: limiter(options.join),
    RL_TURN: limiter(options.turn),
    RL_SOCKET: limiter(options.socket)
  };
}

function post(url, body, headers = {}) {
  return new Request(`https://coop.example${url}`, {
    method: 'POST',
    headers: { Origin: APP_ORIGIN, 'Content-Type': 'application/json', ...headers },
    body
  });
}

const createBody = JSON.stringify({
  displayName: 'Taylor', part: 1, topic: 'Daily life', prompts: ['What do you study?', 'Why?']
});

test('API rejects mutation requests without an allowed Origin', async () => {
  const env = makeEnv();
  const response = await worker.fetch(new Request('https://coop.example/api/rooms', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: createBody
  }), env);
  assert.equal(response.status, 403);
  assert.equal(env.COOP_ROOMS.calls, 0);
});

test('API rejects a foreign Origin and sends non-cacheable security headers', async () => {
  const env = makeEnv();
  const denied = await worker.fetch(post('/api/rooms', createBody, { Origin: 'https://attacker.example' }), env);
  assert.equal(denied.status, 403);

  const health = await worker.fetch(new Request('https://coop.example/health'), env);
  assert.equal(health.status, 200);
  assert.equal(health.headers.get('Cache-Control'), 'no-store');
  assert.equal(health.headers.get('X-Content-Type-Options'), 'nosniff');
  assert.match(health.headers.get('Content-Security-Policy') || '', /default-src 'none'/);
  assert.equal(health.headers.get('Referrer-Policy'), 'no-referrer');
});

test('room creation is rate-limited before Durable Object work', async () => {
  const env = makeEnv({ create: { allow: false } });
  const response = await worker.fetch(post('/api/rooms', createBody, { 'CF-Connecting-IP': '203.0.113.8' }), env);
  assert.equal(response.status, 429);
  assert.equal(env.COOP_ROOMS.calls, 0);
  assert.equal(env.RL_ROOM_CREATE.calls.length, 1);
  assert.match(env.RL_ROOM_CREATE.calls[0].key, /^[a-f0-9]{64}$/);
  assert.doesNotMatch(JSON.stringify(env.RL_ROOM_CREATE.calls[0]), /203\.0\.113\.8/);
});

test('JSON request bodies are size-limited while streaming', async () => {
  const env = makeEnv();
  const response = await worker.fetch(post('/api/rooms', JSON.stringify({ text: 'x'.repeat(12_000) })), env);
  assert.equal(response.status, 413);
  assert.equal(env.COOP_ROOMS.calls, 0);
});

test('room creation validates input and returns a usable session', async () => {
  const env = makeEnv();
  const response = await worker.fetch(post('/api/rooms', createBody), env);
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.match(data.roomCode, /^[A-HJ-NP-Z2-9]{7}$/);
  assert.match(data.playerId, /^[a-f0-9]{16}$/);
  assert.match(data.playerToken, /^[a-f0-9]{48}$/);
  assert.equal(data.state.players[0].name, 'Taylor');
});

test('WebSocket authentication no longer accepts credentials in the URL', async () => {
  const room = new CoopRoom({ storage: new MemoryStorage(), getWebSockets: () => [] }, {});
  const response = await room.connect(new Request('https://coop.internal/socket?playerId=abc&token=secret', {
    headers: { Upgrade: 'websocket' }
  }));
  assert.equal(response.status, 400);
});

test('WebSocket rejects invalid first-message authentication and closes the socket', async () => {
  const ctx = { storage: new MemoryStorage(), sockets: [], getWebSockets() { return this.sockets; } };
  const room = new CoopRoom(ctx, {});
  await room.create(new Request('https://coop.internal/create', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      code: 'ABCDEFG', mode: 'speaking', part: 1, topic: 'Daily life', prompts: ['A question', 'Another question'],
      host: { id: '0123456789abcdef', token: 'a'.repeat(48), name: 'Taylor' }
    })
  }));
  const sent = [];
  const socket = {
    readyState: 1,
    attachment: { connectedAt: Date.now() },
    deserializeAttachment() { return this.attachment; },
    serializeAttachment(value) { this.attachment = value; },
    send(value) { sent.push(JSON.parse(value)); },
    close(code) { this.closedWith = code; this.readyState = 3; }
  };
  ctx.sockets.push(socket);
  await room.handleSocketMessage(socket, JSON.stringify({ type: 'auth', playerId: 'bad', token: 'bad' }));
  assert.equal(socket.closedWith, 4003);
  assert.equal(sent[0].type, 'error');
});

test('WebSocket rejects oversized binary frames before decoding them', async () => {
  const room = new CoopRoom({ storage: new MemoryStorage(), getWebSockets: () => [] }, {});
  const sent = [];
  const socket = {
    readyState: 1,
    deserializeAttachment() { return {}; },
    send(value) { sent.push(JSON.parse(value)); },
    close(code) { this.closedWith = code; this.readyState = 3; }
  };
  await room.handleSocketMessage(socket, new Uint8Array(768 * 1024 + 1).buffer);
  assert.equal(socket.closedWith, 1009);
  assert.equal(sent[0].type, 'error');
});

test('WebSocket session is authenticated by its first message and audio skips unauthenticated sockets', async () => {
  const ctx = {
    storage: new MemoryStorage(),
    sockets: [],
    getWebSockets() { return this.sockets; },
    acceptWebSocket(socket) { this.sockets.push(socket); }
  };
  const room = new CoopRoom(ctx, {});
  const playerId = '0123456789abcdef';
  const token = 'a'.repeat(48);
  await room.create(new Request('https://coop.internal/create', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      code: 'ABCDEFG', mode: 'speaking', part: 1, topic: 'Daily life', prompts: ['A question', 'Another question'],
      host: { id: playerId, token, name: 'Taylor' }
    })
  }));
  const sent = [];
  const socket = {
    readyState: 1,
    attachment: { connectedAt: Date.now() },
    deserializeAttachment() { return this.attachment; },
    serializeAttachment(value) { this.attachment = value; },
    send(value) { sent.push(JSON.parse(value)); },
    close() { this.readyState = 3; }
  };
  ctx.sockets.push(socket);
  await room.handleSocketMessage(socket, JSON.stringify({ type: 'auth', playerId, token }));
  assert.equal(socket.attachment.playerId, playerId);
  assert.equal(sent[0].type, 'authenticated');
  assert.equal(sent[0].state.players[0].name, 'Taylor');
  assert.equal(JSON.stringify(sent).includes(token), false);

  const unauthorizedSent = [];
  ctx.sockets.push({
    readyState: 1,
    deserializeAttachment() { return {}; },
    send(value) { unauthorizedSent.push(JSON.parse(value)); }
  });
  await room.broadcastAudio(0, playerId, 'data:audio/webm;base64,AA==');
  assert.equal(unauthorizedSent.length, 0);
});

test('chat is capped per authenticated socket within a ten-second window', async () => {
  const ctx = {
    storage: new MemoryStorage(),
    sockets: [],
    getWebSockets() { return this.sockets; }
  };
  const room = new CoopRoom(ctx, {});
  const playerId = '0123456789abcdef';
  await room.create(new Request('https://coop.internal/create', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      code: 'ABCDEFG', mode: 'speaking', part: 1, topic: 'Daily life', prompts: ['A question', 'Another question'],
      host: { id: playerId, token: 'a'.repeat(48), name: 'Taylor' }
    })
  }));
  const sent = [];
  const socket = {
    readyState: 1,
    attachment: { playerId, connectedAt: Date.now(), chatWindowAt: 0, chatCount: 0 },
    deserializeAttachment() { return this.attachment; },
    serializeAttachment(value) { this.attachment = value; },
    send(value) { sent.push(JSON.parse(value)); }
  };
  ctx.sockets.push(socket);

  const originalNow = Date.now;
  let now = 1_000_000;
  Date.now = () => now;
  try {
    for (let index = 0; index < 13; index++) {
      await room.handleSocketMessage(socket, JSON.stringify({ type: 'chat', text: `Message ${index}` }));
      now += 601;
    }
  } finally {
    Date.now = originalNow;
  }

  const state = await room.readState();
  assert.equal(state.chat.length, 12);
  assert.equal(socket.attachment.chatCount, 12);
  assert.equal(sent.filter(message => message.type === 'error').length, 1);
});
