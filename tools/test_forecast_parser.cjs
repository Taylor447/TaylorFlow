const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const html = fs.readFileSync(path.join(__dirname, '..', 'TaylorFlow.html'), 'utf8');
const startMarker = '/* TF_BULK_FORECAST_PARSER_BEGIN */';
const endMarker = '/* TF_BULK_FORECAST_PARSER_END */';
const start = html.indexOf(startMarker);
const end = html.indexOf(endMarker, start + startMarker.length);
assert(start >= 0 && end > start, 'Parser markers must exist in TaylorFlow.html');

const parserSource = html.slice(start + startMarker.length, end);
const sandbox = {};
vm.runInNewContext(`${parserSource}\nthis.parseReviewForecastBulkText = parseReviewForecastBulkText;`, sandbox);
const parse = text => JSON.parse(JSON.stringify(sandbox.parseReviewForecastBulkText(text)));

const cases = [
  {
    name: 'numbered Part 1 questions',
    text: 'PART 1\n1. What do you usually do in the morning?\n2) Do you prefer weekdays or weekends?',
    expected: [[2, 0, 0], 0],
  },
  {
    name: 'lowercase headings and inline question',
    text: 'part 1: How do you spend your free time?\npart 3 - Why do people need hobbies?',
    expected: [[1, 0, 1], 0],
  },
  {
    name: 'roman Part I and III headings',
    text: 'Part I\n• What subject do you enjoy?\nPart III\n- Should schools teach more practical skills?',
    expected: [[1, 0, 1], 0],
  },
  {
    name: 'multiline cue card with blank lines',
    text: 'Part 2\nDescribe a place where you like to relax.\nYou should say:\n- where it is\n\n- when you go there\n- what you do\n- and explain why you like it\n\nPart 3\n1. Why are quiet places important?',
    expected: [[0, 1, 1], 0],
  },
  {
    name: 'two cue cards with explicit labels',
    text: 'PART 2\nCue card 1: Describe a useful object.\n- what it is\n- how you use it\nCue Card 2: Describe a memorable trip.\n- where you went\n- who went with you',
    expected: [[0, 2, 0], 0],
  },
  {
    name: 'curly quotation marks and mixed bullets',
    text: 'Part 1\n“Do you enjoy reading?”\n▪ What kind of books do you like?\nPart 3\n1) How has reading changed in recent years?',
    expected: [[2, 0, 1], 0],
  },
  {
    name: 'normalized duplicate warning across parts',
    text: 'Part 1\nDo you like music?\nPart 3\n1. DO YOU LIKE MUSIC!',
    expected: [[1, 0, 0], 1],
  },
  {
    name: 'adjacent headings, inline cue and topic labels',
    text: 'Part 1: Topic: Home\n1. Do you live in a house or an apartment?\nPart 2 — Cue card: Describe a home you remember.\nYou should say:\n- where it was\n- who lived there\n- what it looked like\n- and explain why you remember it\nPart 3: 1. How are homes changing?',
    expected: [[1, 1, 1], 0],
  },
  {
    name: 'extra numbering, separators and punctuation',
    text: '### PART 1 ###\n1. 2. What weather do you enjoy?\n---\nPART 3 — Questions:\n• How can cities prepare for extreme weather?',
    expected: [[1, 0, 1], 0],
  },
];

for (const testCase of cases) {
  const result = parse(testCase.text);
  const actual = [[1, 2, 3].map(part => result.prompts.filter(prompt => prompt.p === part).length), result.duplicates.length];
  assert.deepEqual(actual, testCase.expected, testCase.name);
  assert(result.prompts.every(prompt => prompt.q.trim()), `${testCase.name}: no empty prompt`);
}

console.log(`PASS ${cases.length} messy-input parser examples`);
