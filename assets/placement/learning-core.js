(function (root, factory) {
  "use strict";
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.TFLearningCore = api;
})(typeof globalThis === "object" ? globalThis : this, function () {
  "use strict";

  const DAY = 86400000;
  const LEVELS = Object.freeze(["A1", "A2", "B1", "B2", "C1", "C2"]);
  const METHODS = Object.freeze(["brief", "examples", "bilingual", "audio", "game"]);
  const clamp = (n, low, high) => Math.max(low, Math.min(high, n));
  const median = values => {
    const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
    if (!sorted.length) return null;
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  };
  const validTime = (value, now = Date.now()) => Number.isFinite(value) && value >= 0 && value <= now + DAY;
  const cleanMode = value => METHODS.includes(value) ? value : "examples";
  const englishSignal = text => {
    const words = String(text || "").match(/[A-Za-z]+(?:['’][A-Za-z]+)*/g) || [];
    const letters = (String(text || "").match(/[A-Za-z]/g) || []).length;
    const allLetters = (String(text || "").match(/[A-Za-zÀ-ỹ]/g) || []).length;
    return { words: words.length, ratio: allLetters ? letters / allLetters : 0 };
  };

  function cleanProfile(input, now = Date.now()) {
    const src = input && typeof input === "object" && !Array.isArray(input) ? input : {};
    const placement = src.placement && typeof src.placement === "object" ? src.placement : {};
    const active = placement.active && typeof placement.active === "object" ? placement.active : null;
    const latest = placement.latest && typeof placement.latest === "object" ? placement.latest : null;
    const planSrc = src.plan && typeof src.plan === "object" ? src.plan : {};
    const adaptiveSrc = src.adaptive && typeof src.adaptive === "object" ? src.adaptive : {};
    const eventRows = Array.isArray(src.events) ? src.events : [];
    const safeEvents = eventRows.filter(row => row && typeof row.type === "string" && validTime(row.at, now)).map(row => ({
        type: String(row.type).slice(0, 32), at: row.at,
        durationMs: Number.isFinite(row.durationMs) ? clamp(Math.round(row.durationMs), 0, 86400000) : 0,
        meta: cleanMeta(row.meta)
      }));
    const oldEvents = safeEvents.filter(row => row.at < now - 60 * DAY);
    const aggregates = rollupExpired(cleanAggregates(src.aggregates), oldEvents, now);
    const events = safeEvents.filter(row => row.at >= now - 60 * DAY).slice(-600);
    const methodsSrc = adaptiveSrc.methods && typeof adaptiveSrc.methods === "object" ? adaptiveSrc.methods : {};
    const methods = Object.fromEntries(METHODS.map(method => {
      const value = methodsSrc[method] && typeof methodsSrc[method] === "object" ? methodsSrc[method] : {};
      return [method, { trials: clamp(Math.floor(Number(value.trials) || 0), 0, 10000), reward: clamp(Number(value.reward) || 0, 0, 10000) }];
    }));
    const exposure = placement.exposure && typeof placement.exposure === "object" ? Object.fromEntries(
      Object.entries(placement.exposure).filter(([id, count]) => /^[a-z0-9-]{3,80}$/u.test(id) && Number.isInteger(count) && count >= 0).slice(0, 400)
    ) : {};
    return {
      schemaVersion: 2,
      updated: validTime(src.updated, now) ? src.updated : 0,
      placement: {
        assessmentCount: clamp(Math.floor(Number(placement.assessmentCount) || 0), 0, 100000),
        exposure,
        active: active && active.session && typeof active.session === "object" ? {
          session: cleanSession(active.session), currentQuestionId: String(active.currentQuestionId || "").slice(0, 80),
          pausedAt: validTime(active.pausedAt, now) ? active.pausedAt : null,
          questionAt: validTime(active.questionAt, now) ? active.questionAt : now,
          mode: active.mode === "mini" ? "mini" : "full",
          feedback: active.feedback && typeof active.feedback === "object" ? { unknown: active.feedback.unknown === true, correct: active.feedback.correct === true, key: String(active.feedback.key || "").slice(0, 240), why: String(active.feedback.why || "").slice(0, 400) } : null
        } : null,
        latest: latest ? cleanAssessment(latest, now) : null,
        history: (Array.isArray(placement.history) ? placement.history : []).filter(row => row && validTime(row.at, now)).slice(-24).map(row => cleanAssessment(row, now)).filter(Boolean),
        legacy: cleanLegacy(placement.legacy),
        speaking: cleanSpeaking(placement.speaking, now),
        speakingTest: cleanSpeakingTest(placement.speakingTest, now)
      },
      plan: {
        dailyMinutes: [5, 10, 20].includes(planSrc.dailyMinutes) ? planSrc.dailyMinutes : null,
        startedAt: validTime(planSrc.startedAt, now) ? planSrc.startedAt : 0,
        updated: validTime(planSrc.updated, now) ? planSrc.updated : 0,
        lastRebuilt: validTime(planSrc.lastRebuilt, now) ? planSrc.lastRebuilt : 0
      },
      adaptive: {
        mode: cleanMode(adaptiveSrc.mode),
        modeUpdated: validTime(adaptiveSrc.modeUpdated, now) ? adaptiveSrc.modeUpdated : 0,
        manual: adaptiveSrc.manual === true,
        methods,
        recall: cleanRecall(adaptiveSrc.recall),
        outcomes: (Array.isArray(adaptiveSrc.outcomes) ? adaptiveSrc.outcomes : []).filter(row => row && validTime(row.at, now)).slice(-60).map(row => ({at:row.at,reward:clamp(Number(row.reward)||0,0,1),method:cleanMode(row.method),source:String(row.source||"").slice(0,24)}))
      },
      events,
      aggregates
    };
  }

  function cleanMeta(meta) {
    if (!meta || typeof meta !== "object") return {};
    const safe = {};
    for (const key of ["tab", "part", "grade", "mode", "status", "skill", "count", "score", "theta", "hour", "retry", "abandoned"]) {
      const value = meta[key];
      if (typeof value === "string") safe[key] = value.slice(0, 40);
      else if (typeof value === "number" && Number.isFinite(value)) safe[key] = value;
      else if (typeof value === "boolean") safe[key] = value;
    }
    return safe;
  }
  function cleanSession(value) {
    const session = value && typeof value === "object" ? value : {};
    return {
      schemaVersion: 1, id: String(session.id || "").slice(0, 80), status: ["active", "paused", "complete"].includes(session.status) ? session.status : "active",
      theta: Number.isFinite(session.theta) ? clamp(session.theta, -8, 10) : 0,
      se: Number.isFinite(session.se) ? clamp(session.se, .1, 10) : 3.5,
      startedAt: Number.isFinite(session.startedAt) ? session.startedAt : Date.now(), updatedAt: Number.isFinite(session.updatedAt) ? session.updatedAt : Date.now(),
      questionIds: Array.isArray(session.questionIds) ? session.questionIds.filter(id => typeof id === "string").slice(-20) : [],
      answers: Array.isArray(session.answers) ? session.answers.slice(-20).map(row => ({itemId:String(row.itemId||""),level:LEVELS.includes(row.level)?row.level:"B1",skills:Array.isArray(row.skills)?row.skills.filter(x=>typeof x==="string").slice(0,4):[],choice:Number.isInteger(row.choice)&&row.choice>=0&&row.choice<8?row.choice:null,correct:row.correct===true,unknown:row.unknown===true,spentMs:Number.isFinite(row.spentMs)?clamp(Math.round(row.spentMs),0,3600000):null,difficulty:Number.isFinite(row.difficulty)?row.difficulty:0,answeredAt:Number.isFinite(row.answeredAt)?row.answeredAt:Date.now()})) : [],
      skillStats: session.skillStats && typeof session.skillStats === "object" ? Object.fromEntries(Object.entries(session.skillStats).slice(0,120).map(([key,row]) => [key,{attempts:clamp(Number(row?.attempts)||0,0,20),correct:clamp(Number(row?.correct)||0,0,20),unknown:clamp(Number(row?.unknown)||0,0,20)}])) : {},
      completedAt: Number.isFinite(session.completedAt) ? session.completedAt : null
    };
  }
  function cleanAssessment(value, now) {
    if (!value || !Number.isFinite(value.at) || !LEVELS.includes(value.level)) return null;
    const answerFeedback=Array.isArray(value.answerFeedback)?value.answerFeedback.slice(0,20).map(row=>({itemId:String(row.itemId||"").slice(0,80),level:LEVELS.includes(row.level)?row.level:"B1",stem:String(row.stem||"").slice(0,500),selected:String(row.selected||"").slice(0,240),key:String(row.key||"").slice(0,240),why:String(row.why||"").slice(0,400),correct:row.correct===true,unknown:row.unknown===true,skills:Array.isArray(row.skills)?row.skills.filter(x=>typeof x==="string").slice(0,4).map(x=>x.slice(0,40)):[]})):[];
    return {at:value.at,mode:value.mode==="mini"?"mini":value.mode==="full"?"full":"legacy",level:value.level,theta:Number.isFinite(value.theta)?value.theta:null,se:Number.isFinite(value.se)?value.se:null,confidence:["low","medium","high"].includes(value.confidence)?value.confidence:"low",interval:Array.isArray(value.interval)?value.interval.filter(level=>LEVELS.includes(level)).slice(0,2):[],lastFeedback:value.lastFeedback&&typeof value.lastFeedback==="object"?{why:String(value.lastFeedback.why||"").slice(0,400),key:String(value.lastFeedback.key||"").slice(0,240),unknown:value.lastFeedback.unknown===true,correct:value.lastFeedback.correct===true}:null,answerFeedback,asked:clamp(Math.floor(Number(value.asked)||0),0,20),unknown:clamp(Math.floor(Number(value.unknown)||0),0,20),heatmap:Array.isArray(value.heatmap)?value.heatmap.slice(0,120).map(row=>({skill:String(row.skill||"").slice(0,40),attempts:clamp(Number(row.attempts)||0,0,20),unknown:clamp(Number(row.unknown)||0,0,20),accuracy:Number.isFinite(row.accuracy)?clamp(row.accuracy,0,1):null,status:String(row.status||"insufficient")})):[],band:LEVELS.includes(value.level)?value.band||null:null};
  }
  function cleanLegacy(value) {
    if (!value || !Number.isInteger(value.score) || value.score < 0 || value.score > 8) return null;
    return {score:value.score,at:Number.isFinite(value.at)?value.at:0,source:"tf-placement-v1",confidence:"low"};
  }
  function cleanSpeaking(value, now) {
    const src=value&&typeof value==="object"?value:{};
    const tasks=Array.isArray(src.tasks)?src.tasks.slice(-3).map(row=>({part:[1,2,3].includes(row.part)?row.part:1,at:Number.isFinite(row.at)?row.at:now,f:Number.isFinite(row.f)?clamp(row.f,0,9):null,l:Number.isFinite(row.l)?clamp(row.l,0,9):null,g:Number.isFinite(row.g)?clamp(row.g,0,9):null,p:Number.isFinite(row.p)?clamp(row.p,0,9):null,o:Number.isFinite(row.o)?clamp(row.o,0,9):null,valid:row.valid===true})):[];
    return tasks.length?{at:Number.isFinite(src.at)?src.at:tasks.at(-1).at,tasks,valid:src.valid===true&&tasks.length===3}:null;
  }
  function cleanSpeakingTest(value, now) {
    if (!value || typeof value !== "object") return null;
    const parts = Array.isArray(value.parts) ? [...new Set(value.parts.filter(part => [1,2,3].includes(part)))].sort() : [];
    const validResponses = clamp(Math.floor(Number(value.validResponses) || 0), 0, 7);
    const responses = clamp(Math.floor(Number(value.responses) || 0), 0, 7);
    const scores = {};
    for (const key of ["f", "l", "g", "p", "o"]) scores[key] = Number.isFinite(value[key]) ? clamp(value[key], 0, 9) : null;
    const valid = value.valid === true && parts.length === 3 && validResponses === 7 && responses === 7 && Number.isFinite(scores.o);
    return {
      at: validTime(value.at, now) ? value.at : 0,
      lastAttemptAt: validTime(value.lastAttemptAt, now) ? value.lastAttemptAt : (validTime(value.at, now) ? value.at : 0),
      lastAttemptValid: value.lastAttemptValid === true,
      examId: String(value.examId || "").slice(0, 80),
      parts, responses, validResponses, valid, ...scores
    };
  }
  function cleanRecall(value) {
    const src=value&&typeof value==="object"?value:{};
    const bins={};for(const day of [1,3,7]){const row=src[day]&&typeof src[day]==="object"?src[day]:{};bins[day]={seen:clamp(Number(row.seen)||0,0,10000),remembered:clamp(Number(row.remembered)||0,0,10000)}}return bins;
  }
  function cleanAggregates(value) {
    const src=value&&typeof value==="object"?value:{};
    const totals=src.totals&&typeof src.totals==="object"?src.totals:{};
    return {totals:{sessions:clamp(Number(totals.sessions)||0,0,1e7),minutes:clamp(Number(totals.minutes)||0,0,1e9),retries:clamp(Number(totals.retries)||0,0,1e7),abandoned:clamp(Number(totals.abandoned)||0,0,1e7),scores:clamp(Number(totals.scores)||0,0,1e7)},weeks:(Array.isArray(src.weeks)?src.weeks:[]).slice(-20).map(row=>({week:Number.isFinite(row.week)?row.week:0,sessions:clamp(Number(row.sessions)||0,0,1e7),minutes:clamp(Number(row.minutes)||0,0,1e9),retries:clamp(Number(row.retries)||0,0,1e7),abandoned:clamp(Number(row.abandoned)||0,0,1e7)}))};
  }

  function rollupExpired(aggregates, old, now = Date.now()) {
    if (!old.length) return aggregates;
    const byWeek = new Map((aggregates.weeks||[]).map(row=>[row.week,{...row}]));
    const totals={...aggregates.totals};
    for (const event of old) {
      const week = Math.floor(event.at / (7 * DAY));
      const row = byWeek.get(week) || {week,sessions:0,minutes:0,retries:0,abandoned:0};
      if (event.type === "study-session") { row.sessions += 1; row.minutes += (event.durationMs || 0) / 60000; totals.sessions+=1; totals.minutes+=(event.durationMs||0)/60000; }
      if (event.type === "retry") { row.retries += 1; totals.retries+=1; }
      if (event.type === "abandoned") { row.abandoned += 1; totals.abandoned+=1; }
      if (event.type === "speaking-score" || event.type === "placement-result") totals.scores+=1;
      byWeek.set(week,row);
    }
    return {totals,weeks:[...byWeek.values()].filter(row=>row.week*7*DAY>=now-180*DAY).sort((a,b)=>a.week-b.week).slice(-20)};
  }

  function validSpeakingRows(history, transcriptById, now = Date.now(), currentVersion = 19) {
    const rows = (Array.isArray(history) ? history : []).filter(row => row && row.kind !== "exam" && Number.isFinite(row.d) && row.d >= now - 365 * DAY)
      .map(row => {
        const text = String(transcriptById?.[row.id]?.text || "");
        const signal = englishSignal(text);
        const scores = [row.f,row.l,row.g].filter(value => Number.isFinite(value) && value >= 0 && value <= 9);
        const acoustic = Number.isFinite(row.p) && row.p >= 0 && row.p <= 9;
        const valid = signal.words >= 12 && signal.ratio >= .7 && scores.length >= 2 && Number.isFinite(row.o) && row.o >= 0 && row.o <= 9 && acoustic;
        const version = Number.isInteger(row.scoreVersion) ? row.scoreVersion : 0;
        return valid ? {...row, weight:version >= 10 && version <= currentVersion ? 1 : .25, textWords:signal.words} : null;
      }).filter(Boolean);
    return rows.sort((a,b)=>a.d-b.d);
  }

  function estimateEffectiveness(rows, recall = {}, studyMinutes = 0) {
    const valid = (Array.isArray(rows)?rows:[]).filter(row=>row&&Number.isFinite(row.o)&&Number.isFinite(row.d)&&row.weight!==0);
    if (valid.length < 3) return {status:"insufficient",reason:"Cần ít nhất 3 lượt nói hợp lệ để so sánh xu hướng.",medianBand:null,change:null,recallRates:{1:null,3:null,7:null},pointsPerHour:null};
    const recent = valid.slice(-3), previous = valid.slice(-6,-3);
    const weightedMedian = rows => {
      const sorted=[...rows].sort((a,b)=>a.o-b.o),total=sorted.reduce((sum,row)=>sum+(Number(row.weight)||1),0);
      let weight=0;for(const row of sorted){weight+=(Number(row.weight)||1);if(weight>=total/2)return row.o}return sorted.at(-1)?.o??null;
    };
    const medianBand = weightedMedian(recent);
    const change = previous.length === 3 ? medianBand - weightedMedian(previous) : null;
    const recallRates = {};
    for (const day of [1,3,7]) { const row=recall?.[day]||{}; recallRates[day]=row.seen ? row.remembered/row.seen : null; }
    const durationHours = Math.max(.25,(Number(studyMinutes)||0)/60);
    const pointsPerHour = change==null ? null : change/durationHours;
    let status="stalled",reason="Điểm trung vị gần như ổn định; tiếp tục luyện rồi đo lại sau vài lượt.";
    if (change == null) { status="insufficient"; reason="Chưa có đủ hai nhóm lượt hợp lệ để so sánh xu hướng."; }
    else if (change >= .25) { status="improving"; reason="Trung vị của ba lượt gần nhất cao hơn nhóm trước; đây vẫn là ước tính luyện tập."; }
    else if (change <= -.25) { status="declining"; reason="Trung vị gần đây giảm; hãy giảm khối lượng và ôn các kỹ năng ưu tiên."; }
    return {status,reason,medianBand,change,recallRates,pointsPerHour};
  }

  function assessFeasibility(currentLevel, targetBand, daysRemaining) {
    const current = LEVELS.indexOf(currentLevel);
    if (current < 0 || !Number.isFinite(targetBand)) return {label:"chưa đủ dữ liệu",note:"Cần hồ sơ trình độ và mục tiêu để ước lượng khoảng cách."};
    const approx = [2.75,3.5,4.75,5.75,6.75,7.75][current];
    const gap = targetBand - approx;
    if (gap <= .5) return {label:"khả thi",note:"Mục tiêu gần với hồ sơ hiện tại; vẫn cần theo dõi bằng các lần kiểm tra lại."};
    if (!Number.isFinite(daysRemaining) || daysRemaining <= 0) return {label:"chưa thực tế",note:"Ngày thi đã qua hoặc chưa được đặt; hãy chọn khoảng thời gian mới để lập kế hoạch."};
    const weeks = daysRemaining / 7;
    if (gap >= 2 && weeks < 20 || gap >= 1.5 && weeks < 10) return {label:"chưa thực tế",note:"Khoảng cách mục tiêu và thời gian khá lớn; nên cân nhắc thêm thời gian hoặc chia mục tiêu thành chặng nhỏ."};
    if (gap >= 1 && weeks < 12 || gap >= .5 && weeks < 6) return {label:"chặt",note:"Kế hoạch có thể khá chặt; hãy kiểm tra lại sau mỗi hai tuần và điều chỉnh khi cần."};
    return {label:"khả thi",note:"Thời gian có thể đủ để luyện đều, nhưng kết quả không được đảm bảo."};
  }

  function makePlan(options = {}) {
    const setup=options.setup||{},minutes=clamp(Number(setup.minutes)||10,5,120),requested=[5,10,20].includes(options.dailyMinutes)?options.dailyMinutes:([5,10,20].includes(minutes)?minutes:minutes<10?5:minutes<20?10:20);
    const dailyMinutes=Math.min(requested,minutes),weak=(Array.isArray(options.weakSkills)?options.weakSkills:[]).slice(0,3);
    const level=LEVELS.includes(options.level)?options.level:"B1",target=Number.isFinite(setup.target)?setup.target:null;
    const days=setup.examDate?Math.ceil((Date.parse(setup.examDate+"T00:00:00Z")-(Number.isFinite(options.now)?options.now:Date.now()))/DAY):null;
    const feasibility=target?assessFeasibility(level,target,days):{label:"chưa đủ dữ liệu",note:"Đặt mục tiêu band để xem khoảng cách; có thể bỏ qua."};
    const stages=["Nền tảng","Củng cố","Tăng tốc","Luyện đề"],totalWeeks=clamp(Math.ceil((days||56)/7),4,52),weeksPerStage=Math.ceil(totalWeeks/4);
    const now=Number.isFinite(options.now)?options.now:Date.now(),anchor=Number.isFinite(options.anchorAt)?options.anchorAt:now,dayIndex=Math.max(0,Math.floor((now-anchor)/DAY));
    const activeStageIndex=Math.min(3,Math.floor(dayIndex/(weeksPerStage*7)));
    const stageTasks=stages.map((title,index)=>({title,week:`${index*weeksPerStage+1}–${Math.min(totalWeeks,(index+1)*weeksPerStage)}`,focus:weak[index%Math.max(1,weak.length)]||"ôn tập xen kẽ",minutes:dailyMinutes,activities:activitiesFor(index,weak,level,dailyMinutes)}));
    return {dailyMinutes,weakSkills:weak,level,targetBand:target,daysRemaining:days,feasibility,stages:stageTasks,activeStageIndex,dayIndex,todayActivities:activitiesFor(activeStageIndex,weak,level,dailyMinutes,dayIndex),weekOneTargetShare:weak.length?1:0};
  }
  function activitiesFor(stage, weak, level, dailyMinutes = 10, dayIndex = 0) {
    const skills=weak.length?weak:["vocabulary","fluency"];
    const blocks=dailyMinutes<=5?1:dailyMinutes<=10?2:4;
    const recipes=[
      {kind:"lesson",label:"Bài học tiếng Anh",skill:skills[0]},
      {kind:"vocabulary",label:"Học một nhóm từ theo chủ đề",skill:skills[1]||skills[0],level},
      {kind:"speaking",label:stage>1?"Luyện nói Part 3":"Luyện nói Part 1",part:stage>1?3:1,skill:skills[2]||skills[0]},
      {kind:stage===3?"mock":"flashcards",label:stage===3?"Thi thử Part 1–3":"Ôn thẻ đến hạn",skill:skills[0]}
    ];
    const start=(stage+Math.max(0,dayIndex))%recipes.length;
    return Array.from({length:blocks},(_,index)=>({...recipes[(start+index)%recipes.length],minutes:Math.floor(dailyMinutes/blocks)+(index<dailyMinutes%blocks?1:0)}));
  }

  function chooseMode(adaptive, now = Date.now(), preferred = null) {
    if (preferred && METHODS.includes(preferred)) return preferred;
    const src=adaptive&&typeof adaptive==="object"?adaptive:{};
    const current=cleanMode(src.mode),updated=Number(src.modeUpdated)||0;
    if (src.manual===true || now-updated<7*DAY) return current;
    const methods=src.methods&&typeof src.methods==="object"?src.methods:{};
    const total=METHODS.reduce((sum,key)=>sum+(Number(methods[key]?.trials)||0),0);
    let best=current,bestValue=-Infinity;
    for(const method of METHODS){const row=methods[method]||{},n=Number(row.trials)||0,mean=n?(Number(row.reward)||0)/n:.55;const ucb=mean+Math.sqrt(2*Math.log(total+2)/(n+1));if(ucb>bestValue){bestValue=ucb;best=method}}
    const currentRow=methods[current]||{},currentN=Number(currentRow.trials)||0,currentMean=currentN?(Number(currentRow.reward)||0)/currentN:.55;
    const nextRow=methods[best]||{},nextN=Number(nextRow.trials)||0,nextMean=nextN?(Number(nextRow.reward)||0)/nextN:.55;
    return best===current||nextN<2||nextMean<=currentMean+.08?current:best;
  }

  function bandApprox(level) {
    return ({A1:"2.5–3.0",A2:"3.0–4.0",B1:"4.0–5.0",B2:"5.0–6.0",C1:"6.0–7.0",C2:"7.0–8.5"})[level]||"—";
  }

  function behaviorSuggestion(profile, now = Date.now()) {
    const rows=(profile?.events||[]).filter(row=>row.at>=now-14*DAY),durations=rows.filter(row=>row.type==="study-session").map(row=>row.durationMs/60000),retries=rows.filter(row=>row.type==="retry").length,abandoned=rows.filter(row=>row.type==="abandoned").length,opens=rows.filter(row=>row.type==="session-open"),lessonOpens=opens.filter(row=>row.meta?.tab==="les").length,speakingOpens=opens.filter(row=>row.meta?.tab==="prac").length,gameOpens=opens.filter(row=>row.meta?.tab==="games").length;
    const short=durations.length>=3&&median(durations)<7;
    if(short)return {mode:"brief",focus:"Chia bài thành chặng ngắn, mỗi lần làm một việc nhỏ.",why:"Các phiên gần đây thường ngắn; bài học gọn giúp bạn dễ quay lại."};
    if(retries>=3)return {mode:"examples",focus:"Xem thêm ví dụ rồi thử lại từng câu.",why:"Bạn thường thu âm lại nhiều lần; thêm mẫu minh họa có thể giúp chuẩn bị trước khi nói."};
    if(abandoned>=2)return {mode:"bilingual",focus:"Bật gợi ý tiếng Việt trước khi trả lời.",why:"Một vài phiên bị bỏ dở; gợi ý song ngữ có thể giảm bước khởi động."};
    if(lessonOpens>=4&&speakingOpens<=1)return {mode:"audio",focus:"Thêm một câu trả lời nói ngắn sau mỗi bài học.",why:"Gần đây bạn mở bài học nhiều hơn phần luyện nói; thử một lượt ghi âm ngắn để đổi hoạt động."};
    if(gameOpens>=3)return {mode:"game",focus:"Dùng một lượt trò chơi làm phần khởi động, rồi ôn lại từ đã nhớ.",why:"Bạn thường chọn hoạt động trò chơi; ghép trò chơi với bài ôn giúp chuyển hứng thú thành nhớ lại."};
    return {mode:chooseMode(profile?.adaptive,now),focus:"Xen kẽ từ vựng, nghe và một câu trả lời ngắn.",why:"Chưa thấy dấu hiệu đủ rõ để đổi cách học mạnh; giữ nhịp ổn định rồi đo lại."};
  }

  return Object.freeze({DAY,LEVELS,METHODS,clamp,median,englishSignal,cleanProfile,validSpeakingRows,estimateEffectiveness,assessFeasibility,makePlan,chooseMode,behaviorSuggestion,bandApprox});
});
