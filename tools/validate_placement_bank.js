#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const bankDir = path.join(root, "assets", "placement");
const targets = Object.freeze({ A1: 40, A2: 55, B1: 65, B2: 65, C1: 50, C2: 25 });
const levels = Object.keys(targets);
const types = new Set([
  "multiple-choice",
  "gap-fill",
  "error-correction",
  "word-form",
  "collocation",
  "word-meaning"
]);
const fields = ["id", "type", "level", "skill", "stem", "options", "key", "why", "reviewed"];
// Provisional Rasch b priors derived from CEFR level; future data may recalibrate them.
const levelDifficultyPrior = Object.freeze({ A1: -5, A2: -2.5, B1: 0, B2: 2.5, C1: 5, C2: 7.5 });
const completeMode = process.argv.includes("--complete");
const errors = [];
const counts = Object.fromEntries(levels.map((level) => [level, 0]));
const answerPositions = Object.fromEntries(levels.map((level) => [level, [0, 0, 0, 0]]));
const ids = new Map();
const stems = new Map();
let fileCount = 0;

function error(message) {
  errors.push(message);
}

function normalizeText(value) {
  return value.normalize("NFKC").toLocaleLowerCase("en").replace(/[\p{P}\p{S}\s]+/gu, " ").trim();
}

function hasForbiddenPlaceholder(value) {
  return /\.{3}|…|\bTODO\b|\betc\./iu.test(value);
}

function countSentences(value) {
  const endings = value.match(/[.!?]+(?=\s|$)/gu);
  return endings?.length || (value.trim() ? 1 : 0);
}

function inspectQuestion(question, fileName, level, index) {
  const where = `${fileName} question ${index + 1}`;
  if (!question || typeof question !== "object" || Array.isArray(question)) {
    error(`${where}: must be an object`);
    return;
  }

  const actualFields = Object.keys(question).sort();
  const expectedFields = [...fields].sort();
  if (JSON.stringify(actualFields) !== JSON.stringify(expectedFields)) {
    const missing = expectedFields.filter((field) => !actualFields.includes(field));
    const extra = actualFields.filter((field) => !expectedFields.includes(field));
    if (missing.length) error(`${where}: missing fields ${missing.join(", ")}`);
    if (extra.length) error(`${where}: unexpected fields ${extra.join(", ")}`);
  }

  if (typeof question.id !== "string" || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(question.id)) {
    error(`${where}: id must be a stable lowercase slug`);
  } else if (ids.has(question.id)) {
    error(`${where}: duplicate id ${question.id}; first seen in ${ids.get(question.id)}`);
  } else {
    ids.set(question.id, fileName);
  }

  if (!types.has(question.type)) error(`${where}: unsupported type ${String(question.type)}`);
  if (question.level !== level) error(`${where}: level ${String(question.level)} does not match file level ${level}`);
  if (!Array.isArray(question.skill) || question.skill.length === 0 || question.skill.some((tag) => typeof tag !== "string" || !/^[a-z][a-z0-9-]{1,39}$/u.test(tag))) {
    error(`${where}: skill must be a non-empty array of lowercase tags`);
  } else if (new Set(question.skill).size !== question.skill.length) {
    error(`${where}: skill tags must be unique`);
  }

  if (typeof question.stem !== "string" || !question.stem.trim()) {
    error(`${where}: stem must be non-empty text`);
  } else {
    if (hasForbiddenPlaceholder(question.stem)) error(`${where}: forbidden placeholder in stem`);
    const normalized = normalizeText(question.stem);
    if (stems.has(normalized)) error(`${where}: duplicate stem; first seen in ${stems.get(normalized)}`);
    else stems.set(normalized, fileName);
  }

  if (!Array.isArray(question.options) || question.options.length !== 4 || question.options.some((option) => typeof option !== "string" || !option.trim())) {
    error(`${where}: options must contain exactly four non-empty strings`);
  } else {
    const normalizedOptions = question.options.map(normalizeText);
    if (new Set(normalizedOptions).size !== 4) error(`${where}: options must be distinct`);
    if (typeof question.key !== "string" || !question.key.trim()) {
      error(`${where}: key must be the exact text of one option`);
    } else {
      const matches = question.options.map((option) => normalizeText(option) === normalizeText(question.key));
      if (matches.filter(Boolean).length !== 1) error(`${where}: key must match exactly one option`);
      else answerPositions[level][matches.indexOf(true)] += 1;
    }
  }

  if (typeof question.why !== "string" || !question.why.trim()) {
    error(`${where}: why must contain a Vietnamese explanation`);
  } else {
    if (hasForbiddenPlaceholder(question.why)) error(`${where}: forbidden placeholder in why`);
    if (countSentences(question.why) > 2) error(`${where}: why must be no more than two sentences`);
  }
  if (typeof question.reviewed !== "boolean") error(`${where}: reviewed must be a boolean AI review status`);
  if (question.level === level) counts[level] += 1;
}

function loadChunk(fileName) {
  const match = fileName.match(/^bank-(A1|A2|B1|B2|C1|C2)-(\d+)\.js$/u);
  if (!match) {
    error(`${fileName}: filename must use bank-<A1|A2|B1|B2|C1|C2>-<number>.js`);
    return;
  }
  const expectedLevel = match[1];
  const source = fs.readFileSync(path.join(bankDir, fileName), "utf8");
  let registrationCount = 0;
  let registration = null;
  const sandbox = {
    window: {
      TFPlacementBank: {
        register(level, questions) {
          registrationCount += 1;
          registration = { level, questions };
        }
      }
    }
  };
  try {
    vm.runInNewContext(source, sandbox, {
      filename: fileName,
      timeout: 1000,
      codeGeneration: { strings: false, wasm: false }
    });
  } catch (cause) {
    error(`${fileName}: JavaScript syntax/runtime error: ${cause.message}`);
    return;
  }
  if (registrationCount !== 1) {
    error(`${fileName}: must register exactly once with window.TFPlacementBank.register(level, questions)`);
    return;
  }
  if (registration.level !== expectedLevel) error(`${fileName}: registration level must be ${expectedLevel}`);
  if (!Array.isArray(registration.questions)) {
    error(`${fileName}: registered questions must be an array`);
    return;
  }
  if (registration.questions.length < 1 || registration.questions.length > 40) error(`${fileName}: each file must contain 1–40 questions`);
  if (registration.questions.length > targets[expectedLevel]) error(`${fileName}: chunk exceeds the full ${expectedLevel} quota`);
  for (const [index, question] of registration.questions.entries()) inspectQuestion(question, fileName, expectedLevel, index);
  fileCount += 1;
}

function main() {
  if (!fs.existsSync(bankDir)) {
    if (completeMode) error("assets/placement does not exist; the complete bank is not present");
    else console.log("No placement bank chunks yet; validator/schema is ready, content has not been checked.");
  } else {
    const files = fs.readdirSync(bankDir, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.startsWith("bank-") && entry.name.endsWith(".js"))
      .map((entry) => entry.name)
      .sort();
    if (files.length === 0) {
      if (completeMode) error("No bank-<level>-<number>.js chunks found");
      else console.log("No placement bank chunks yet; validator/schema is ready, content has not been checked.");
    }
    for (const fileName of files) loadChunk(fileName);
  }

  for (const level of levels) {
    if (counts[level] > targets[level]) error(`${level}: ${counts[level]} questions exceed quota ${targets[level]}`);
    if (completeMode && counts[level] !== targets[level]) error(`${level}: expected ${targets[level]} questions, found ${counts[level]}`);
    if (completeMode && counts[level] > 0) {
      const total = answerPositions[level].reduce((sum, value) => sum + value, 0);
      for (let position = 0; position < 4; position += 1) {
        const percent = (answerPositions[level][position] / total) * 100;
        if (Math.abs(percent - 25) > 8.000001) error(`${level}: answer position ${position + 1} is ${percent.toFixed(1)}%; expected 25% ± 8%`);
      }
    }
  }

  const total = Object.values(counts).reduce((sum, value) => sum + value, 0);
  console.log(`Chunks: ${fileCount}; structurally valid questions: ${total}/300${completeMode ? " (complete mode)" : ""}`);
  for (const level of levels) console.log(`${level}: ${counts[level]}/${targets[level]}`);
  console.log(`Initial CAT difficulty prior by CEFR level: ${JSON.stringify(levelDifficultyPrior)}`);
  console.log("This validator checks structure and answer-key position only; it cannot prove semantic uniqueness. Each item still requires independent solving and ambiguity review.");
  if (errors.length) {
    for (const message of errors) console.error(`ERROR: ${message}`);
    process.exitCode = 1;
  } else if (completeMode && total !== 300) {
    process.exitCode = 1;
  } else {
    console.log("Validation passed for the checks available in this mode.");
  }
}

main();