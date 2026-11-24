import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = path.join(root, 'assets', 'tests');
const issues = [];
const issue = (file, where, message) => issues.push(file + ' · ' + where + ': ' + message);
const readJson = async file => {
  try { return JSON.parse(await readFile(file, 'utf8')); }
  catch (error) { issue(path.relative(root, file), '$', 'JSON không hợp lệ: ' + error.message); return null; }
};
const text = (value, min, max, file, where) => {
  if (typeof value !== 'string') { issue(file, where, 'cần là chuỗi.'); return false; }
  if (value.trim().length < min || value.trim().length > max) issue(file, where, 'độ dài phải từ ' + min + ' đến ' + max + ' ký tự.');
  if (/\uFFFD|[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F\u202A-\u202E\u2066-\u2069]/u.test(value)) issue(file, where, 'có ký tự điều khiển hoặc ký tự bị lỗi.');
  if (/\b(?:TODO|TBD|PLACEHOLDER)\b|\.\.\./i.test(value)) issue(file, where, 'có dấu giữ chỗ chưa hoàn thiện.');
  return true;
};
const norm = value => String(value).normalize('NFKC').toLocaleLowerCase('en')
  .replace(/[’‘]/g, "'").replace(/[‐‑‒–—]/g, '-').replace(/[.,!?;:"()[\]{}]/g, ' ')
  .replace(/\s+/g, ' ').trim();
const ids = new Set();
const claimId = (id, file, where) => {
  if (typeof id !== 'string' || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/i.test(id)) issue(file, where, 'id phải dùng chữ Latin, số và dấu gạch nối.');
  else if (ids.has(id)) issue(file, where, 'id bị trùng: ' + id);
  else ids.add(id);
};
const indexFile = path.join(dataDir, 'index.json');
const index = await readJson(indexFile);
if (index) {
  const rel = path.relative(root, indexFile);
  if (index.version !== 1) issue(rel, 'version', 'cần bằng 1.');
  text(index.notice, 40, 260, rel, 'notice');
  if (!Array.isArray(index.tests) || !index.tests.length) issue(rel, 'tests', 'cần có ít nhất một đề.');
  const metadataIds = new Set();
  for (const [i, meta] of (index.tests || []).entries()) {
    const at = 'tests[' + i + ']';
    if (!meta || typeof meta !== 'object') { issue(rel, at, 'cần là một đối tượng.'); continue; }
    if (metadataIds.has(meta.id)) issue(rel, at + '.id', 'id đề bị trùng.');
    metadataIds.add(meta.id);
    claimId(meta.id, rel, at + '.id');
    if (!['listening', 'reading'].includes(meta.skill)) issue(rel, at + '.skill', 'chỉ hỗ trợ listening hoặc reading.');
    for (const key of ['category', 'title', 'level']) text(meta[key], 2, key === 'title' ? 100 : 60, rel, at + '.' + key);
    if (!Number.isInteger(meta.minutes) || meta.minutes < 1 || meta.minutes > 240) issue(rel, at + '.minutes', 'cần là số phút từ 1 đến 240.');
    if (!Number.isInteger(meta.sectionCount) || meta.sectionCount < 1 || meta.sectionCount > 8) issue(rel, at + '.sectionCount', 'cần từ 1 đến 8.');
    if (!Number.isInteger(meta.questionCount) || meta.questionCount < 1 || meta.questionCount > 100) issue(rel, at + '.questionCount', 'cần từ 1 đến 100.');
    if (!['ready', 'soon'].includes(meta.status)) issue(rel, at + '.status', 'chỉ nhận ready hoặc soon.');
    if (!Array.isArray(meta.topics) || !meta.topics.length) issue(rel, at + '.topics', 'cần ít nhất một chủ đề.');
    if (!Array.isArray(meta.questionTypes) || !meta.questionTypes.length) issue(rel, at + '.questionTypes', 'cần ít nhất một dạng câu.');
    if (meta.reviewed !== false) issue(rel, at + '.reviewed', 'đề pilot phải được đánh dấu false để chờ duyệt.');
  }
}

const allowedTypes = new Set([
  'form-completion', 'note-completion', 'multiple-choice', 'matching', 'short-answer',
  'tfng', 'ynng', 'heading-matching', 'sentence-completion', 'information-matching'
]);
const questionIds = new Set();
const sectionIds = new Set();
for (const meta of index?.tests || []) {
  if (meta.status !== 'ready') continue;
  const filePath = path.join(dataDir, meta.id + '.json');
  const data = await readJson(filePath);
  const rel = path.relative(root, filePath);
  if (!data) continue;
  if (data.id !== meta.id) issue(rel, 'id', 'phải khớp id trong index.json.');
  if (data.skill !== meta.skill) issue(rel, 'skill', 'phải khớp skill trong index.json.');
  text(data.title, 2, 100, rel, 'title');
  text(data.description, 10, 240, rel, 'description');
  if (!Number.isInteger(data.minutes) || data.minutes !== meta.minutes) issue(rel, 'minutes', 'phải khớp thời lượng trong index.json.');
  if (data.reviewed !== false) issue(rel, 'reviewed', 'đề pilot phải được đánh dấu false để chờ duyệt.');
  if (!Array.isArray(data.sections) || !data.sections.length) { issue(rel, 'sections', 'cần có ít nhất một phần.'); continue; }
  if (data.sections.length !== meta.sectionCount) issue(rel, 'sections', 'số phần không khớp index.json.');
  let totalQuestions = 0;
  let passageWordCount = 0;
  for (const [si, section] of data.sections.entries()) {
    const at = 'sections[' + si + ']';
    if (!section || typeof section !== 'object') { issue(rel, at, 'cần là một đối tượng.'); continue; }
    claimId(section.id, rel, at + '.id');
    if (section.reviewed !== false) issue(rel, at + '.reviewed', 'phần pilot phải được đánh dấu false để chờ duyệt.');
    if (sectionIds.has(section.id)) issue(rel, at + '.id', 'id phần bị trùng trong bộ dữ liệu.');
    sectionIds.add(section.id);
    text(section.title, 3, 120, rel, at + '.title');
    text(section.instructions, 10, 500, rel, at + '.instructions');
    if (meta.skill === 'listening') {
      if (!section.audio || typeof section.audio !== 'object') issue(rel, at + '.audio', 'đề nghe cần có audio.');
      else if (section.audio.src) {
        text(section.audio.src, 1, 240, rel, at + '.audio.src');
        if (/^(?:https?:)?\/\//i.test(section.audio.src)) issue(rel, at + '.audio.src', 'chỉ nhận tệp âm thanh cục bộ để dùng offline.');
      }
      else {
        if (!Array.isArray(section.audio.script) || !section.audio.script.length) issue(rel, at + '.audio.script', 'cần script hoặc src.');
        for (const [li, line] of (section.audio.script || []).entries()) {
          const pos = at + '.audio.script[' + li + ']';
          text(line?.voice, 1, 40, rel, pos + '.voice');
          text(line?.text, 2, 240, rel, pos + '.text');
        }
        if (section.audio.pauses != null && (!Number.isInteger(section.audio.pauses) || section.audio.pauses < 0 || section.audio.pauses > 5000)) issue(rel, at + '.audio.pauses', 'khoảng nghỉ phải từ 0 đến 5000 ms.');
      }
    }
    const paragraphIds = new Set();
    if (meta.skill === 'reading') {
      if (!Array.isArray(section.passage?.paragraphs) || !section.passage.paragraphs.length) issue(rel, at + '.passage.paragraphs', 'bài đọc cần có đoạn văn.');
      for (const [pi, paragraph] of (section.passage?.paragraphs || []).entries()) {
        const pos = at + '.passage.paragraphs[' + pi + ']';
        claimId(paragraph?.id, rel, pos + '.id');
        paragraphIds.add(paragraph?.id);
        text(paragraph?.text, 40, 1600, rel, pos + '.text');
        passageWordCount += String(paragraph?.text || '').trim().split(/\s+/).filter(Boolean).length;
      }
    }
    if (!Array.isArray(section.questions) || !section.questions.length) { issue(rel, at + '.questions', 'cần có ít nhất một câu.'); continue; }
    totalQuestions += section.questions.length;
    for (const [qi, q] of section.questions.entries()) {
      const pos = at + '.questions[' + qi + ']';
      if (!q || typeof q !== 'object') { issue(rel, pos, 'cần là một đối tượng.'); continue; }
      claimId(q.id, rel, pos + '.id');
      if (q.reviewed !== false) issue(rel, pos + '.reviewed', 'câu pilot phải được đánh dấu false để chờ duyệt.');
      if (questionIds.has(q.id)) issue(rel, pos + '.id', 'id câu hỏi bị trùng.');
      questionIds.add(q.id);
      if (!allowedTypes.has(q.type)) issue(rel, pos + '.type', 'dạng câu chưa được hỗ trợ.');
      text(q.prompt, 5, 320, rel, pos + '.prompt');
      text(q.explain, 10, 500, rel, pos + '.explain');
      if (!Array.isArray(q.options)) issue(rel, pos + '.options', 'cần là mảng; dùng [] cho câu tự điền.');
      else {
        for (const [oi, option] of q.options.entries()) text(option, 1, 240, rel, pos + '.options[' + oi + ']');
        if (new Set(q.options.map(norm)).size !== q.options.length) issue(rel, pos + '.options', 'có lựa chọn bị trùng.');
        if (['multiple-choice', 'matching', 'tfng', 'ynng', 'heading-matching', 'information-matching'].includes(q.type) && q.options.length < 2) issue(rel, pos + '.options', 'dạng câu này cần ít nhất hai lựa chọn.');
      }
      const answers = Array.isArray(q.answer) ? q.answer : [q.answer];
      if (!answers.length || answers.some(answer => typeof answer !== 'string' || !answer.trim())) issue(rel, pos + '.answer', 'đáp án cần là chuỗi hoặc mảng chuỗi không rỗng.');
      else for (const [ai, answer] of answers.entries()) text(answer, 1, 240, rel, pos + '.answer[' + ai + ']');
      if (q.options?.length && answers.some(answer => !q.options.some(option => norm(option) === norm(answer)) && !/^(?:[A-H]|P\d+)$/i.test(answer))) issue(rel, pos + '.answer', 'đáp án không nằm trong các lựa chọn.');
      if (!Array.isArray(q.accept)) issue(rel, pos + '.accept', 'cần là mảng (có thể rỗng).');
      else for (const [ai, answer] of q.accept.entries()) text(answer, 1, 240, rel, pos + '.accept[' + ai + ']');
      if (q.maxWords != null && (!Number.isInteger(q.maxWords) || q.maxWords < 1 || q.maxWords > 10)) issue(rel, pos + '.maxWords', 'giới hạn số từ phải từ 1 đến 10.');
      if (q.maxWords && [...answers, ...(q.accept || [])].some(answer => String(answer).split(/\s+/).filter(Boolean).length > q.maxWords)) issue(rel, pos + '.maxWords', 'một đáp án vượt quá giới hạn số từ.');
      if (!q.evidence || typeof q.evidence !== 'object') issue(rel, pos + '.evidence', 'cần có evidence.');
      else if (meta.skill === 'listening' && (!Number.isInteger(q.evidence.lineIndex) || q.evidence.lineIndex < 0 || q.evidence.lineIndex >= (section.audio?.script || []).length)) issue(rel, pos + '.evidence.lineIndex', 'phải trỏ tới một dòng trong script.');
      else if (meta.skill === 'reading' && !paragraphIds.has(q.evidence.paragraphId)) issue(rel, pos + '.evidence.paragraphId', 'phải trỏ tới một đoạn trong bài đọc.');
    }
  }
  if (totalQuestions !== meta.questionCount) issue(rel, 'sections.questions', 'tổng số câu không khớp index.json.');
  if (meta.skill === 'reading' && (passageWordCount < 350 || passageWordCount > 1600)) issue(rel, 'sections.passage', 'độ dài bài đọc phải từ 350 đến 1600 từ; hiện có ' + passageWordCount + '.');
}

if (index) {
  const expected = new Set(index.tests.filter(meta => meta.status === 'ready').map(meta => meta.id + '.json'));
  const actual = new Set((await readdir(dataDir)).filter(name => name.endsWith('.json') && name !== 'index.json'));
  for (const name of expected) if (!actual.has(name)) issue('assets/tests', name, 'thiếu tệp dữ liệu đề.');
  for (const name of actual) if (!expected.has(name)) issue('assets/tests', name, 'không có metadata tương ứng trong index.json.');
}
if (issues.length) {
  console.error('Kiểm tra kho đề: ' + issues.length + ' lỗi');
  for (const message of issues) console.error(' - ' + message);
  process.exitCode = 1;
} else {
  const totals = (index?.tests || []).filter(meta => meta.status === 'ready').reduce((sum, meta) => ({tests: sum.tests + 1, questions: sum.questions + meta.questionCount}), {tests: 0, questions: 0});
  console.log('Kiểm tra kho đề đạt: ' + totals.tests + ' đề, ' + totals.questions + ' câu; cấu trúc, đáp án và chứng cứ hợp lệ. Nội dung vẫn chờ duyệt (reviewed:false).');
}
