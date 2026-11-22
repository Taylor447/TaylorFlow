import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const coursesDir = path.join(root, 'assets', 'courses');
const indexPath = path.join(coursesDir, 'index.json');
const errors = [];
const warnings = [];
const fail = (where, message) => errors.push(`${where}: ${message}`);
const text = (value, where, { min = 1, max = 600, optional = false } = {}) => {
  if (optional && (value === undefined || value === null || value === '')) return;
  if (typeof value !== 'string') return fail(where, 'phải là chuỗi văn bản');
  const trimmed = value.trim();
  if (trimmed.length < min || trimmed.length > max) fail(where, `độ dài cần từ ${min} đến ${max} ký tự (hiện ${trimmed.length})`);
  if (/\.\.\.|\bTODO\b|\bTBD\b|\bplaceholder\b/i.test(value)) fail(where, 'có dấu nội dung tạm hoặc chưa hoàn thiện');
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f​-‏‪-‮⁠﻿�-]/u.test(value)) fail(where, 'chứa ký tự điều khiển hoặc ký tự lạ');
};
const readJson = file => {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (error) { fail(path.relative(root, file), `JSON không hợp lệ: ${error.message}`); return null; }
};
const unique = (values, where, label) => {
  const seen = new Set();
  for (const value of values) {
    if (seen.has(value)) fail(where, `${label} bị trùng: ${value}`);
    seen.add(value);
  }
};

const index = readJson(indexPath);
if (!index || index.version !== 1 || !Array.isArray(index.courses)) fail('assets/courses/index.json', 'cần version: 1 và courses là mảng');
const allowedCategories = new Set(['daily', 'ielts', 'pronunciation', 'engineering', 'presentation', 'vocabulary']);
const metadataKeys = ['id', 'category', 'title', 'level', 'minutes', 'lessonCount', 'status', 'coverSpec'];
const courseIds = new Set();
const lessonIds = new Set();
const vocabulary = new Map();
const expectedSteps = ['dialogue', 'vocab', 'pattern', 'shadow', 'speak', 'quiz'];
let readyCount = 0, lessonCount = 0;

if (index?.courses) {
  for (const [courseIndex, meta] of index.courses.entries()) {
    const where = `index.courses[${courseIndex}]`;
    for (const key of Object.keys(meta || {})) if (!metadataKeys.includes(key)) fail(where, `không được có trường metadata bổ sung: ${key}`);
    for (const key of metadataKeys) if (!Object.hasOwn(meta || {}, key)) fail(where, `thiếu trường ${key}`);
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(meta?.id || '')) fail(where, 'id chỉ dùng chữ thường, số và dấu gạch ngang');
    if (courseIds.has(meta?.id)) fail(where, `id khóa học bị trùng: ${meta?.id}`);
    courseIds.add(meta?.id);
    if (!allowedCategories.has(meta?.category)) fail(where, 'category không nằm trong danh sách nhóm đã định nghĩa');
    text(meta?.title, `${where}.title`, { max: 90 });
    text(meta?.level, `${where}.level`, { max: 35 });
    if (!Number.isInteger(meta?.minutes) || meta.minutes < 1 || meta.minutes > 600) fail(where, 'minutes phải là số nguyên từ 1 đến 600');
    if (!Number.isInteger(meta?.lessonCount) || meta.lessonCount < 1 || meta.lessonCount > 80) fail(where, 'lessonCount phải là số nguyên từ 1 đến 80');
    if (!['ready', 'soon'].includes(meta?.status)) fail(where, 'status chỉ nhận ready hoặc soon');
    if (!meta?.coverSpec || typeof meta.coverSpec !== 'object' || Array.isArray(meta.coverSpec)) fail(where, 'coverSpec phải là object');
    else {
      text(meta.coverSpec.shortTitle, `${where}.coverSpec.shortTitle`, { max: 40 });
      if (!/^[a-z-]+$/.test(meta.coverSpec.motif || '')) fail(where, 'coverSpec.motif không hợp lệ');
    }

    const dataPath = path.join(coursesDir, `${meta?.id}.json`);
    const fallbackPath = path.join(coursesDir, `${meta?.id}.js`);
    if (meta?.status === 'soon') {
      if (fs.existsSync(dataPath)) warnings.push(`${path.relative(root, dataPath)}: khóa sắp ra mắt không cần dữ liệu bài học`);
      continue;
    }
    readyCount++;
    if (!fs.existsSync(dataPath)) { fail(where, `thiếu file dữ liệu ${path.relative(root, dataPath)}`); continue; }
    if (!fs.existsSync(fallbackPath) && !process.argv.includes('--emit-runtime')) fail(where, `thiếu script dự phòng cho mở file trực tiếp: ${path.relative(root, fallbackPath)}`);
    const data = readJson(dataPath);
    if (!data || data.id !== meta.id) fail(path.relative(root, dataPath), 'id trong dữ liệu phải khớp metadata');
    if (data && fs.existsSync(fallbackPath) && !process.argv.includes('--emit-runtime') && !fs.readFileSync(fallbackPath, 'utf8').includes(JSON.stringify(data))) fail(path.relative(root, fallbackPath), 'script dự phòng không khớp JSON khóa học');
    text(data?.description, `${meta.id}.description`, { max: 180 });
    if (!Array.isArray(data?.lessons) || data.lessons.length !== meta.lessonCount) {
      fail(path.relative(root, dataPath), `cần đúng ${meta.lessonCount} bài theo metadata`);
      continue;
    }
    lessonCount += data.lessons.length;
    for (const [lessonIndex, lesson] of data.lessons.entries()) {
      const base = `${meta.id}.lessons[${lessonIndex}]`;
      if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(lesson?.id || '')) fail(base, 'id bài học không hợp lệ');
      if (lessonIds.has(lesson?.id)) fail(base, `id bài học bị trùng: ${lesson?.id}`);
      lessonIds.add(lesson?.id);
      text(lesson?.title, `${base}.title`, { max: 90 });
      if (!Number.isInteger(lesson?.minutes) || lesson.minutes < 1 || lesson.minutes > 120) fail(base, 'minutes phải là số nguyên từ 1 đến 120');
      if (!Array.isArray(lesson?.steps) || lesson.steps.length !== 6) { fail(base, 'mỗi bài cần đủ đúng 6 bước'); continue; }
      const actualSteps = lesson.steps.map(step => step?.type);
      if (actualSteps.some((type, i) => type !== expectedSteps[i])) fail(base, `thứ tự bước phải là ${expectedSteps.join(' → ')}`);
      const step = type => lesson.steps.find(item => item?.type === type);

      const dialogue = step('dialogue');
      if (!Array.isArray(dialogue?.lines) || dialogue.lines.length < 2 || dialogue.lines.length > 12) fail(`${base}.dialogue`, 'cần từ 2 đến 12 câu thoại');
      for (const [lineIndex, line] of (dialogue?.lines || []).entries()) {
        const loc = `${base}.dialogue.lines[${lineIndex}]`;
        text(line?.who, `${loc}.who`, { max: 30 }); text(line?.en, `${loc}.en`, { max: 200 }); text(line?.vi, `${loc}.vi`, { max: 240 });
      }

      const vocab = step('vocab');
      if (!Array.isArray(vocab?.items) || vocab.items.length < 3 || vocab.items.length > 10) fail(`${base}.vocab`, 'cần từ 3 đến 10 mục từ vựng');
      for (const [itemIndex, item] of (vocab?.items || []).entries()) {
        const loc = `${base}.vocab.items[${itemIndex}]`;
        text(item?.en, `${loc}.en`, { max: 60 }); text(item?.vi, `${loc}.vi`, { max: 120 }); text(item?.example, `${loc}.example`, { max: 180 });
        const term = String(item?.en || '').toLocaleLowerCase('en').replace(/[’']/g, '').replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
        if (term) {
          if (vocabulary.has(term)) fail(loc, `từ/cụm từ trùng với ${vocabulary.get(term)}: ${term}`);
          vocabulary.set(term, loc);
        }
      }

      const pattern = step('pattern');
      text(pattern?.title, `${base}.pattern.title`, { max: 100 }); text(pattern?.vi, `${base}.pattern.vi`, { max: 240 });
      if (!Array.isArray(pattern?.examples) || pattern.examples.length < 2 || pattern.examples.length > 8) fail(`${base}.pattern`, 'cần từ 2 đến 8 ví dụ');
      for (const [i, example] of (pattern?.examples || []).entries()) text(example, `${base}.pattern.examples[${i}]`, { max: 200 });

      const shadow = step('shadow');
      if (!Array.isArray(shadow?.sentences) || shadow.sentences.length < 2 || shadow.sentences.length > 8) fail(`${base}.shadow`, 'cần từ 2 đến 8 câu luyện đọc');
      for (const [i, sentence] of (shadow?.sentences || []).entries()) text(sentence, `${base}.shadow.sentences[${i}]`, { max: 220 });

      const speak = step('speak');
      text(speak?.prompt, `${base}.speak.prompt`, { max: 240 });
      if (!Array.isArray(speak?.hints) || speak.hints.length < 2 || speak.hints.length > 8) fail(`${base}.speak`, 'cần từ 2 đến 8 gợi ý');
      for (const [i, hint] of (speak?.hints || []).entries()) text(hint, `${base}.speak.hints[${i}]`, { max: 120 });
      if (![1, 2, 3].includes(speak?.part)) fail(`${base}.speak.part`, 'chỉ nhận Part 1, 2 hoặc 3');

      const quiz = step('quiz');
      if (!Array.isArray(quiz?.items) || quiz.items.length < 2 || quiz.items.length > 8) fail(`${base}.quiz`, 'cần từ 2 đến 8 câu hỏi');
      for (const [i, item] of (quiz?.items || []).entries()) {
        const loc = `${base}.quiz.items[${i}]`;
        text(item?.q, `${loc}.q`, { max: 220 }); text(item?.why, `${loc}.why`, { max: 240 });
        if (!Array.isArray(item?.options) || item.options.length < 2 || item.options.length > 6) fail(loc, 'cần từ 2 đến 6 lựa chọn');
        for (const [optionIndex, option] of (item?.options || []).entries()) text(option, `${loc}.options[${optionIndex}]`, { max: 120 });
        if (!Number.isInteger(item?.answer) || item.answer < 0 || item.answer >= (item?.options?.length || 0)) fail(`${loc}.answer`, 'chỉ số đáp án nằm ngoài danh sách lựa chọn');
      }
    }
  }
}

if (fs.existsSync(indexPath) && index) {
  const jsIndexPath = path.join(coursesDir, 'index.js');
  if (!fs.existsSync(jsIndexPath)) fail('assets/courses/index.js', 'thiếu metadata dự phòng cho mở file trực tiếp');
  else if (!process.argv.includes('--emit-runtime') && !fs.readFileSync(jsIndexPath, 'utf8').includes(JSON.stringify(index))) fail('assets/courses/index.js', 'metadata JS dự phòng không khớp index.json');
}

if (process.argv.includes('--emit-runtime')) {
  if (!index?.courses) process.exitCode = 1;
  else {
    fs.mkdirSync(coursesDir, { recursive: true });
    fs.writeFileSync(path.join(coursesDir, 'index.js'), `globalThis.TF_COURSE_INDEX=${JSON.stringify(index)};\n`, 'utf8');
    for (const meta of index.courses.filter(item => item.status === 'ready')) {
      const dataPath = path.join(coursesDir, `${meta.id}.json`);
      if (!fs.existsSync(dataPath)) continue;
      const data = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
      fs.writeFileSync(path.join(coursesDir, `${meta.id}.js`), `globalThis.TF_COURSE_DATA=globalThis.TF_COURSE_DATA||{};globalThis.TF_COURSE_DATA[${JSON.stringify(meta.id)}]=${JSON.stringify(data)};\n`, 'utf8');
    }
    console.log('Đã tạo script dự phòng index.js và các khóa sẵn sàng.');
  }
}

if (errors.length) {
  console.error(`Có ${errors.length} lỗi kiểm tra khóa học:`);
  for (const error of errors) console.error(`- ${error}`);
  process.exitCode = 1;
} else {
  console.log(`Hợp lệ: ${index.courses.length} khóa trong danh mục (${readyCount} sẵn sàng, ${index.courses.length - readyCount} sắp ra mắt), ${lessonCount} bài học, ${vocabulary.size} mục từ vựng.`);
}
for (const warning of warnings) console.warn(`Cảnh báo: ${warning}`);
