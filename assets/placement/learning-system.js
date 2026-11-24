(function (window) {
  "use strict";
  const Core = window.TFLearningCore;
  const BANK_FILES = [
    "bank-A1-01.js", "bank-A2-01.js", "bank-A2-02.js", "bank-B1-01.js", "bank-B1-02.js",
    "bank-B2-01.js", "bank-B2-02.js", "bank-C1-01.js", "bank-C1-02.js", "bank-C2-01.js"
  ];
  const DAY = 86400000;
  let bankPromise = null;
  let catPromise = null;
  let questionStartedAt = Date.now();
  let busy = false;
  let loadError = "";
  let routeTab = null;
  let routeStartedAt = 0;
  let routeFinished = false;
  let learningPlanView = false;

  function state() {
    const saved = Core.cleanProfile(st.learningProfileV2);
    if (!saved.placement.legacy) {
      try {
        const legacy = JSON.parse(localStorage.getItem("tf-placement-v1") || "null");
        if (legacy && Number.isInteger(legacy.score) && legacy.score >= 0 && legacy.score <= 8) {
          saved.placement.legacy = { score: legacy.score, at: Number(legacy.at) || 0, source: "tf-placement-v1", confidence: "low" };
        }
      } catch {}
    }
    st.learningProfileV2 = saved;
    return saved;
  }

  function persist(value = state()) {
    try {
      value.updated = Date.now();
      st.learningProfileV2 = Core.cleanProfile(value);
      // This namespace intentionally stays out of progressSnapshot/cloud sync.
      localStorage.setItem("epu", JSON.stringify(st));
      return true;
    } catch { return false; }
  }

  function mutate(callback) {
    const value = state();
    callback(value);
    if (!value.adaptive.manual && Date.now() - value.adaptive.modeUpdated >= 7 * DAY) {
      const hasOutcomes = value.adaptive.outcomes.length >= 4;
      const nextMode = hasOutcomes ? Core.chooseMode(value.adaptive, Date.now()) : Core.behaviorSuggestion(value).mode;
      value.adaptive.mode = nextMode;
      value.adaptive.modeUpdated = Date.now();
    }
    persist(value);
    return value;
  }

  function addEvent(type, meta = {}, durationMs = 0) {
    try {
      mutate(value => {
        value.events.push({ type, at: Date.now(), durationMs, meta });
        value.events = value.events.slice(-800);
        if (["study-session", "placement-result", "recall", "baseline-task"].includes(type)) {
          if (!value.plan.startedAt) value.plan.startedAt = Date.now();
          value.plan.lastRebuilt = Date.now();
        }
      });
    } catch {}
  }

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const absolute = new URL(src, document.baseURI).href;
      const found = [...document.scripts].find(script => script.src === absolute);
      if (found?.dataset.loaded === "true") { resolve(); return; }
      if (found?.dataset.loading === "true") {
        found.addEventListener("load", resolve, { once: true });
        found.addEventListener("error", () => reject(new Error("Không tải được " + src)), { once: true });
        return;
      }
      const script = found || document.createElement("script");
      script.src = src;
      script.async = true;
      script.dataset.loading = "true";
      script.addEventListener("load", () => { script.dataset.loading = "false"; script.dataset.loaded = "true"; resolve(); }, { once: true });
      script.addEventListener("error", () => { script.dataset.loading = "false"; script.remove(); reject(new Error("Không tải được " + src)); }, { once: true });
      if (!found) document.head.appendChild(script);
    });
  }

  async function ensureCAT() {
    if (!catPromise) catPromise = loadScript("./assets/placement/cat.js").then(() => {
      if (!window.TFPlacementCAT) throw new Error("Bộ máy kiểm tra chưa sẵn sàng.");
    }).catch(error => { catPromise = null; throw error; });
    await catPromise;
  }

  async function ensureBank() {
    if (!bankPromise) {
      window.TFPlacementBank = window.TFPlacementBank || { items: [], loaded: new Set(), register(level, items) {
        if (!Array.isArray(items)) throw new TypeError("Ngân hàng câu hỏi không hợp lệ.");
        this.items.push(...items.map(item => ({ ...item, level: item.level || level })));
      } };
      bankPromise = Promise.all(BANK_FILES.map(file => loadScript("./assets/placement/" + file))).then(() => {
        if (window.TFPlacementBank.items.length !== 300) throw new Error("Ngân hàng chưa đủ 300 câu.");
        return window.TFPlacementBank.items;
      }).catch(error => { bankPromise = null; throw error; });
    }
    return bankPromise;
  }

  function modeConfig(mode) {
    return mode === "mini" ? { ...window.TFPlacementCAT.CONFIG, minQuestions: 6, maxQuestions: 6, targetSE: 0 } : window.TFPlacementCAT.CONFIG;
  }

  function currentItem() {
    const active = state().placement.active;
    return active?.currentQuestionId ? window.TFPlacementBank?.items.find(item => item.id === active.currentQuestionId) || null : null;
  }

  function pickQuestion(active, bank) {
    const profile = state(), CAT = window.TFPlacementCAT, config = modeConfig(active.mode);
    const choice = CAT.selectNext(bank, active.session, profile.placement.exposure, {
      assessmentCount: profile.placement.assessmentCount + 1,
      maxExposureRate: .35,
      config
    });
    if (choice.done) return false;
    active.currentQuestionId = choice.item.id;
    active.questionAt = Date.now();
    questionStartedAt = active.questionAt;
    return true;
  }

  async function startPlacement(mode = "full", fresh = false) {
    if (busy) return;
    busy = true;
    loadError = "";
    learningPlanView = false;
    render();
    try {
      await ensureCAT();
      const bank = await ensureBank();
      let value = state(), active = value.placement.active;
      if (fresh || !active || active.session.status === "complete") {
        const prior = value.placement.latest;
        const retest = !fresh && prior && mode === "mini";
        const session = window.TFPlacementCAT.createSession({
          now: Date.now(),
          id: "cat-" + Date.now().toString(36),
          theta: retest && Number.isFinite(prior.theta) ? prior.theta : 0,
          se: retest && Number.isFinite(prior.se) ? prior.se : undefined
        });
        active = { session, currentQuestionId: "", pausedAt: null, questionAt: Date.now(), mode };
      } else if (active.session.status === "paused") {
        active.session = window.TFPlacementCAT.resume(active.session);
        active.pausedAt = null;
        active.questionAt = Date.now();
      }
      if (!active.currentQuestionId || !bank.some(item => item.id === active.currentQuestionId)) pickQuestion(active, bank);
      value.placement.active = active;
      persist(value);
      addEvent("placement-start", { mode, count: active.session.answers.length });
    } catch (error) {
      loadError = "Chưa tải được bộ câu hỏi cục bộ. Kiểm tra thư mục assets/placement rồi thử lại.";
    } finally {
      busy = false;
      render();
    }
  }

  function pausePlacement() {
    const value = state(), active = value.placement.active;
    if (!active || !window.TFPlacementCAT) return;
    active.session = window.TFPlacementCAT.pause(active.session);
    active.pausedAt = Date.now();
    persist(value);
    render();
  }

  function cancelPlacement() {
    mutate(value => { value.placement.active = null; });
    render();
  }

  function completePlacement(active) {
    const CAT = window.TFPlacementCAT, summary = CAT.profile(active.session);
    const bank = window.TFPlacementBank?.items || [];
    const answerFeedback = active.session.answers.map(answer => {
      const item = bank.find(row => row.id === answer.itemId);
      if (!item) return null;
      return { itemId: item.id, level: item.level, stem: item.stem, selected: answer.unknown ? "Tôi không biết" : item.options?.[answer.choice] || "", key: item.key, why: item.why, correct: answer.correct === true, unknown: answer.unknown === true, skills: item.skill || [] };
    }).filter(Boolean);
    const result = {
      at: Date.now(), mode: active.mode, level: summary.level, theta: summary.theta, se: summary.se,
      confidence: summary.confidence, interval: summary.interval, lastFeedback: active.feedback || null, asked: summary.asked, unknown: summary.unknown,
      heatmap: CAT.skillHeatmap(active.session), answerFeedback, band: null
    };
    const previous = state().placement.latest;
    mutate(value => {
      value.placement.assessmentCount += 1;
      value.placement.latest = result;
      value.placement.history.push(result);
      value.placement.history = value.placement.history.slice(-24);
      value.placement.active = null;
    });
    addEvent("placement-result", { mode: active.mode, level: result.level, theta: result.theta });
    if (previous && Number.isFinite(previous.theta)) {
      const reward = Math.max(0, Math.min(1, .5 + (result.theta - previous.theta) / 2));
      rewardOutcome(state().adaptive.mode, reward, "retest");
    }
  }

  function answerPlacement(choice, unknown = false) {
    const value = state(), active = value.placement.active, item = currentItem();
    if (!active || !item || active.session.status !== "active") return;
    const elapsed = Math.max(0, Date.now() - Math.max(questionStartedAt, active.questionAt || 0));
    const selected = !unknown && Number.isInteger(choice) ? item.options[choice] : "";
    const correct = !unknown && String(selected).trim().toLocaleLowerCase("en") === String(item.key).trim().toLocaleLowerCase("en");
    active.feedback = { unknown, correct, key: item.key, why: item.why };
    const nextSession = window.TFPlacementCAT.update(active.session, item, unknown ? { unknown: true, spentMs: elapsed } : { choice, spentMs: elapsed }, { config: modeConfig(active.mode) });
    active.session = nextSession;
    value.placement.exposure[item.id] = (value.placement.exposure[item.id] || 0) + 1;
    if (window.TFPlacementCAT.isComplete(nextSession, modeConfig(active.mode))) {
      persist(value);
      completePlacement(active);
      render();
      return;
    }
    const bank = window.TFPlacementBank?.items || [];
    if (!pickQuestion(active, bank)) {
      active.session.status = "complete";
      persist(value);
      completePlacement(active);
    } else {
      value.placement.active = active;
      persist(value);
    }
    render();
  }

  function continuePlacement() {
    const value = state(), active = value.placement.active;
    if (!active) return;
    active.feedback = null;
    active.questionAt = Date.now();
    questionStartedAt = active.questionAt;
    persist(value);
    render();
  }

  function levelName(level) {
    return ({ A1: "Mới bắt đầu", A2: "Sơ cấp", B1: "Trung cấp", B2: "Trên trung cấp", C1: "Nâng cao", C2: "Thành thạo" })[level] || "Chưa đủ dữ liệu";
  }

  function statusName(value) {
    return ({ improving: "Đang tiến bộ", stalled: "Chững lại", declining: "Đi lùi", insufficient: "Chưa đủ dữ liệu" })[value] || "Chưa đủ dữ liệu";
  }

  function validPracticeRows() {
    try { return Core.validSpeakingRows(st.h, scoreHistoryTexts(), Date.now(), SCORE_VERSION); }
    catch { return []; }
  }

  function criteriaSummary(rows = validPracticeRows()) {
    const specs = [["f", "Fluency & Coherence"], ["l", "Lexical Resource"], ["g", "Grammar"], ["p", "Pronunciation"]];
    return specs.map(([key, label]) => {
      const values = rows.map(row => row[key]).filter(value => Number.isFinite(value) && value >= 0 && value <= 9);
      return { key, label, count: values.length, score: values.length ? values.reduce((sum, n) => sum + n, 0) / values.length : null };
    });
  }

  function studyMinutes(profile = state()) {
    const cutoff = Date.now() - 60 * DAY;
    const recent = profile.events.filter(event => event.type === "study-session" && event.at >= cutoff);
    const aggregate = profile.aggregates.weeks.filter(row => row.week * 7 * DAY >= cutoff).reduce((sum, row) => sum + row.minutes, 0);
    return recent.reduce((sum, row) => sum + row.durationMs / 60000, aggregate);
  }

  function effectiveness() {
    const profile = state();
    const result = Core.estimateEffectiveness(validPracticeRows(), profile.adaptive.recall, studyMinutes(profile));
    result.actions = result.status === "improving" ? ["Giữ nhịp hiện tại.", "Dành một lượt ngắn cho kỹ năng yếu nhất."] : result.status === "declining" ? ["Giảm khối lượng trong vài ngày.", "Ôn lại thẻ đã đến hạn rồi làm bài mini khi sẵn sàng."] : result.status === "stalled" ? ["Đổi một nhiệm vụ sang ví dụ hoặc luyện nói có gợi ý.", "Đo lại sau ba lượt hợp lệ."] : ["Hoàn thành thêm ba lượt nói có ghi âm và điểm hợp lệ.", "Ôn thẻ sau 1, 3 và 7 ngày để tạo dữ liệu nhớ lại."];
    if (Number.isFinite(result.pointsPerHour)) result.reason += ` Mức thay đổi ước tính ${result.pointsPerHour.toFixed(2)} band/giờ luyện, độ tin cậy còn giới hạn.`;
    result.reason += " Hành động: " + result.actions.join(" ");
    return result;
  }

  function strongestAndWeakest(heatmap = state().placement.latest?.heatmap || []) {
    const ranked = heatmap.filter(row => row.attempts >= 2 && Number.isFinite(row.accuracy)).sort((a, b) => b.accuracy - a.accuracy);
    return { strong: ranked.filter(row => row.accuracy >= .7).slice(0, 3), weak: [...ranked].reverse().filter(row => row.accuracy <= .55).slice(0, 3) };
  }

  function skillLabel(key) {
    const label = String(key || "").replace(/-/g, " ").trim();
    return label ? label[0].toLocaleUpperCase("vi-VN") + label.slice(1) : "";
  }

  function confidenceLabel(value) {
    return ({ high: "cao", medium: "vừa", low: "thấp" })[value] || "thấp";
  }

  function retestDates(profile = state()) {
    const full = [...profile.placement.history].reverse().find(row => row.mode !== "mini") || null;
    const mini = [...profile.placement.history].reverse().find(row => row.mode === "mini") || null;
    return { full: full ? full.at + 56 * DAY : 0, mini: mini ? mini.at + 14 * DAY : full ? full.at + 14 * DAY : 0 };
  }

  function latestFullAssessment(profile = state()) {
    return [...profile.placement.history, profile.placement.latest].filter(row => row && row.mode === "full" && row.asked >= 12).sort((a, b) => b.at - a.at)[0] || null;
  }

  function qualifiedProfile(profile = state()) {
    const assessment = latestFullAssessment(profile), speaking = profile.placement.speakingTest;
    return { assessment, speaking, ready: Boolean(assessment && speaking?.valid && speaking.validResponses === 7 && speaking.responses === 7 && [1,2,3].every(part => speaking.parts.includes(part))) };
  }

  function formatSpeakingBand(value) {
    const score = Number.isFinite(value) ? Math.max(0, Math.min(9, value)) : null;
    if (score == null) return "Chưa đủ dữ liệu";
    const low = Math.max(0, Math.floor((score - .5) * 2) / 2);
    const high = Math.min(9, Math.ceil((score + .5) * 2) / 2);
    return `${low.toFixed(1)}–${high.toFixed(1)}`;
  }

  function renderAnswerFeedback(result) {
    if (!Array.isArray(result?.answerFeedback) || !result.answerFeedback.length) return '<p class="tf-muted">Bài kiểm tra cũ không lưu lời giải từng câu. Bài làm mới sẽ hiển thị giải thích đầy đủ.</p>';
    return `<details class="tf-answer-review"><summary>Giải thích đáp án cả bài <span>${result.answerFeedback.length} câu</span></summary><div class="tf-answer-list">${result.answerFeedback.map((row, index) => `<details class="tf-answer-item"><summary><span>${index + 1}. ${esc(row.stem)}</span><b class="${row.correct ? "is-correct" : "is-incorrect"}">${row.correct ? "Đúng" : "Xem đáp án"}</b></summary><p><strong>Bạn chọn:</strong> ${esc(row.selected || "Chưa lưu lựa chọn")}</p><p><strong>Đáp án:</strong> ${esc(row.key)}</p><p>${esc(row.why)}</p><small>${esc(row.level)} · ${esc((row.skills || []).map(skillLabel).join(" · "))}</small></details>`).join("")}</div></details>`;
  }

  function renderResultCard() {
    const profile = state(), result = latestFullAssessment(profile), qualification = qualifiedProfile(profile);
    const speaking = profile.placement.speakingTest;
    if (!qualification.ready) {
      const catDone = Boolean(result);
      const speechDone = Boolean(speaking?.valid);
      const speechAttempt = speaking?.lastAttemptAt ? (speaking.lastAttemptParts?.length ? `${speaking.lastAttemptValidResponses || 0}/7 câu có giọng nói hợp lệ · lượt gần nhất ${new Date(speaking.lastAttemptAt).toLocaleDateString("vi-VN")}` : `Lượt gần nhất chưa đạt yêu cầu 7 câu · ${new Date(speaking.lastAttemptAt).toLocaleDateString("vi-VN")}`) : "Cần hoàn thành đủ 7 câu có giọng nói được phát hiện và chấm điểm.";
      const speechStatus = speechDone ? `7/7 bản ghi hợp lệ · ${new Date(speaking.at).toLocaleDateString("vi-VN")}${speaking.lastAttemptValid === false && speaking.lastAttemptAt > speaking.at ? ` · lượt mới nhất: ${speechAttempt}` : ""}` : speechAttempt;
      const feedback = result ? renderAnswerFeedback(result) : "";
      return `<div class="tf-result-gate"><div class="tf-result-gate-heading"><span class="tf-result-orbit" aria-hidden="true">${catDone && speechDone ? "✓" : "◎"}</span><div><small>HỒ SƠ TRÌNH ĐỘ</small><h4>Chưa đủ dữ liệu để cấp mức trình độ</h4></div></div><div class="tf-gate-checks"><p><span class="${catDone ? "done" : "pending"}">${catDone ? "✓" : "1"}</span><span><b>Kiểm tra thích nghi đầy đủ</b><small>${catDone ? `${result.asked} câu hoàn tất · ${new Date(result.at).toLocaleDateString("vi-VN")}` : "Cần hoàn thành bài CAT đầy đủ, tối thiểu 12 câu."}</small></span></p><p><span class="${speechDone ? "done" : "pending"}">${speechDone ? "✓" : "2"}</span><span><b>Speaking Test · Part 1–3</b><small>${speechStatus}</small></span></p></div><p class="tf-muted">Chỉ khi hoàn tất cả hai bài, TaylorFlow mới hiển thị CEFR và band ước tính. Nếu thiếu tiếng nói hoặc không chấm được, lượt đó không được tính.</p>${feedback}</div>`;
    }
    const skills = strongestAndWeakest(result.heatmap);
    const date = new Date(result.at).toLocaleDateString("vi-VN");
    const conf = confidenceLabel(result.confidence === "high" ? "medium" : result.confidence);
    const interval = Array.isArray(result.interval) && result.interval.length ? result.interval.join("–") : result.level;
    const heat = result.heatmap.map(row => `<div class="tf-heat-cell ${esc(row.status)}"><span>${esc(skillLabel(row.skill))}</span><b>${row.accuracy == null ? "Chưa đủ" : Math.round(row.accuracy * 100) + "%"}</b><small>${row.attempts} câu · ${row.unknown} lần bỏ qua</small></div>`).join("");
    const criteria = [["Fluency & Coherence", speaking.f], ["Lexical Resource", speaking.l], ["Grammatical Range & Accuracy", speaking.g], ["Pronunciation", speaking.p]].map(([label, score]) => `<div class="tf-criterion"><span>${esc(label)}</span><b>${score == null ? "Chưa đủ dữ liệu" : score.toFixed(1) + " · ước tính"}</b></div>`).join("");
    return `<div class="tf-profile-result"><section class="tf-result-certificate"><div class="tf-certificate-glow" aria-hidden="true"></div><div class="tf-certificate-top"><small>HỒ SƠ TRÌNH ĐỘ · ƯỚC TÍNH LUYỆN TẬP</small><span class="tf-certificate-confidence">Độ tin cậy ${esc(conf)}</span></div><div class="tf-certificate-main"><div><h4>${esc(result.level)} <span>· ${esc(levelName(result.level))}</span></h4><p>CEFR ước tính từ bài CAT đầy đủ</p></div><div class="tf-certificate-band"><b>${esc(formatSpeakingBand(speaking.o))}</b><small>IELTS Speaking · xấp xỉ</small></div></div><p class="tf-disclaimer">Không phải điểm thi IELTS chính thức. Band được ước tính từ Speaking Test hợp lệ; mức thấp nhất là 0.</p></section><p class="tf-muted">CAT: ${date} · ${result.asked} câu · sai số chuẩn ${Number.isFinite(result.se) ? result.se.toFixed(2) : "—"} · khoảng CEFR ${esc(interval)}. Speaking Test: ${new Date(speaking.at).toLocaleDateString("vi-VN")} · 7/7 câu hợp lệ.</p>${renderAnswerFeedback(result)}<div class="tf-criteria-grid">${criteria}</div><h5>Mức độ từng phần</h5><div class="tf-heatmap">${heat || '<p>Chưa đủ dữ liệu theo kỹ năng.</p>'}</div><div class="tf-strength-grid"><div><h5>Điểm mạnh quan sát được</h5>${skills.strong.length ? `<ul>${skills.strong.map(row => `<li>${esc(skillLabel(row.skill))} · ${Math.round(row.accuracy * 100)}%</li>`).join("")}</ul>` : '<p class="tf-muted">Chưa đủ câu theo từng kỹ năng.</p>'}</div><div><h5>Ưu tiên luyện</h5>${skills.weak.length ? `<ul>${skills.weak.map(row => `<li>${esc(skillLabel(row.skill))} · ${Math.round(row.accuracy * 100)}%</li>`).join("")}</ul>` : '<p class="tf-muted">Chưa xác định kỹ năng yếu; tiếp tục luyện.</p>'}</div></div><p class="tf-disclaimer">Độ khó CAT là ước lượng ban đầu, được hiệu chỉnh theo dữ liệu làm bài thực tế.</p></div>`;
  }

  function renderPlacement() {
    const profile = state(), active = profile.placement.active, CAT = window.TFPlacementCAT;
    if (busy) return '<div class="tf-status" id="placement-status" role="status">Đang tải bộ câu hỏi cục bộ…</div>';
    if (active) {
      if (!CAT || !window.TFPlacementBank?.items?.length) return `<div class="tf-status" id="placement-status" role="status">Đang tải bài kiểm tra đã lưu…</div><button type="button" onclick="startPlacement('${active.mode}')">Tiếp tục</button>`;
      if (active.session.status === "paused") return `<div class="tf-status" role="status">Bài kiểm tra đã tạm dừng · ${active.session.answers.length}/${active.mode === "mini" ? 6 : "12–20"} câu.</div><button type="button" onclick="startPlacement('${active.mode}')">Tiếp tục bài kiểm tra</button><button type="button" class="g" onclick="cancelPlacement()">Kết thúc bài này</button>`;
      if (active.feedback) return `<div class="tf-cat-question"><p class="eyebrow">PHẢN HỒI CÂU VỪA LÀM</p><h4>${active.feedback.unknown ? "Đã ghi nhận: Tôi không biết" : active.feedback.correct ? "Chính xác" : "Đáp án tham khảo: " + esc(active.feedback.key)}</h4><p>${esc(active.feedback.why)}</p><p class="tf-muted">Câu kế tiếp đã được chọn theo kết quả hiện tại; thời gian trả lời không bị trừ điểm.</p><button type="button" onclick="continuePlacement()">Câu tiếp theo</button><button type="button" class="g" onclick="pausePlacement()">Tạm dừng</button></div>`;
      const item = currentItem();
      if (!item) return '<div class="tf-status" id="placement-status" role="status">Không tìm thấy câu hiện tại. Thử tiếp tục để tải lại câu hỏi.</div><button type="button" onclick="startPlacement()">Thử lại</button>';
      const options = item.options.map((option, index) => `<button type="button" class="tf-option" onclick="answerPlacement(${index})">${String.fromCharCode(65 + index)}. ${esc(option)}</button>`).join("");
      return `<div class="tf-cat-question"><div class="tf-cat-meta"><span>${esc(item.level)} · ${esc(item.type.replace(/-/g, " "))}</span><span>${active.session.answers.length + 1} / ${active.mode === "mini" ? 6 : "tối đa 20"}</span></div><h4>${esc(item.stem)}</h4><div class="tf-option-grid">${options}</div><div class="tf-cat-actions"><button type="button" class="g" onclick="answerPlacement(null,true)">Tôi không biết</button><button type="button" class="g" onclick="pausePlacement()">Tạm dừng</button></div><p class="tf-muted">Thời gian trả lời chỉ được ghi lại để tham khảo, không làm giảm kết quả.</p><p class="tf-why" aria-live="polite">Sau khi trả lời, câu kế tiếp sẽ được điều chỉnh theo kết quả.</p></div>`;
    }
    const result = latestFullAssessment(profile), speaking = profile.placement.speakingTest;
    const due = retestDates(profile), date = value => value ? new Date(value).toLocaleDateString("vi-VN") : "sau khi có hồ sơ";
    return `<div class="tf-placement-box">${loadError ? `<p class="tf-legacy-note" role="status">${esc(loadError)}</p>` : ""}<p class="tf-muted">Hoàn thành cả bài CAT đầy đủ (12–20 câu) và Speaking Test riêng của lộ trình (7 câu) để nhận hồ sơ CEFR cùng band Speaking ước tính. Có thể tạm dừng CAT; không có đồng hồ mặc định.</p><div class="tf-cat-actions"><button type="button" onclick="startPlacement('full',true)">${result ? "Làm lại CAT đầy đủ" : "Bắt đầu CAT"}</button><button type="button" class="g" onclick="startExam(123,true)">${speaking?.valid ? "Làm lại Speaking Test" : speaking?.lastAttemptAt ? "Thử lại Speaking Test" : "Bắt đầu Speaking Test"}</button></div><p class="tf-muted">Bài này có bộ câu hỏi riêng, đủ Part 1–3 và lưu kết quả vào hồ sơ lộ trình khi 7 câu hợp lệ.</p><p class="tf-muted">Nhắc kiểm tra lại nhẹ nhàng: mini khoảng ${date(due.mini)} · đầy đủ khoảng ${date(due.full)}. Không có đồng hồ mặc định.</p>${renderResultCard()}${!result && profile.placement.legacy ? `<p class="tf-legacy-note">Đã giữ kết quả bài cũ ${profile.placement.legacy.score}/8 làm dữ liệu tham khảo có độ tin cậy thấp; kết quả này không thay thế CAT.</p>` : ""}</div>`;
  }

  function recordPlacementSpeakingTest(payload = {}) {
    const at = Number.isFinite(payload.at) ? payload.at : Date.now();
    const parts = Array.isArray(payload.parts) ? [...new Set(payload.parts.filter(part => [1,2,3].includes(part)))].sort() : [];
    const validResponses = Math.max(0, Math.min(7, Math.floor(Number(payload.validResponses) || 0)));
    const responses = Math.max(0, Math.min(7, Math.floor(Number(payload.responses) || 0)));
    const valid = payload.valid === true && parts.length === 3 && validResponses === 7 && responses === 7 && Number.isFinite(payload.o) && [payload.f, payload.l, payload.g].every(value => Number.isFinite(value) && value >= 0 && value <= 9);
    mutate(value => {
      const prior = value.placement.speakingTest || {};
      const attempt = { lastAttemptAt: at, lastAttemptValid: valid, lastAttemptExamId: String(payload.examId || ""), lastAttemptParts: parts, lastAttemptResponses: responses, lastAttemptValidResponses: validResponses };
      const next = valid ? { ...payload, ...attempt, at, parts, responses, validResponses, valid: true } : { ...prior, ...attempt };
      value.placement.speakingTest = Core.cleanProfile({ placement: { speakingTest: next } }).placement.speakingTest;
    });
    if (valid) addEvent("placement-result", { mode: "speaking-test", score: payload.o });
    return valid;
  }

  function coachInsight() {
    const profile = state(), suggested = Core.behaviorSuggestion(profile), mode = profile.adaptive.mode;
    const display = ({ brief: "Chặng ngắn", examples: "Nhiều ví dụ", bilingual: "Gợi ý song ngữ", audio: "Thêm nghe mẫu", game: "Luyện qua trò chơi" })[mode] || "Nhiều ví dụ";
    const reasons = {
      brief: "Gợi ý từ nhịp các phiên gần đây, không dựa trên thông tin nhân khẩu học.",
      examples: "Có dấu hiệu bạn đang thử lại nhiều; ví dụ mẫu giúp nhìn cấu trúc trước khi nói.",
      bilingual: "Có vài phiên học bị ngắt; gợi ý tiếng Việt có thể giúp bắt đầu dễ hơn.",
      audio: "Chưa có đủ kết quả để kết luận; thử nghe mẫu rồi tự nhắc lại.",
      game: "Chưa có đủ kết quả để kết luận; thử một lượt ngắn qua trò chơi."
    };
    return { mode, display, why: mode === suggested.mode ? suggested.why : reasons[mode], focus: suggested.focus };
  }

  function changeLearningMode() {
    const profile = state(), current = profile.adaptive.mode, index = Core.METHODS.indexOf(current), next = Core.METHODS[(index + 1) % Core.METHODS.length];
    profile.adaptive.mode = next;
    profile.adaptive.modeUpdated = Date.now();
    profile.adaptive.manual = true;
    persist(profile);
    render();
  }

  function pathPlan() {
    const profile = state(), setup = st.learningPath.setup || {}, qualified = qualifiedProfile(profile), result = qualified.ready ? qualified.assessment : null;
    const anchor = profile.plan.startedAt || setup.updated || result?.at || Date.now();
    if (!profile.plan.startedAt) { profile.plan.startedAt = anchor; persist(profile); }
    const weak = (result?.heatmap || []).filter(row => row.status === "priority" || row.status === "developing").sort((a, b) => (a.accuracy ?? 1) - (b.accuracy ?? 1)).slice(0, 3).map(row => row.skill);
    const voice = criteriaSummary();
    for (const row of voice.filter(item => item.key !== "p" && item.score != null).sort((a, b) => a.score - b.score)) if (weak.length < 3) weak.push(row.key === "f" ? "fluency" : row.key === "l" ? "vocabulary" : "grammar");
    return Core.makePlan({ setup, level: result?.level || "B1", weakSkills: [...new Set(weak)].slice(0, 3), dailyMinutes: profile.plan.dailyMinutes || 10, anchorAt: anchor, now: Date.now() });
  }

  function savePlanSettings(event) {
    event.preventDefault();
    const form = event.currentTarget, changes = {};
    const target = form.elements.target.value;
    const examDate = form.elements.examDate.value;
    const minutes = Number(form.elements.minutes.value);
    if (target && Number.isFinite(Number(target)) && Number(target) >= 1 && Number(target) <= 9 && Number(target) * 2 % 1 === 0) changes.target = Number(target);
    if (examDate && /^\d{4}-\d{2}-\d{2}$/u.test(examDate)) changes.examDate = examDate;
    if ([5, 10, 20].includes(minutes)) changes.minutes = minutes;
    if (Object.keys(changes).length && typeof updatePathSetup === "function") updatePathSetup(changes);
    mutate(value => { value.plan.dailyMinutes = [5, 10, 20].includes(minutes) ? minutes : value.plan.dailyMinutes; value.plan.updated = Date.now(); if (!value.plan.startedAt) value.plan.startedAt = Date.now(); value.plan.lastRebuilt = Date.now(); });
    learningPlanView = true;
    render();
  }

  function activityButton(activity) {
    const actions = {
      lesson: "go('les')", vocabulary: "go('les')", speaking: `start([${activity.part || 1}])`, flashcards: "go('col')", mock: "startExam(123)"
    };
    const text = { lesson: "Bài học", vocabulary: "Bộ sách từ vựng", speaking: "Luyện nói", flashcards: "Ôn thẻ", mock: "Thi thử Part 1–3" }[activity.kind];
    return `<button type="button" class="g tf-task" onclick="${actions[activity.kind] || "go('les')"}"><span><b>${esc(text)}</b><small>${esc(activity.label)} · ${esc(skillLabel(activity.skill))}</small></span><strong>${activity.minutes} phút</strong></button>`;
  }

  function todayActivities(plan) {
    const chosen = plan.todayActivities || [];
    const active = plan.stages[plan.activeStageIndex] || plan.stages[0];
    return `<p class="tf-muted">Giai đoạn ${plan.activeStageIndex + 1} · ${esc(active.title)} · Ngày ${plan.dayIndex + 1} của lộ trình</p><div class="tf-today-list">${chosen.map(activityButton).join("")}</div>`;
  }

  function renderPlanDashboard() {
    const profile = state(), qualified = qualifiedProfile(profile), result = qualified.ready ? qualified.assessment : null, plan = pathPlan(), effect = effectiveness(), setup = st.learningPath.setup || {}, stages = plan.stages;
    const progress = pathPercent();
    const criteria = criteriaSummary();
    const dates = retestDates(profile), today = new Date().toLocaleDateString("vi-VN");
    const viability = plan.feasibility;
    return `<section class="c tf-plan-dashboard"><header class="tf-plan-head"><div><p class="eyebrow">LỘ TRÌNH CỦA TÔI</p><h2>Học bước tiếp theo</h2><p class="tf-muted">Một kế hoạch linh hoạt theo kết quả và cách bạn học. Không suy đoán tuổi, giới tính hay nghề nghiệp.</p></div><div class="tf-plan-head-actions"><strong class="tf-plan-percent">${progress}%</strong><button type="button" class="tf-plan-close g" onclick="closeLearningPathMap()" aria-label="Đóng Lộ trình của tôi" title="Đóng lộ trình">×</button></div></header><progress max="100" value="${progress}" aria-label="Tiến độ nội dung lộ trình hiện có"></progress><div class="tf-summary-grid"><article class="tf-glass-card"><small>HỒ SƠ TRÌNH ĐỘ</small><h3>${result ? `${esc(result.level)} · ${esc(levelName(result.level))}` : "Chưa đủ dữ liệu"}</h3><p>${result ? `IELTS Speaking ${esc(formatSpeakingBand(qualified.speaking.o))} xấp xỉ · tin cậy ${esc(confidenceLabel(result.confidence === "high" ? "medium" : result.confidence))}.` : "Bắt đầu bài kiểm tra thích nghi; kết quả nói chỉ được tính khi có dữ liệu hợp lệ."}</p><button type="button" class="g" onclick="document.getElementById('tf-placement-card')?.scrollIntoView({behavior:'smooth'})">Làm lại bài kiểm tra</button></article><article class="tf-glass-card"><small>HIỆU QUẢ HỌC</small><h3>${statusName(effect.status)}</h3><p>${esc(effect.reason)}</p><p class="tf-muted">Trung vị hợp lệ: ${effect.medianBand == null ? "chưa đủ dữ liệu" : effect.medianBand.toFixed(1)} · Nhớ sau 1/3/7 ngày: ${[1,3,7].map(day => effect.recallRates[day] == null ? "—" : Math.round(effect.recallRates[day] * 100) + "%").join(" / ")}</p></article></div><article class="tf-glass-card tf-settings"><h3>Mục tiêu và lịch học</h3><p>${esc(viability.label)} · ${esc(viability.note)}</p><form class="tf-settings-form" onsubmit="savePlanSettings(event)"><label>Band mục tiêu <input name="target" type="number" min="1" max="9" step="0.5" value="${esc(setup.target ?? "")}" placeholder="Có thể bỏ qua"></label><label>Ngày thi <input name="examDate" type="date" value="${esc(setup.examDate || "")}"></label><label>Phút mỗi ngày <select name="minutes"><option value="5"${plan.dailyMinutes === 5 ? " selected" : ""}>5 phút</option><option value="10"${plan.dailyMinutes === 10 ? " selected" : ""}>10 phút</option><option value="20"${plan.dailyMinutes === 20 ? " selected" : ""}>20 phút</option></select></label><button type="submit">Cập nhật lộ trình</button></form><p class="tf-muted">Ước lượng thận trọng, không đảm bảo đạt band mục tiêu. ${plan.daysRemaining == null ? "Bạn có thể bỏ qua ngày thi." : `${plan.daysRemaining} ngày còn lại theo ngày thi đã nhập.`}</p></article><div class="tf-plan-grid"><article class="tf-glass-card"><h3>Bốn giai đoạn</h3><div class="tf-timeline">${stages.map((stage, index) => `<section><span>${index + 1}</span><div><b>${esc(stage.title)}</b><small>Tuần ${esc(stage.week)} · ưu tiên ${esc(skillLabel(stage.focus))}</small><p>${index === 0 ? "Xây nền qua bài học và câu ngắn." : index === 1 ? "Củng cố từ vựng, cấu trúc và ghi nhớ." : index === 2 ? "Tăng dần độ dài và luyện Part 3." : "Luyện đề tổng hợp và kiểm tra lại."}</p></div></section>`).join("")}</div></article><article class="tf-glass-card"><div class="tf-card-title"><h3>Kế hoạch hôm nay · ${today}</h3><span>${plan.dailyMinutes} phút tối đa</span></div>${todayActivities(plan)}<p class="tf-muted">Nếu hôm qua bỏ lỡ, kế hoạch tiếp tục từ bước phù hợp; không cộng dồn để tạo áp lực.</p></article></div><div class="tf-plan-grid"><article class="tf-glass-card"><h3>Hồ sơ ước tính</h3>${renderResultCard()}</article></div><article class="tf-glass-card"><h3>Đánh giá tuần</h3><p>${statusName(effect.status)} · ${esc(effect.reason)}</p><ul><li>Ưu tiên kỹ năng yếu có ít nhất hai câu trong bản đồ kỹ năng.</li><li>Ôn thẻ cách quãng: ${[1,3,7].map(day => `${day} ngày ${effect.recallRates[day] == null ? "chưa đủ dữ liệu" : Math.round(effect.recallRates[day] * 100) + "% nhớ lại"}`).join(" · ")}.</li><li>Kiểm tra mini từ ${dates.mini ? new Date(dates.mini).toLocaleDateString("vi-VN") : "sau 14 ngày kể từ lần kiểm tra đầy đủ"}; bài đầy đủ từ ${dates.full ? new Date(dates.full).toLocaleDateString("vi-VN") : "sau 8 tuần"}.</li></ul><div class="tf-criteria-grid">${criteria.map(row => `<div class="tf-criterion"><span>${esc(row.label)}</span><b>${row.score == null ? "Chưa đủ dữ liệu" : row.score.toFixed(1) + " · ước tính"}</b></div>`).join("")}</div></article><footer class="tf-privacy"><p>Hồ sơ CAT, lựa chọn đáp án và dấu hiệu thích nghi chỉ lưu trên thiết bị, không nằm trong đồng bộ đám mây. Lộ trình và điểm xuất phát của hệ thống cũ có thể đồng bộ nếu bật cloud. Không thu thập tuổi, giới tính hoặc nghề nghiệp.</p><button type="button" class="g" onclick="exportLearningData()">Xuất dữ liệu hồ sơ</button><button type="button" class="g" onclick="deleteLearningProfile()">Xóa hồ sơ kiểm tra và thích nghi</button><small>Nút xóa chỉ bỏ hồ sơ CAT, gợi ý thích nghi và kết quả bài 8 câu cũ; lịch sử điểm, thẻ, bài học và lộ trình cũ vẫn được giữ.</small></footer></section>`;
  }

  function homeLearningPlan() {
    if (learningPlanView) return renderPlanDashboard();
    return window.TFStudyHub?.homeSummary?.() || "";
  }

  function openLearningPathMap() {
    learningPlanView = true;
    tab = "home";
    openView();
  }

  function closeLearningPathMap() { learningPlanView = false; tab = "home"; openView(); }

  function recordPathChallenge(result) {
    if (result?.pathMode !== "baseline") return false;
    const item = S?.it?.[S.i], minDuration = item?.p === 2 ? 55 : 25;
    const signal = Core.englishSignal(result.text);
    const scores = result.s && [result.s.f, result.s.l, result.s.g].filter(value => Number.isFinite(value) && value >= 0 && value <= 9).length >= 2 && Number.isFinite(result.s.o) && result.s.o >= 0 && result.s.o <= 9;
    const valid = Boolean(result.blob && result.state === "ready" && result.duration >= minDuration && result.m?.voicedSeconds >= 15 && signal.words >= 12 && signal.ratio >= .7 && scores);
    const profile = state();
    const existing = profile.placement.speaking?.tasks?.findIndex(task => task.part === item?.p) ?? -1;
    const task = { part: item?.p || 1, at: Date.now(), f: scores ? result.s.f : null, l: scores ? result.s.l : null, g: scores ? result.s.g : null, p: Number.isFinite(result.s?.p) ? result.s.p : null, valid };
    task.o = scores ? result.s.o : null;
    mutate(value => {
      const tasks = [...(value.placement.speaking?.tasks || [])];
      const found = tasks.findIndex(row => row.part === task.part);
      if (found >= 0) tasks[found] = task; else tasks.push(task);
      value.placement.speaking = { at: Date.now(), tasks: tasks.sort((a, b) => a.part - b.part).slice(-3), valid: tasks.filter(row => row.valid).length >= 2 };
    });
    result.pathAccepted = valid;
    result.pathComplete = true;
    result.pathMessage = valid ? `Đã nhận bài nói Part ${task.part}; chỉ lượt có ghi âm, tín hiệu và chấm điểm hợp lệ mới góp vào hồ sơ.` : `Part ${task.part} chưa đủ dữ liệu tiếng nói có thể chấm nên sẽ không ảnh hưởng hồ sơ. Bạn có thể tiếp tục; lượt này được giữ là chưa hợp lệ.`;
    if (existing < 0) addEvent("baseline-task", { part: task.part, status: valid ? "valid" : "not-graded" });
    return valid;
  }

  function pathResultControls(result) {
    if (!result?.pathMode) return `<button class="w" onclick="nextCue()">${S.i + 1 < S.it.length ? "Câu tiếp theo" : "Xem kết quả bài luyện"} ${icon("arrow")}</button>`;
    const last = S.i + 1 >= S.it.length;
    return `<p id="path-result-status" role="status">${esc(result.pathMessage || "Đang kiểm tra dữ liệu bài nói…")}</p><button class="w" id="path-result-done" onclick="${last ? "finishPathChallenge()" : "nextCue()"}"${result.pathComplete ? "" : " disabled"}>${last ? "Xem hồ sơ và lộ trình" : "Tiếp tục Part " + (S.it[S.i + 1]?.p || "")}</button>`;
  }

  function startPathBaseline() {
    stopPracticeMedia();
    S = { mode: "baseline", it: [
      { p: 1, t: "Bài nói đầu vào · Phần 1", q: "What do you usually do to relax after a busy day?", k: 0, pathChallenge: true },
      { p: 2, t: "Bài nói đầu vào · Phần 2", q: "Describe a skill you learned that has been useful to you. Explain how you learned it and why it matters.", k: 0, pathChallenge: true },
      { p: 3, t: "Bài nói đầu vào · Phần 3", q: "Why do people need to keep learning new skills throughout life?", k: 0, pathChallenge: true }
    ], i: 0, res: [], result: null };
    addEvent("baseline-start", { tab: "prac" });
    tab = "prac";
    openView();
  }

  function finishPathChallenge() {
    if (!S?.result?.pathComplete) return;
    const valid = state().placement.speaking?.tasks?.filter(row => row.valid) || [];
    stopPracticeMedia();
    if (valid.length) {
      const mean = key => valid.map(row => row[key]).filter(Number.isFinite).reduce((sum, value, _, list) => sum + value / list.length, 0);
      updatePathSetup({ done: true, deferred: false, step: 2, baseline: { o: mean("o"), f: mean("f"), l: mean("l"), g: mean("g"), at: Date.now() } });
    }
    S = null;
    learningPlanView = true;
    tab = "home";
    openView();
  }

  function exportLearningData() {
    const profile = state();
    const payload = {
      exportedAt: new Date().toISOString(),
      note: "Local export of placement/adaptation profile and existing path setup. Transcript text and audio are omitted.",
      learningProfileV2: profile,
      learningPath: st.learningPath
    };
    const url = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" }));
    const anchor = document.createElement("a"); anchor.href = url; anchor.download = "taylorflow-learning-profile.json"; anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function deleteLearningProfile() {
    if (!confirm("Xóa hồ sơ CAT, dấu hiệu thích nghi và kết quả bài kiểm tra 8 câu cũ trên thiết bị này? Lịch sử điểm, thẻ, bài học và lộ trình cũ sẽ được giữ.")) return;
    try { localStorage.removeItem("tf-placement-v1"); } catch {}
    mutate(value => {
      value.placement = { assessmentCount: 0, exposure: {}, active: null, latest: null, history: [], legacy: null, speaking: null, speakingTest: null };
      value.events = []; value.aggregates = { totals: { sessions: 0, minutes: 0, retries: 0, abandoned: 0, scores: 0 }, weeks: [] };
      value.adaptive = { mode: "examples", modeUpdated: 0, manual: false, methods: Object.fromEntries(Core.METHODS.map(method => [method, { trials: 0, reward: 0 }])), recall: { 1: { seen: 0, remembered: 0 }, 3: { seen: 0, remembered: 0 }, 7: { seen: 0, remembered: 0 } }, outcomes: [] };
    });
    render();
  }

  function rewardOutcome(method, reward, source) {
    if (!Core.METHODS.includes(method) || !Number.isFinite(reward)) return;
    mutate(value => {
      const row = value.adaptive.methods[method];
      row.trials = Math.min(10000, row.trials + 1);
      row.reward = Math.min(10000, row.reward + Math.max(0, Math.min(1, reward)));
      value.adaptive.outcomes.push({ at: Date.now(), method, reward: Math.max(0, Math.min(1, reward)), source });
      value.adaptive.outcomes = value.adaptive.outcomes.slice(-60);
    });
  }

  function noteRecall(card, grade) {
    if (!card || !Number.isFinite(card.interval) || card.interval <= 0) return;
    const priorReviewAt = Number(card.due) - Number(card.interval) * DAY;
    const elapsedDays = (Date.now() - priorReviewAt) / DAY;
    const bin = [1, 3, 7].find(day => elapsedDays >= day * .65 && elapsedDays <= day * 1.55);
    if (!bin) return;
    const remembered = grade === "good" || grade === "easy";
    let method = state().adaptive.mode;
    mutate(value => {
      const row = value.adaptive.recall[bin]; row.seen += 1; if (remembered) row.remembered += 1;
    });
    rewardOutcome(method, remembered ? 1 : 0, "spaced-recall-" + bin + "d");
    addEvent("recall", { grade: remembered ? "remembered" : "forgotten", count: bin });
  }

  // Keep the old setup, navigation and scoring functions; only replace their view hooks.
  window.openLearningPathMap = openLearningPathMap;
  window.closeLearningPathMap = closeLearningPathMap;
  window.homeLearningPlan = homeLearningPlan;
  window.startPlacement = startPlacement;
  window.recordPlacementSpeakingTest = recordPlacementSpeakingTest;
  window.placementProfileReady = () => qualifiedProfile(state()).ready;
  window.pausePlacement = pausePlacement;
  window.cancelPlacement = cancelPlacement;
  window.answerPlacement = answerPlacement;
  window.continuePlacement = continuePlacement;
  window.savePlanSettings = savePlanSettings;
  window.changeLearningMode = changeLearningMode;
  window.exportLearningData = exportLearningData;
  window.deleteLearningProfile = deleteLearningProfile;
  window.startPathBaseline = startPathBaseline;
  window.recordPathChallenge = recordPathChallenge;
  window.pathResultControls = pathResultControls;
  window.finishPathChallenge = finishPathChallenge;
  window.adaptiveLearningInsight = () => {
    const insight = coachInsight(); return { title: insight.display, detail: insight.why, focus: insight.focus };
  };

  const oldProfilePage = window.profilePage;
  window.profilePage = function () {
    const old = typeof oldProfilePage === "function" ? oldProfilePage() : "";
    return old + `<section class="c tf-profile-route"><p class="eyebrow">LỘ TRÌNH CỦA TÔI</p><h2>Hồ sơ trình độ và kế hoạch học</h2><p>Ước lượng trình độ, kế hoạch từng giai đoạn và cách học phù hợp theo hoạt động.</p><button type="button" onclick="openLearningPathMap()">Mở lộ trình của tôi →</button></section>`;
  };

  const oldOpenView = window.openView;
  window.openView = function () {
    const nextTab = tab;
    if (routeTab !== nextTab) {
      if (routeTab && routeStartedAt && !routeFinished) {
        const duration = Math.max(0, Date.now() - routeStartedAt);
        addEvent("study-session", { tab: routeTab, hour: new Date(routeStartedAt).getHours() }, duration);
        if (routeTab === "prac" && S?.mode !== "exam" && !S?.result) addEvent("abandoned", { tab: routeTab, part: S?.it?.[S.i]?.p || 0 }, duration);
      }
      routeTab = nextTab;
      routeStartedAt = ["prac", "les", "col", "voc", "games"].includes(nextTab) ? Date.now() : 0;
      routeFinished = false;
      if (routeStartedAt) addEvent("session-open", { tab: nextTab, hour: new Date(routeStartedAt).getHours(), part: S?.it?.[S.i]?.p || 0 });
    }
    return oldOpenView.apply(this, arguments);
  };

  window.addEventListener("pagehide", () => {
    if (routeStartedAt && !routeFinished) {
      addEvent("study-session", { tab: routeTab, hour: new Date(routeStartedAt).getHours() }, Math.max(0, Date.now() - routeStartedAt));
      routeFinished = true;
    }
  });

  if (typeof window.retryCurrentAnswer === "function") {
    const oldRetry = window.retryCurrentAnswer;
    window.retryCurrentAnswer = function () { addEvent("retry", { tab, part: S?.it?.[S.i]?.p || 0 }); return oldRetry.apply(this, arguments); };
  }

  if (typeof window.rateFlashcard === "function") {
    const oldRate = window.rateFlashcard;
    window.rateFlashcard = function (grade) {
      const card = window.review?.queue?.[0] ? { ...window.review.queue[0] } : null;
      const result = oldRate.apply(this, arguments);
      noteRecall(card, grade);
      return result;
    };
  }

  try { state(); } catch {}
  if (typeof window.render === "function") window.render();
})(window);
