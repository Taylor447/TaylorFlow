#!/usr/bin/env node
"use strict";

const CAT = require("../assets/placement/cat.js");
const TARGETS = { A1: 40, A2: 55, B1: 65, B2: 65, C1: 50, C2: 25 };
const POPULATION = 1000;
const SEED = 0x54a71f03;
const targetArg = process.argv.find(value => value.startsWith("--target-se="));
const SIM_CONFIG = { ...CAT.CONFIG, targetSE: targetArg ? Number(targetArg.split("=")[1]) : CAT.CONFIG.targetSE };

function randomGenerator(seed) {
  let value = seed >>> 0;
  return function random() {
    value += 0x6D2B79F5;
    let t = value;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function normal(random) {
  const u = Math.max(1e-12, random());
  const v = random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

function syntheticBank() {
  return Object.entries(TARGETS).flatMap(([level, count]) => Array.from({ length: count }, (_, index) => ({
    id: `sim-${level.toLowerCase()}-${String(index + 1).padStart(3, "0")}`,
    level,
    skill: [index % 2 ? "sim-grammar" : "sim-vocabulary"],
    options: ["A", "B", "C", "D"],
    key: "A"
  })));
}

function simulatedResponse(theta, difficulty, random) {
  if (random() < 0.05) return 1 + Math.floor(random() * 3);
  if (random() < 0.20) return Math.floor(random() * 4);
  const p = 1 / (1 + Math.exp(-(theta - difficulty)));
  return random() < p ? 0 : 1 + Math.floor(random() * 3);
}

function levelPosition(theta) {
  return CAT.cefrPosition(theta);
}

function runAssessment(person, attempt, theta, bank, exposure, completedAssessments, random) {
  let session = CAT.createSession({ id: `person-${person}-attempt-${attempt}`, now: person * 100 + attempt });
  while (!CAT.isComplete(session, SIM_CONFIG)) {
    const next = CAT.selectNext(bank, session, exposure, { assessmentCount: completedAssessments, config: SIM_CONFIG });
    if (next.done) break;
    const choice = simulatedResponse(theta, next.targetDifficulty, random);
    session = CAT.update(session, next.item, { choice, spentMs: 4000 + Math.floor(random() * 9000) }, { now: session.updatedAt + 1000, config: SIM_CONFIG });
    exposure[next.item.id] = (exposure[next.item.id] || 0) + 1;
  }
  return session;
}

function main() {
  const random = randomGenerator(SEED);
  const bank = syntheticBank();
  const exposure = Object.create(null);
  const levels = Object.keys(TARGETS);
  const firstRuns = [];
  const secondRuns = [];
  let completedAssessments = 0;
  let totalQuestions = 0;
  let withinHalfLevel = 0;
  let repeatable = 0;

  for (let person = 0; person < POPULATION; person += 1) {
    const level = levels[person % levels.length];
    const theta = CAT.LEVEL_DIFFICULTY[level] + normal(random) * 0.28;
    const first = runAssessment(person, 1, theta, bank, exposure, completedAssessments, random);
    completedAssessments += 1;
    const second = runAssessment(person, 2, theta, bank, exposure, completedAssessments, random);
    completedAssessments += 1;
    firstRuns.push({ level, theta, session: first });
    secondRuns.push({ level, theta, session: second });
    totalQuestions += first.answers.length + second.answers.length;

    for (const result of [first, second]) {
      const distance = Math.abs(levelPosition(result.theta) - levelPosition(theta));
      if (distance <= 0.5) withinHalfLevel += 1;
    }
    if (Math.abs(CAT.levelIndex(first.theta) - CAT.levelIndex(second.theta)) <= 1) repeatable += 1;
  }

  const attempts = POPULATION * 2;
  const meanQuestions = totalQuestions / attempts;
  const accuracy = withinHalfLevel / attempts;
  const repeatability = repeatable / POPULATION;
  const maxExposure = Math.max(...Object.values(exposure));
  const exposureRate = maxExposure / attempts;
  const summary = {
    syntheticLearners: POPULATION,
    assessments: attempts,
    meanQuestions: Number(meanQuestions.toFixed(2)),
    withinHalfLevel: Number((accuracy * 100).toFixed(1)),
    retestSameOrAdjacent: Number((repeatability * 100).toFixed(1)),
    maxQuestionExposure: Number((exposureRate * 100).toFixed(2)),
    maxQuestionAppearances: maxExposure,
    questionBank: bank.length,
    limits: { targetSE: SIM_CONFIG.targetSE, meanQuestionsAtMost: 16, withinHalfLevelAtLeast: 85, retestAtLeast: 90, exposureAtMost: 35 }
  };
  console.log(JSON.stringify(summary, null, 2));
  const passed = meanQuestions <= 16 && accuracy >= 0.85 && repeatability >= 0.9 && exposureRate <= 0.35;
  console.log(passed ? "D1 PASS" : "D1 NEEDS CALIBRATION");
  if (!passed) process.exitCode = 1;
}

main();