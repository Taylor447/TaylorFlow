(function (root, factory) {
  "use strict";
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.TFPlacementCAT = api;
})(typeof globalThis === "object" ? globalThis : this, function () {
  "use strict";

  const LEVELS = Object.freeze(["A1", "A2", "B1", "B2", "C1", "C2"]);
  const LEVEL_DIFFICULTY = Object.freeze({ A1: -5, A2: -2.5, B1: 0, B2: 2.5, C1: 5, C2: 7.5 });
  const LEVEL_BOUNDARIES = Object.freeze([-3.75, -1.25, 1.25, 3.75, 6.25]);
  const CONFIG = Object.freeze({
    minQuestions: 12,
    maxQuestions: 20,
    targetSE: 0.9,
    priorMean: 0,
    priorSD: 3.5,
    levelPriorSD: 1,
    gridMin: -8,
    gridMax: 10,
    gridStep: 0.04,
    guessRate: 0.2,
    slipRate: 0.05,
    optionCount: 4,
    maxExposureRate: 0.35
  });

  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  const logistic = value => 1 / (1 + Math.exp(-clamp(value, -30, 30)));
  const cleanLevel = value => LEVELS.includes(value) ? value : "B1";
  const difficultyOf = item => Number.isFinite(item?.difficulty) ? item.difficulty : LEVEL_DIFFICULTY[cleanLevel(item?.level)];
  const normalize = value => String(value ?? "").normalize("NFKC").toLocaleLowerCase("en").trim().replace(/\s+/g, " ");

  // Fixed guessing and slip components keep random selections from inflating ability estimates.
  function probabilityCorrect(theta, difficulty, config = CONFIG) {
    const abilityProbability = logistic(theta - difficulty);
    return config.guessRate * (1 / config.optionCount) +
      (1 - config.guessRate) * (1 - config.slipRate) * abilityProbability;
  }

  function posteriorFor(answers, config = CONFIG) {
    const grid = [];
    for (let theta = config.gridMin; theta <= config.gridMax + 1e-9; theta += config.gridStep) grid.push(theta);
    const logWeights = grid.map(theta => {
      const priorComponents = Object.values(LEVEL_DIFFICULTY).map(center => -0.5 * ((theta - center) / config.levelPriorSD) ** 2);
      const maxPrior = Math.max(...priorComponents);
      let logWeight = maxPrior + Math.log(priorComponents.reduce((sum, value) => sum + Math.exp(value - maxPrior), 0));
      for (const answer of answers) {
        if (answer.unknown) continue;
        const p = clamp(probabilityCorrect(theta, answer.difficulty, config), 1e-8, 1 - 1e-8);
        logWeight += answer.correct ? Math.log(p) : Math.log(1 - p);
      }
      return logWeight;
    });
    const maxLog = Math.max(...logWeights);
    const weights = logWeights.map(value => Math.exp(value - maxLog));
    const total = weights.reduce((sum, value) => sum + value, 0) || 1;
    const mean = grid.reduce((sum, theta, index) => sum + theta * weights[index], 0) / total;
    const variance = grid.reduce((sum, theta, index) => sum + ((theta - mean) ** 2) * weights[index], 0) / total;
    return { theta: clamp(mean, config.gridMin, config.gridMax), se: Math.sqrt(Math.max(0, variance)) };
  }

  function createSession(options = {}) {
    const now = Number.isFinite(options.now) ? options.now : Date.now();
    const id = typeof options.id === "string" && options.id ? options.id : `cat-${now.toString(36)}`;
    const priorMean = Number.isFinite(options.theta) ? options.theta : CONFIG.priorMean;
    const priorSD = Number.isFinite(options.se) && options.se > 0 ? options.se : CONFIG.priorSD;
    return {
      schemaVersion: 1,
      id,
      status: "active",
      theta: priorMean,
      se: priorSD,
      startedAt: now,
      updatedAt: now,
      questionIds: [],
      answers: [],
      skillStats: {},
      completedAt: null
    };
  }

  function isComplete(session, config = CONFIG) {
    if (!session || !Array.isArray(session.answers)) return true;
    if (session.status === "paused" || session.status === "complete") return true;
    const count = session.answers.length;
    return count >= config.maxQuestions || (count >= config.minQuestions && session.se <= config.targetSE);
  }

  function exposureRate(item, exposure = {}, assessmentCount = 0) {
    if (assessmentCount <= 0) return 0;
    return (Number(exposure[item.id]) || 0) / assessmentCount;
  }

  function itemInformation(theta, difficulty, config = CONFIG) {
    const p = clamp(probabilityCorrect(theta, difficulty, config), 1e-8, 1 - 1e-8);
    const base = logistic(theta - difficulty);
    const derivative = (1 - config.guessRate) * (1 - config.slipRate) * base * (1 - base);
    return (derivative * derivative) / (p * (1 - p));
  }

  function selectNext(bank, session, exposure = {}, options = {}) {
    const config = { ...CONFIG, ...(options.config || {}) };
    if (isComplete(session, config)) return { done: true, reason: session.answers.length >= config.maxQuestions ? "max-questions" : "precision" };
    const asked = new Set(session.questionIds || []);
    const available = (Array.isArray(bank) ? bank : []).filter(item => item && typeof item.id === "string" && !asked.has(item.id) && LEVELS.includes(item.level));
    if (!available.length) return { done: true, reason: "bank-exhausted" };

    const completedAssessments = Math.max(0, Number(options.assessmentCount) || 0);
    const cap = Number.isFinite(options.maxExposureRate) ? options.maxExposureRate : config.maxExposureRate;
    const exposureSafe = available.filter(item => exposureRate(item, exposure, completedAssessments) < cap);
    const pool = exposureSafe.length ? exposureSafe : available;
    const scored = pool.map(item => ({
      item,
      information: itemInformation(session.theta, difficultyOf(item), config),
      exposures: Number(exposure[item.id]) || 0
    }));
    scored.sort((a, b) => b.information - a.information || a.exposures - b.exposures || String(a.item.id).localeCompare(String(b.item.id)));
    return { done: false, item: scored[0].item, targetDifficulty: difficultyOf(scored[0].item) };
  }

  function update(session, item, response, options = {}) {
    if (!session || !item || !Array.isArray(session.answers)) throw new TypeError("A CAT session and item are required.");
    if (session.status === "paused" || session.status === "complete") throw new Error("This CAT session is not active.");
    if (session.questionIds.includes(item.id)) throw new Error(`Question already answered in this session: ${item.id}`);

    const now = Number.isFinite(options.now) ? options.now : Date.now();
    const value = response && typeof response === "object" ? response : { choice: response };
    const unknown = value.unknown === true;
    const choice = value.choice;
    const selected = Number.isInteger(choice) && choice >= 0 && choice < item.options?.length ? item.options[choice] : choice;
    const correct = !unknown && normalize(selected) === normalize(item.key);
    const answer = {
      itemId: item.id,
      level: item.level,
      skills: Array.isArray(item.skill) ? [...item.skill] : [],
      choice: unknown ? null : Number.isInteger(choice) && choice >= 0 && choice < item.options?.length ? choice : null,
      correct,
      unknown,
      spentMs: Number.isFinite(value.spentMs) ? Math.max(0, Math.round(value.spentMs)) : null,
      difficulty: difficultyOf(item),
      answeredAt: now
    };
    const answers = [...session.answers, answer];
    const estimate = posteriorFor(answers, options.config || CONFIG);
    const skillStats = { ...(session.skillStats || {}) };
    for (const skill of answer.skills) {
      const previous = skillStats[skill] || { attempts: 0, correct: 0, unknown: 0 };
      skillStats[skill] = {
        attempts: previous.attempts + (unknown ? 0 : 1),
        correct: previous.correct + (correct ? 1 : 0),
        unknown: previous.unknown + (unknown ? 1 : 0)
      };
    }
    const next = {
      ...session,
      theta: estimate.theta,
      se: estimate.se,
      updatedAt: now,
      questionIds: [...session.questionIds, item.id],
      answers,
      skillStats
    };
    if (isComplete(next, options.config || CONFIG)) {
      next.status = "complete";
      next.completedAt = now;
    }
    return next;
  }

  function pause(session, now = Date.now()) {
    if (!session || session.status === "complete") return session;
    return { ...session, status: "paused", updatedAt: now };
  }

  function resume(session, now = Date.now()) {
    if (!session || session.status !== "paused") return session;
    return { ...session, status: "active", updatedAt: now };
  }

  function cefrPosition(theta) {
    const points = [-6.25, ...Object.values(LEVEL_DIFFICULTY), 8.75];
    const values = [0, 0, 1, 2, 3, 4, 5, 5];
    const x = clamp(theta, points[0], points[points.length - 1]);
    for (let index = 1; index < points.length; index += 1) {
      if (x <= points[index]) {
        const ratio = (x - points[index - 1]) / (points[index] - points[index - 1]);
        return values[index - 1] + (values[index] - values[index - 1]) * ratio;
      }
    }
    return 5;
  }

  function levelIndex(theta) {
    let index = 0;
    for (const boundary of LEVEL_BOUNDARIES) if (theta >= boundary) index += 1;
    return clamp(index, 0, LEVELS.length - 1);
  }

  function profile(session) {
    if (!session) return { level: "B1", cefrPosition: 2, confidence: "low", interval: ["A1", "C2"] };
    const idx = levelIndex(session.theta);
    const lower = levelIndex(session.theta - 1.96 * session.se);
    const upper = levelIndex(session.theta + 1.96 * session.se);
    const confidence = session.se <= 0.45 ? "high" : session.se <= 0.72 ? "medium" : "low";
    return {
      level: LEVELS[idx],
      cefrPosition: cefrPosition(session.theta),
      theta: session.theta,
      se: session.se,
      confidence,
      interval: [LEVELS[lower], LEVELS[upper]],
      answered: session.answers.filter(answer => !answer.unknown).length,
      unknown: session.answers.filter(answer => answer.unknown).length,
      asked: session.answers.length
    };
  }

  function skillHeatmap(session, minAttempts = 2) {
    const stats = session?.skillStats || {};
    return Object.entries(stats).map(([skill, value]) => {
      const attempts = Number(value?.attempts) || 0;
      const correct = Number(value?.correct) || 0;
      return {
        skill,
        attempts,
        unknown: Number(value?.unknown) || 0,
        accuracy: attempts ? correct / attempts : null,
        status: attempts < minAttempts ? "insufficient" : correct / attempts >= 0.75 ? "strong" : correct / attempts <= 0.45 ? "priority" : "developing"
      };
    }).sort((a, b) => (a.accuracy ?? -1) - (b.accuracy ?? -1) || a.skill.localeCompare(b.skill));
  }

  return Object.freeze({
    LEVELS,
    LEVEL_DIFFICULTY,
    CONFIG,
    createSession,
    difficultyOf,
    isComplete,
    probabilityCorrect,
    selectNext,
    update,
    pause,
    resume,
    profile,
    skillHeatmap,
    cefrPosition,
    levelIndex
  });
});
