'use strict';

// Execute the app's real offline score() implementation without a browser.
// The source slices are bounded by stable app comments and keep app logic intact.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const zlib = require('node:zlib');

const root = path.resolve(__dirname, '..');
const appPath = path.join(root, 'TaylorFlow.html');
const casePath = path.join(__dirname, 'score_cases.json');
const grammarCasePath = path.join(__dirname, 'grammar_cases.json');
const html = fs.readFileSync(appPath, 'utf8');
const cases = JSON.parse(fs.readFileSync(casePath, 'utf8'));
const grammarCases = JSON.parse(fs.readFileSync(grammarCasePath, 'utf8')).cases;

function between(source, start, end) {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from + start.length);
  if (from < 0 || to < 0) throw new Error(`Không tìm thấy đoạn mã: ${start}`);
  return source.slice(from, to);
}

const dataSource = between(html, 'const D=`', '// Điểm IELTS ước tính từ bản chép lời');
const scoringSource = between(html, '// Điểm IELTS ước tính từ bản chép lời', "if(new URLSearchParams(location.search).has('score-calibration'))");
const evidenceSource = between(html, 'const normalizeEvidenceText=', 'function editDistanceWithin(');
const spellingSource = between(html, 'function editDistanceWithin(', 'function applyDictionaryScoreUpdate(');
const setup = `
const avg=a=>(a=a.filter(v=>v!=null)).length?a.reduce((x,y)=>x+y)/a.length:null;
const half=x=>Math.round(x*2)/2;
const audioBand=record=>record.pronBasis==='acoustic-v1'&&Number.isFinite(record.p)?record.p:null;
`;
const context = vm.createContext({ console, Math, Number, String, Object, Set, Map, Array, JSON, RegExp });
vm.runInContext(`${setup}\n${dataSource}\n${scoringSource}\n${evidenceSource}`, context, { filename: appPath, timeout: 15000 });
vm.runInContext(spellingSource, context, { filename: appPath + ' lexical helpers', timeout: 15000 });
const scoreVersion = vm.runInContext('SCORE_VERSION', context);
const dictionary = new Map();
context.dictionaryShard = async bucket => {
  if (dictionary.has(bucket)) return dictionary.get(bucket);
  const filename = path.join(root, 'assets', 'dictionary', bucket === '_' ? 'other.bin' : `${bucket}.bin`);
  const [entries, aliases] = JSON.parse(zlib.gunzipSync(fs.readFileSync(filename)));
  const shard = [entries, aliases, Object.keys(entries).sort()];
  dictionary.set(bucket, shard);
  return shard;
};

function overall(scores) {
  return scores ? (Number.isFinite(scores.overall) ? scores.overall : Math.round(((scores.fluency + scores.lexical + scores.grammar) / 3) * 2) / 2) : null;
}

function confidenceForScore(scored) {
  const pronunciation = scored?.pronBasis === 'acoustic-v1' && Number.isFinite(scored.p) ? scored.p : null;
  if (pronunciation != null) return { label: 'Cao', margin: 0.25 };
  if (scored.metrics?.duration != null) return { label: 'Vừa', margin: 0.4 };
  return { label: 'Thấp', margin: 1.5 };
}

function passes(sample, result) {
  const expected = sample.expected || {};
  const scores = result.scores;
  const status = result.status || (scores ? 'scored' : 'ungradable');
  if (expected.status && expected.status !== status) return false;
  const band = overall(scores);
  if (expected.textOnly && (scores?.pronunciation !== null || result.confidence?.label !== 'Thấp' || result.confidence.margin < 1.25)) return false;
  if (expected.band != null && (band == null || Math.abs(band - expected.band) > (expected.tolerance ?? 0.5))) return false;
  if (Array.isArray(expected.range) && (band == null || band < expected.range[0] || band > expected.range[1])) return false;
  for (const [criterion, limit] of Object.entries(expected.max || {})) {
    const value = criterion === 'overall' ? band : scores?.[criterion];
    if (!Number.isFinite(value) || value > limit) return false;
  }
  for (const [criterion, minimum] of Object.entries(expected.min || {})) {
    const value = criterion === 'overall' ? band : scores?.[criterion];
    if (!Number.isFinite(value) || value < minimum) return false;
  }
  return true;
}

async function main() {
const groups = new Map();
const output = [];
for (const sample of cases) {
  let result;
  try {
    const evidence = await context.analyzeAnswerEvidence(sample.text);
    const scored = evidence.scorable ? context.score(sample.text, sample.part, sample.duration || 0, sample.question, sample.topic, { evidence }) : null;
    if (scored) context.applySpellingToScore(scored, await context.offlineSpellingAssessment(sample.text));
    result = {
      status: scored ? (scored.metrics.evidenceStatus === 'poor-evidence' ? 'low_evidence' : 'scored') : 'ungradable',
      scores: scored ? { fluency: scored.f, lexical: scored.l, grammar: scored.g, pronunciation: scored.pronBasis === 'acoustic-v1' && Number.isFinite(scored.p) ? scored.p : null, overall: scored.o } : null,
      confidence: scored ? confidenceForScore(scored) : null,
      wordCount: scored?.n ?? 0,
      relevance: scored?.metrics.relevance?.status ?? null,
      grammar: scored ? { completeSentences: scored.metrics.completeSentences, sentenceCount: scored.metrics.sentenceCount, errors: scored.metrics.errors, ruleIds: scored.metrics.grammarFindings.map(item => item.ruleId) } : null,
      lexical: scored ? { mattr: scored.metrics.lexicalMattr, level: scored.metrics.lexicalLevel, levelCounts: scored.metrics.levelCounts, recognized: scored.metrics.recognizedLexicalCount, collocationFindings: scored.metrics.collocationFindings, spellingStatus: scored.metrics.spellingStatus, spellingChecked: scored.metrics.spellingChecked, spellingFindings: scored.metrics.spellingFindings } : null,
      evidence: evidence ? { recognizedRatio: evidence.recognizedRatio, recognizedWords: evidence.recognizedWords, contentRecognizedWords: evidence.recognizedContentWords, dictionaryStatus: evidence.dictionaryStatus, reason: evidence.reason } : null
    };
  } catch (error) {
    result = { status: 'error', scores: null, error: String(error?.stack || error) };
  }
  const passed = passes(sample, result);
  const group = groups.get(sample.group) || { total: 0, passed: 0, failed: [] };
  group.total++;
  if (passed) group.passed++;
  else group.failed.push({ id: sample.id, expected: sample.expected, result });
  groups.set(sample.group, group);
  output.push({ sample, result, passed });
}

const totalPassed = [...groups.values()].reduce((sum, group) => sum + group.passed, 0);
const summary = {
  passed: totalPassed,
  total: cases.length,
  groups: Object.fromEntries([...groups].map(([name, group]) => [name, { passed: group.passed, total: group.total }]))
};
const report = { summary, cases: output };
report.summary.scoreVersion = scoreVersion;
fs.writeFileSync(path.join(__dirname, 'score-baseline-results.json'), JSON.stringify(report, null, 2));
const grammarRuleCount = context.grammarDiagnostics('').ruleCount;
const grammarOutput = grammarCases.map(sample => {
  let diagnostics;
  try { diagnostics = context.grammarDiagnostics(sample.text); }
  catch (error) { return { sample, passed: false, error: String(error?.stack || error) }; }
  const finding = sample.ruleId ? diagnostics.findings.find(item => item.ruleId === sample.ruleId) : null;
  const findingComplete = !sample.ruleId || !!finding && Number.isInteger(finding.start) && Number.isInteger(finding.end)
    && finding.start >= 0 && finding.end > finding.start && finding.end <= sample.text.length
    && sample.text.slice(finding.start, finding.end) === finding.example
    && typeof finding.category === 'string' && typeof finding.explanation === 'string' && !!finding.explanation
    && typeof finding.correctedSentence === 'string' && typeof finding.impact === 'string'
    && finding.confidence >= .82;
  const passed = sample.shouldNotFlag ? diagnostics.findings.length === 0 : !!finding && findingComplete;
  return { sample, passed, ruleCount: diagnostics.ruleCount, finding: finding || null, findingCount: diagnostics.findings.length, actualRuleIds: diagnostics.findings.map(item => item.ruleId) };
});
const grammarPassed = grammarOutput.filter(item => item.passed).length;
const grammarReport = { summary: { passed: grammarPassed, total: grammarOutput.length, rules: grammarRuleCount }, cases: grammarOutput };
fs.writeFileSync(path.join(__dirname, 'grammar-baseline-results.json'), JSON.stringify(grammarReport, null, 2));
const lexicalProbe = (text, question = 'What do you value in daily life?', topic = '', part = 1) => {
  const tokens = text.toLowerCase().match(/[a-z]+(?:'[a-z]+)*/g) || [];
  const content = tokens.filter(word => word.length > 2);
  const evidence = { status: 'scored', scorable: true, recognizedRatio: 1, recognizedWords: tokens.length, recognizedTokens: tokens, contentWords: content.length, recognizedContentWords: content.length, dictionaryStatus: 'checked', dictionaryTags: {}, keyboardSmash: false, warning: '' };
  return context.score(text, part, 0, question, topic, { evidence });
};
const diverseMattr = context.scoreMATTR('adaptable considerate resourceful collaborative resilient'.split(' '));
const repeatedMattr = context.scoreMATTR('useful useful useful useful useful useful'.split(' '));
const typoCheck = await context.offlineSpellingAssessment('This is a great opprotunity for everyone.');
const unknownCheck = await context.offlineSpellingAssessment('We discussed zzqjv during class today.');
const morphologyCheck = await context.offlineSpellingAssessment('Perspectives are quieter, and the searchable approach makes studying easier.');
const goodCollocation = lexicalProbe('I do homework every day because this routine is useful for my studies.');
const badCollocation = lexicalProbe('I make homework every day because this routine is useful for my studies.');
const basicLevel = lexicalProbe('I like a good home and a nice family with a happy day.');
const advancedLevel = lexicalProbe('I value resilient communities and sustainable infrastructure in a rapidly changing society.');
const performanceText = Array.from({ length: 50 }, (_, index) => `I value accessible transport and reliable services in our local community ${index % 2 ? 'today' : 'daily'}.`).join(' ').slice(0, 3500);
lexicalProbe(performanceText);
const performanceStart = process.hrtime.bigint();
const performanceResult = lexicalProbe(performanceText + ' It supports practical choices.');
const scoringLatencyMs = Number(process.hrtime.bigint() - performanceStart) / 1e6;
const lexicalChecks = [
  ['MATTR phân biệt đa dạng với lặp', diverseMattr.value > repeatedMattr.value],
  ['Nhận diện lỗi chính tả có gợi ý', typoCheck.findings.some(item => item.word === 'opprotunity' && item.suggestions.includes('opportunity'))],
  ['Báo từ ngoài từ điển dù thiếu gợi ý', unknownCheck.findings.some(item => item.word === 'zzqjv' && item.suggestions.length === 0)],
  ['Chấp nhận dạng số nhiều, so sánh và hậu tố hợp lệ', morphologyCheck.findings.length === 0],
  ['Không phạt collocation đúng', goodCollocation?.metrics.collocationFindings.length === 0],
  ['Phát hiện và trừ collocation sai', badCollocation?.metrics.collocationFindings.some(item => item.phrase.toLowerCase() === 'make homework') && badCollocation.metrics.collocationPenalty > 0],
  ['Tín hiệu từ vựng B2/C1 nhỉnh hơn từ cơ bản', advancedLevel?.metrics.lexicalLevel > basicLevel?.metrics.lexicalLevel],
  ['Chấm đồng bộ dưới 150 ms với đoạn dài', !!performanceResult && scoringLatencyMs < 150]
];
const lexicalPassed = lexicalChecks.filter(([, passed]) => passed).length;
const plainDevelopment = lexicalProbe('I enjoy reading. It is useful for me. I read at home after class.');
const developedAnswer = lexicalProbe('I enjoy reading because it helps me relax. For example, I read short stories after class. As a result, I can focus better, and I think it is a useful habit.');
const contextualRelevance = lexicalProbe('The annual festival brings residents together and gives local artists a platform to share their work.', 'How can cities become more pleasant places to live?');
const unrelatedRelevance = lexicalProbe('I study chemistry every evening and enjoy reading before bed.', 'How can cities become more pleasant places to live?');
const exerciseRelevance = lexicalProbe('When the weather is bad, I follow a short workout at home.', 'Do you exercise regularly?');
const copiedPromptQuestion = lexicalProbe('Do you prefer mornings or evenings?', 'Do you prefer mornings or evenings?');
const memorizedPolicyAnswer = lexicalProbe('My favourite season is spring because flowers grow and the weather becomes pleasant. I enjoy walking in the park and taking pictures of the trees. Spring makes me feel hopeful, and it is a good time to meet my friends outside.', 'Should cities invest more in public transport?');
const reasonedPolicyAnswer = lexicalProbe('I think cities should invest more in public transport because better bus routes can reduce traffic and help commuters reach work on time.', 'Should cities invest more in public transport?');
const crossTopicAnswer = "I'd like to talk about watching technology videos as a hobby. I first came across it when I wanted a relaxing break after studying. At the time, I wanted to understand more than just the basic idea, so I paid attention to how it worked and who might use it. One detail that stands out is that I found channels that explain how everyday devices and engineering projects work. This matters because the videos entertain me and sometimes introduce ideas I can explore more deeply. For example, after watching a simple electronics build, I looked up the components and learned what each one did. That made the topic feel practical rather than distant or purely theoretical. A challenge is that it is easy to spend too long scrolling instead of choosing something to watch. This does not mean the idea should be rejected; it means people need to consider cost, safety and everyday needs when they plan it. If I had the chance, I would set aside a short time for it and try making a small project myself. Thinking about this experience also helped me notice details I might otherwise overlook. I am not an expert, but it has given me a useful question to explore further. Overall, I find it interesting because it connects what people learn with decisions they make in real life.";
const onTopicHobbyAnswer = lexicalProbe(crossTopicAnswer, 'Describe a hobby you enjoy or would like to start. You should say what it is, when you encountered it, how it works, and why it interests you.', 'Hobbies', 2);
const offTopicHousingAnswer = lexicalProbe(crossTopicAnswer, 'Describe a room or home where you feel comfortable.', 'Housing', 2);
const offTopicBookAnswer = lexicalProbe(crossTopicAnswer, 'Describe a book you enjoyed.', 'Books', 2);
const textOnlyPause = lexicalProbe('I enjoy walking in the park because it helps me relax after a busy day.');
const timedFluency = context.score('I enjoy walking in the park because it helps me relax after a busy day.', 1, 30, '', '', { evidence: { status: 'scored', scorable: true, recognizedRatio: 1, recognizedWords: 15, recognizedTokens: ['i','enjoy','walking','in','the','park','because','it','helps','me','relax','after','a','busy','day'], contentWords: 8, recognizedContentWords: 8, dictionaryStatus: 'checked', dictionaryTags: {}, keyboardSmash: false, warning: '' } });
const fluencyChecks = [
  ['Tín hiệu triển khai ý làm rõ coherence', developedAnswer?.metrics.coherenceSignalCount >= 3 && developedAnswer.metrics.coherenceBand > plainDevelopment?.metrics.coherenceBand],
  ['Chấp nhận ý hỗ trợ theo ngữ cảnh về thành phố', contextualRelevance?.metrics.relevance.status === 'relevant' && contextualRelevance.metrics.relevance.contextMatched.length > 0],
  ['Giữ mức lạc đề khi câu trả lời không liên quan', unrelatedRelevance?.metrics.relevance.status === 'off-topic'],
  ['Nhận diện câu trả lời về thói quen tập luyện bằng workout', exerciseRelevance?.metrics.relevance.status === 'relevant'],
  ['Giới hạn transcript chỉ chép câu hỏi và hướng dẫn trả lời', copiedPromptQuestion?.metrics.questionEcho === true && copiedPromptQuestion.metrics.overallCeiling === 4 && copiedPromptQuestion.o <= 4],
  ['Giảm điểm câu học thuộc lệch câu hỏi nghị luận', memorizedPolicyAnswer?.metrics.relevance.policyMismatch === true && memorizedPolicyAnswer.metrics.overallCeiling === 4 && memorizedPolicyAnswer.o <= 4],
  ['Giữ câu trả lời có quan điểm và lý do cụ thể', reasonedPolicyAnswer?.metrics.relevance.policyMismatch === false && reasonedPolicyAnswer.metrics.relevance.status === 'relevant' && reasonedPolicyAnswer.metrics.overallCeiling === 9],
  ['Giữ câu trả lời sở thích đúng chủ đề', onTopicHobbyAnswer?.metrics.relevance.status === 'relevant' && onTopicHobbyAnswer.metrics.relevance.topicMismatch === false],
  ['Phát hiện cùng câu trả lời bị lệch sang chủ đề nhà ở', offTopicHousingAnswer?.metrics.relevance.status === 'off-topic' && offTopicHousingAnswer.metrics.relevance.topicMismatch === true && offTopicHousingAnswer.metrics.overallCeiling <= 4.5],
  ['Phân biệt chủ đề sách với video/sở thích', offTopicBookAnswer?.metrics.relevance.status === 'off-topic' && offTopicBookAnswer.metrics.relevance.topicMismatch === true],
  ['Band giảm rõ khi giữ nguyên câu trả lời nhưng đổi sang đề nhà ở', !!onTopicHobbyAnswer && !!offTopicHousingAnswer && onTopicHobbyAnswer.o - offTopicHousingAnswer.o >= 1],
  ['Không tự suy ra số lần ngắt từ transcript', textOnlyPause?.metrics.fluencySource === 'transcript' && textOnlyPause.metrics.pauseCount == null],
  ['Tách dữ liệu bản ghi khỏi transcript', timedFluency?.metrics.fluencySource === 'recording']
];
const fluencyPassed = fluencyChecks.filter(([, passed]) => passed).length;
const uiChecks = [
  ['Hiển thị dải điểm ước tính và thông tin độ tin cậy', html.includes('function scoreRange(result)') && html.includes('results-criteria') && html.includes('Độ tin cậy: ') && html.includes('Pronunciation chưa được chấm vì chưa có dữ liệu âm thanh phù hợp đã đối chiếu.')],
  ['Cảnh báo nêu chủ đề nhận diện và chủ đề hiện tại khi lệch đề', html.includes('Có vẻ bạn đang trả lời về ') && /trong khi chủ đề hiện tại là '\+esc\(relevance\.topicLabel\)/.test(html) && !html.includes('Chủ đề được chọn là')],
  ['Không hiển thị lại phần giải thích điểm đã được gỡ', !html.includes('function scorePriorityFindings') && !html.includes('Tối đa 3 điểm nên sửa trước')],
  ['Lịch sử phân biệt phiên bản và cho phép chấm lại', html.includes('function scoreHistoryMarkup') && html.includes('function rescoreHistoryItem') && html.includes('Chấm bằng bản cũ')],
  ['Bản chấm cũ được giữ lại sau khi chấm lại', html.includes('scoreRevisions') && html.includes('Xem phiên bản điểm trước')],
  ['Chuẩn hóa dữ liệu vẫn giữ mã phiên bản cũ', html.includes('row.scoreVersion=Number.isInteger(x.scoreVersion)') && html.includes('row.scoreRevisions=(Array.isArray(x.scoreRevisions)')],
  ['Transcript chấm lại chỉ lưu ở thiết bị', html.includes('SCORE_HISTORY_TEXT_KEY') && html.includes('không đưa vào đồng bộ')],
  ['Câu hỏi chép lại có cảnh báo và giới hạn dải điểm', html.includes('Transcript chỉ chứa một câu hỏi, chưa có câu trả lời.') && /function scoreRange\(result\)[^\n]*overallCeiling/.test(html)]
];
const uiPassed = uiChecks.filter(([, passed]) => passed).length;
for (const [name, passed] of lexicalChecks) if (!passed) console.log(`Lexical lỗi: ${name}`);
for (const [name, passed] of fluencyChecks) if (!passed) console.log(`Fluency lỗi: ${name}`);
for (const [name, passed] of uiChecks) if (!passed) console.log(`UI/History lỗi: ${name}`);
console.log(`SCORE_VERSION ${scoreVersion} · ${totalPassed}/${cases.length} đạt`);
for (const [name, group] of groups) console.log(`${name}: ${group.passed}/${group.total}`);
console.log(`Grammar: ${grammarPassed}/${grammarOutput.length} mẫu · ${grammarRuleCount} quy tắc khả dụng`);
console.log(`Lexical: ${lexicalPassed}/${lexicalChecks.length} kiểm tra · ${scoringLatencyMs.toFixed(1)} ms ở đoạn dài`);
console.log(`Fluency & Coherence: ${fluencyPassed}/${fluencyChecks.length} kiểm tra`);
console.log(`Đổi đề, giữ nguyên bài mẫu: Hobbies ${onTopicHobbyAnswer?.o?.toFixed(1) ?? '—'} → Housing ${offTopicHousingAnswer?.o?.toFixed(1) ?? '—'} · Books ${offTopicBookAnswer?.o?.toFixed(1) ?? '—'}`);
console.log(`Giao diện/History: ${uiPassed}/${uiChecks.length} kiểm tra`);
for (const item of grammarOutput.filter(row => !row.passed)) console.log(`Grammar lỗi: ${item.sample.id} · mong ${item.sample.ruleId || 'không cảnh báo'}, nhận ${item.finding?.ruleId || (item.findingCount ? item.findingCount + ' cảnh báo' : 'không có')}`);
console.log(`Kết quả chi tiết: ${path.join(__dirname, 'score-baseline-results.json')}`);
if (process.argv.includes('--fail-on-any')) process.exitCode = totalPassed === cases.length && grammarPassed === grammarOutput.length && grammarRuleCount >= 30 ? 0 : 1;
if (process.argv.includes('--fail-on-grammar')) process.exitCode = grammarPassed === grammarOutput.length && grammarRuleCount >= 30 ? 0 : 1;
if (process.argv.includes('--fail-on-lexical')) process.exitCode = lexicalPassed === lexicalChecks.length ? 0 : 1;
if (process.argv.includes('--fail-on-fluency')) process.exitCode = fluencyPassed === fluencyChecks.length ? 0 : 1;
if (process.argv.includes('--fail-on-ui')) process.exitCode = uiPassed === uiChecks.length ? 0 : 1;
}
main().catch(error => { console.error(error); process.exitCode = 1; });
