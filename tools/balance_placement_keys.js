#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const directory = path.resolve(__dirname, "../assets/placement");
const files = fs.readdirSync(directory).filter(name => /^bank-(A1|A2|B1|B2|C1|C2)-\d+\.js$/u.test(name)).sort();
const byLevel = new Map();

for (const name of files) {
  let registered;
  const source = fs.readFileSync(path.join(directory, name), "utf8");
  vm.runInNewContext(source, { window: { TFPlacementBank: { register(level, items) { registered = { level, items }; } } } }, { filename: name, timeout: 1000 });
  if (!registered || !Array.isArray(registered.items)) throw new Error(`${name}: invalid registration`);
  for (const item of registered.items) {
    if (!byLevel.has(item.level)) byLevel.set(item.level, []);
    byLevel.get(item.level).push({ name, item });
  }
}

const positions = new Map();
for (const [level, rows] of byLevel) {
  rows.forEach(({ item }, index) => {
    const correctIndex = item.options.findIndex(option => option === item.key);
    if (correctIndex < 0) throw new Error(`${item.id}: key missing from options`);
    const targetIndex = index % 4;
    const distractors = item.options.filter((_, optionIndex) => optionIndex !== correctIndex);
    item.options = [...distractors.slice(0, targetIndex), item.key, ...distractors.slice(targetIndex)];
    positions.set(level, [...(positions.get(level) || [0, 0, 0, 0])]);
    positions.get(level)[targetIndex] += 1;
  });
}

for (const name of files) {
  const level = name.match(/^bank-([A-Z0-9]+)-/u)[1];
  const questions = byLevel.get(level).filter(row => row.name === name).map(row => row.item);
  const output = `(function (w) {\n  w.TFPlacementBank.register(${JSON.stringify(level)}, ${JSON.stringify(questions, null, 2)});\n})(window);\n`;
  fs.writeFileSync(path.join(directory, name), output, "utf8");
}

for (const [level, counts] of positions) console.log(`${level}: key positions ${counts.join("/")}`);
