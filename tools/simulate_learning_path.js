#!/usr/bin/env node
"use strict";

const Core = require("../assets/placement/learning-core.js");
const DAY = Core.DAY;
const NOW = Date.UTC(2026, 10, 18);
const PERSONAS = [
  { id: "binge", minutes: 20, level: "B1", target: 7, days: 120, weak: ["past-simple", "article", "collocation"], behavior: "binge" },
  { id: "short-regular", minutes: 5, level: "A2", target: 5.5, days: 180, weak: ["preposition", "word-form", "fluency"], behavior: "short" },
  { id: "speaking-avoidant", minutes: 10, level: "B1", target: 6, days: 150, weak: ["fluency", "article", "topic-vocabulary"], behavior: "avoid" },
  { id: "perfectionist", minutes: 20, level: "B2", target: 7.5, days: 90, weak: ["conditionals", "collocation", "coherence"], behavior: "retry" },
  { id: "easily-discouraged", minutes: 5, level: "A1", target: 5, days: 210, weak: ["past-simple", "preposition", "topic-vocabulary"], behavior: "abandon" },
  { id: "game-preferring", minutes: 10, level: "A2", target: 6, days: 180, weak: ["article", "collocation", "word-form"], behavior: "game" },
  { id: "five-minutes", minutes: 5, level: "B1", target: 6, days: 120, weak: ["fluency", "article", "preposition"], behavior: "short" },
  { id: "quick-forgetting", minutes: 10, level: "B1", target: 6.5, days: 180, weak: ["collocation", "word-form", "past-simple"], behavior: "forget" },
  { id: "already-strong", minutes: 20, level: "C1", target: 8, days: 90, weak: ["coherence", "idiom-register", "precision"], behavior: "steady" },
  { id: "complete-beginner", minutes: 5, level: "A1", target: 6.5, days: 30, weak: ["articles", "be-verb", "basic-vocabulary"], behavior: "short" },
  { id: "tight-deadline", minutes: 20, level: "A2", target: 7.5, days: 28, weak: ["tense", "fluency", "collocation"], behavior: "steady" },
  { id: "steady-worker", minutes: 10, level: "B2", target: 7, days: 180, weak: ["topic-vocabulary", "preposition", "coherence"], behavior: "steady" }
];

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
function dateAfter(days) {
  return new Date(NOW + days * DAY).toISOString().slice(0, 10);
}
function sampleEvents(persona) {
  if (persona.behavior === "short") return Array.from({ length: 4 }, (_, i) => ({ type: "study-session", at: NOW - i * DAY, durationMs: 4 * 60000, meta: {} }));
  if (persona.behavior === "retry") return Array.from({ length: 4 }, (_, i) => ({ type: "retry", at: NOW - i * DAY, durationMs: 0, meta: {} }));
  if (persona.behavior === "abandon") return Array.from({ length: 2 }, (_, i) => ({ type: "abandoned", at: NOW - i * DAY, durationMs: 0, meta: {} }));
  return [];
}

function main() {
  let planChecks = 0, weeklyFocusPasses = 0, impossibleTagged = 0, maxDecisionMs = 0, stableModePasses = 0;
  const reports = [];
  for (const persona of PERSONAS) {
    const setup = { minutes: persona.minutes, target: persona.target, examDate: dateAfter(persona.days) };
    const profile = Core.cleanProfile({ events: sampleEvents(persona) }, NOW);
    const modes = { mode: "examples", modeUpdated: NOW - 8 * DAY, manual: false, methods: {}, outcomes: [] };
    let previousMode = Core.chooseMode(modes, NOW - 8 * DAY), switches = 0;
    const weekSkills = [], timings = [];
    for (let day = 0; day < 60; day += 1) {
      const started = process.hrtime.bigint();
      const plan = Core.makePlan({ setup, level: persona.level, weakSkills: persona.weak, dailyMinutes: persona.minutes, anchorAt: NOW, now: NOW + day * DAY });
      const insight = Core.behaviorSuggestion(profile, NOW + day * DAY);
      timings.push(Number(process.hrtime.bigint() - started) / 1e6);
      const budget = persona.minutes;
      assert(plan.dailyMinutes <= budget * 1.25, `${persona.id}: plan exceeds daily time budget`);
      const schedule = plan.todayActivities;
      const scheduledMinutes = schedule.reduce((sum, row) => sum + row.minutes, 0);
      assert(scheduledMinutes <= budget * 1.25, `${persona.id}: activity minutes exceed daily budget`);
      if (day < 7) weekSkills.push(...schedule.map(row => row.skill));
      if (persona.target - ({ A1: 2.75, A2: 3.5, B1: 4.75, B2: 5.75, C1: 6.75, C2: 7.75 })[persona.level] >= 1.5 && persona.days < 60) {
        assert(plan.feasibility.label === "chưa thực tế", `${persona.id}: unrealistic target was not flagged`);
        impossibleTagged += 1;
      }
      const mode = insight.mode;
      if (mode !== previousMode) switches += 1;
      previousMode = mode;
      if (day > 0 && day % 7 === 0) assert(switches <= Math.ceil(day / 7), `${persona.id}: learning mode oscillates too often`);
      planChecks += 1;
    }
    const weakSet = new Set(persona.weak.slice(0, 3));
    const targeted = weekSkills.filter(skill => weakSet.has(skill)).length / Math.max(1, weekSkills.length);
    if (targeted >= .7) weeklyFocusPasses += 1;
    const p95 = [...timings].sort((a, b) => a - b)[Math.floor(timings.length * .95)];
    maxDecisionMs = Math.max(maxDecisionMs, p95);
    const tagged = Core.assessFeasibility(persona.level, persona.target, persona.days);
    reports.push({ id: persona.id, dailyMinutes: persona.minutes, weakSkillShareWeek1: Number(targeted.toFixed(2)), feasibility: tagged.label, p95DecisionMs: Number(p95.toFixed(3)) });
    stableModePasses += 1;
  }
  assert(planChecks === PERSONAS.length * 60, "Expected 12 personas × 60 days");
  assert(weeklyFocusPasses >= Math.ceil(PERSONAS.length * .7), "Less than 70% of plans target weak skills");
  assert(impossibleTagged > 0, "No impossible goals were flagged");
  assert(maxDecisionMs < 50, "Adaptive decision exceeded 50 ms");
  const timelineSetup = { minutes: 5, target: 6, examDate: dateAfter(56) };
  const firstDay = Core.makePlan({ setup: timelineSetup, level: "B1", weakSkills: ["article"], dailyMinutes: 5, anchorAt: NOW, now: NOW });
  const secondDay = Core.makePlan({ setup: timelineSetup, level: "B1", weakSkills: ["article"], dailyMinutes: 5, anchorAt: NOW, now: NOW + DAY });
  const fourthWeek = Core.makePlan({ setup: timelineSetup, level: "B1", weakSkills: ["article"], dailyMinutes: 5, anchorAt: NOW, now: NOW + 42 * DAY });
  assert(firstDay.activeStageIndex === 0 && fourthWeek.activeStageIndex === 3, "Plan stages do not advance with elapsed weeks");
  assert(firstDay.todayActivities[0].kind !== secondDay.todayActivities[0].kind, "Daily activities do not rotate after a missed day");
  console.log(JSON.stringify({ personas: PERSONAS.length, simulatedDays: 60, planDecisions: planChecks, weekOneWeakFocus: `${weeklyFocusPasses}/${PERSONAS.length}`, impossibleGoalsTagged: impossibleTagged, maxP95DecisionMs: Number(maxDecisionMs.toFixed(3)), stableModePersonas: stableModePasses, stageTimeline: `${firstDay.activeStageIndex}→${fourthWeek.activeStageIndex}`, dailyRotation: `${firstDay.todayActivities[0].kind}→${secondDay.todayActivities[0].kind}`, details: reports }, null, 2));
  console.log("D2/D4 PASS");
}

main();
