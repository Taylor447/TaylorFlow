(function(){
 'use strict';
 const STORE='taylorflow-skill-tests-v1';
 const NOTICE='Bài luyện theo định dạng IELTS, không phải đề chính thức. IELTS là thương hiệu của chủ sở hữu tương ứng; TaylorFlow không liên kết hay được chứng nhận.';
 const labels={listening:'Nghe',reading:'Đọc',writing:'Viết',speaking:'Nói'};
 const typeNames={'form-completion':'Điền thông tin','note-completion':'Điền ghi chú','multiple-choice':'Chọn đáp án','matching':'Nối thông tin', 'short-answer':'Trả lời ngắn',tfng:'Đúng / Sai / Không có thông tin',ynng:'Có / Không / Không có thông tin','heading-matching':'Nối tiêu đề','sentence-completion':'Điền câu','information-matching':'Nối thông tin'};
 const hints={'form-completion':'Nghe các từ xung quanh chỗ trống để xác định thông tin cần điền.','note-completion':'Chú ý từ khóa ngay trước và sau phần còn thiếu.','multiple-choice':'Tìm ý được nói rõ; đừng chọn chỉ vì nghe thấy một từ giống trong đáp án.','matching':'Đối chiếu từng lựa chọn với chi tiết được nhắc đến.','short-answer':'Trả lời gọn và kiểm tra giới hạn số từ nếu có.','tfng':'TRUE là có thông tin ủng hộ; FALSE là có thông tin trái ngược; NOT GIVEN là bài không nói.','ynng':'YES/NO xét quan điểm của tác giả, còn NOT GIVEN là không thể xác định.','heading-matching':'Tìm ý chính của cả đoạn thay vì chọn theo một từ riêng lẻ.','sentence-completion':'Đọc ngữ pháp quanh chỗ trống và chú ý giới hạn số từ.','information-matching':'Tìm đoạn có thông tin tương ứng, không chỉ từ vựng giống nhau.'};
 const tasks={
  task1:{title:'Task 1 · Mô tả số liệu',minutes:20,prompt:'The table shows how 120 students travelled to a local college in 2024. Summarise the information by selecting and reporting the main features, and make comparisons where relevant.',data:[['Car',42],['Bus',38],['Bicycle',25],['On foot',15]],tip:'Viết phần tổng quan trước, rồi nêu các số liệu nổi bật và so sánh. Dữ liệu này do TaylorFlow tự tạo.'},
  task2:{title:'Task 2 · Nêu ý kiến',minutes:40,prompt:'Some people think university students should complete a work placement before they graduate. To what extent do you agree or disagree? Give reasons and examples from your own knowledge or experience.',data:[],tip:'Nêu rõ quan điểm, giải thích từng lý do và kết lại bằng một câu trả lời trực tiếp cho đề.'}
 };
 let state=readState(),indexCache=null,loaded=new Map(),voices=[],observer=null,clockHandle=0,speechToken=0,moduleSpeechActive=false,modulePlaybackActive=false,currentAudio=null;
 function blankState(){return{version:1,skill:'speaking',filters:{listening:{type:'all',topic:'all',level:'all'},reading:{type:'all',topic:'all',level:'all'}},attempts:{},missed:{},marks:{},notes:{},drafts:{task1:'',task2:''},active:null,lastResult:null,voice:{a:'',b:'',rate:0.95}}}
 function readState(){
  try{const value=JSON.parse(localStorage.getItem(STORE)||'null');if(value&&value.version===1)return Object.assign(blankState(),value,{filters:Object.assign(blankState().filters,value.filters||{}),voice:Object.assign(blankState().voice,value.voice||{}),drafts:Object.assign(blankState().drafts,value.drafts||{})})}catch{}
  return blankState()
 }
 function save(){try{localStorage.setItem(STORE,JSON.stringify(state))}catch{}}
 function h(value){return String(value==null?'':value).replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]))}
 function clamp(value,min,max){return Math.max(min,Math.min(max,value))}
 function skill(){return ['speaking','listening','reading','writing'].includes(state.skill)?state.skill:'speaking'}
 function bar(){
  return '<nav class="tf-skill-switch" aria-label="Chọn cách luyện tập">'+['speaking','listening','reading','writing'].map(key=>'<button type="button" aria-pressed="'+(skill()===key)+'" onclick="window.TFTestApp.switchSkill(\''+key+'\')">'+labels[key]+'</button>').join('')+'</nav>';
 }
 function pageShell(selected){
  return '<section class="tf-tests-main" id="tf-tests-main" data-skill="'+h(selected)+'"><div class="tf-tests-loading" role="status">Đang mở nội dung…</div></section>';
 }
 function syncPractice(){
  const main=document.getElementById('m');if(!main)return;
  if(main.dataset.route!=='prac'){window.TFWritingCoach?.suspend?.();if(moduleSpeechActive||modulePlaybackActive||currentAudio)stopSpeech();return}
  const selected=skill();
  if(selected!=='writing')window.TFWritingCoach?.suspend?.();
  if(selected==='speaking'){
   if(main.querySelector('#tf-tests-main')){if(typeof window.openView==='function'){window.openView();return}}
   if(!main.querySelector('.tf-skill-switch'))main.insertAdjacentHTML('afterbegin',bar());
   return;
  }
  if(main.querySelector('#tf-tests-main')?.dataset.skill===selected)return;
  main.innerHTML=bar()+pageShell(selected);
  paint();
 }
 function switchSkill(next){
  if(!labels[next])return;
  if(next!==skill())stopSpeech();
  state.skill=next;save();
  if(next==='speaking'&&typeof window.openView==='function'){window.openView();return}
  syncPractice();
 }
 async function loadScript(name,key){
  if(window.TF_TEST_DATA?.[key])return window.TF_TEST_DATA[key];
  await new Promise((resolve,reject)=>{
   const script=document.createElement('script');script.src=new URL('./assets/tests/'+name,document.baseURI).href;script.async=true;
   script.onload=resolve;script.onerror=()=>reject(new Error('Tệp dự phòng ngoại tuyến chưa sẵn sàng.'));
   document.head.appendChild(script);
  });
  const value=window.TF_TEST_DATA?.[key];if(!value)throw new Error('Tệp dự phòng không có dữ liệu.');
  return value;
 }
 async function loadJson(name,fallback,key){
  try{
   const response=await fetch(new URL('./assets/tests/'+name,document.baseURI).href,{cache:'no-cache'});
   if(response.ok)return await response.json();
  }catch{}
  return loadScript(fallback,key);
 }
 async function ensureIndex(){
  if(indexCache)return indexCache;
  indexCache=await loadJson('index.json','index.js','index');
  return indexCache;
 }
 async function ensureTest(id){
  if(loaded.has(id))return loaded.get(id);
  const promise=loadJson(id+'.json',id+'.js',id);
  loaded.set(id,promise);
  try{return await promise}catch(error){loaded.delete(id);throw error}
 }
 function root(){return document.getElementById('tf-tests-main')}
 function paint(){
  const target=root();if(!target)return;
  const selected=target.dataset.skill;
  if(selected==='writing'){renderWriting(target);return}
  if(state.active&&state.active.skill===selected){void renderActive(target,state.active);return}
  if(state.lastResult&&state.lastResult.skill===selected){resultPage(target,state.lastResult);return}
  void renderCatalog(target,selected);
 }
 function formatType(type){return typeNames[type]||type.replace(/-/g,' ')}
 function allTypes(meta){return meta.questionTypes||[]}
 function getMeta(id){return indexCache?.tests?.find(item=>item.id===id)}
 function statusText(message){const node=document.getElementById('tf-test-status');if(node)node.textContent=message}
 function renderCatalog(target,selected){
  const old=target.dataset.catalogSkill;
  if(old===selected&&target.dataset.catalogReady==='true'&&!state.active)return;
  target.dataset.catalogSkill=selected;target.dataset.catalogReady='false';
  target.innerHTML='<div class="tf-tests-loading" role="status">Đang nạp danh sách bài…</div>';
  ensureIndex().then(manifest=>{
   if(!root()||skill()!==selected||state.active?.skill===selected)return;
   indexCache=manifest;
   const all=(manifest.tests||[]).filter(item=>item.skill===selected&&item.status==='ready');
   const filters=state.filters[selected]||{type:'all',topic:'all',level:'all'};
   const typeSet=[...new Set(all.flatMap(meta=>allTypes(meta)))].sort();
   const topicSet=[...new Set(all.flatMap(meta=>meta.topics||[]))].sort();
   const levelSet=[...new Set(all.map(meta=>meta.level))].sort();
   const filtered=all.filter(meta=>(filters.type==='all'||meta.questionTypes.includes(filters.type))&&(filters.topic==='all'||meta.topics.includes(filters.topic))&&(filters.level==='all'||meta.level===filters.level));
   const missed=Object.values(state.missed||{}).filter(item=>getMeta(item.testId)?.skill===selected);
   let html='<div class="tf-tests-intro"><div><p class="eyebrow">Luyện tập · '+labels[selected]+'</p><h1>Kho bài '+(selected==='listening'?'nghe':'đọc')+'</h1><p>Chọn một bài để làm theo thời gian hoặc luyện từng câu có gợi ý.</p></div><p class="tf-tests-notice">'+h(manifest.notice||NOTICE)+'</p></div>';
   if(state.active&&state.active.skill===selected){html+='<section class="tf-test-resume"><div><strong>Bạn có bài đang làm dở</strong><p>'+h(getMeta(state.active.testId)?.title||'Bài luyện')+' · '+(state.active.mode==='exam'?'bài thi thử':'lượt luyện')+'</p></div><button type="button" class="tf-primary" onclick="window.TFTestApp.resume()">Tiếp tục</button></section>'}
   html+='<details class="tf-tests-panel tf-test-advanced"><summary>Nâng cao · lọc bài</summary><div class="tf-test-filters"><label>Dạng câu<select onchange="window.TFTestApp.setFilter(\'type\',this.value)"><option value="all">Tất cả</option>'+typeSet.map(type=>'<option value="'+h(type)+'"'+(filters.type===type?' selected':'')+'>'+h(formatType(type))+'</option>').join('')+'</select></label><label>Chủ đề<select onchange="window.TFTestApp.setFilter(\'topic\',this.value)"><option value="all">Tất cả</option>'+topicSet.map(topic=>'<option value="'+h(topic)+'"'+(filters.topic===topic?' selected':'')+'>'+h(topic)+'</option>').join('')+'</select></label><label>Độ khó<select onchange="window.TFTestApp.setFilter(\'level\',this.value)"><option value="all">Tất cả</option>'+levelSet.map(level=>'<option value="'+h(level)+'"'+(filters.level===level?' selected':'')+'>'+h(level)+'</option>').join('')+'</select></label></div></details>';
   html+='<section class="tf-test-grid" aria-label="Các đề luyện">';
   if(!filtered.length)html+='<p class="tf-test-empty">Không có bài nào khớp các lựa chọn lọc.</p>';
   for(const meta of filtered){
    const stats=state.attempts[meta.id]||{count:0,best:null};
    html+='<article class="tf-test-card"><div class="tf-test-card-head"><div><span class="tf-test-kicker">'+h(meta.category)+'</span><h2>'+h(meta.title)+'</h2><span class="tf-test-kicker">'+h(meta.level)+'</span></div><span class="tf-test-chip">'+labels[meta.skill]+'</span></div><p class="tf-test-stats"><span>'+meta.questionCount+' câu</span><span>'+meta.sectionCount+' phần</span><span>Khoảng '+meta.minutes+' phút</span></p><p class="tf-test-stats"><span>'+stats.count+' lượt đã làm</span><span>Tốt nhất: '+(stats.best==null?'chưa có':stats.best+'/'+meta.questionCount)+'</span></p><div class="tf-test-actions"><button type="button" class="tf-primary" onclick="window.TFTestApp.start(\''+h(meta.id)+'\',\'exam\')">Làm cả đề</button><button type="button" class="tf-secondary" onclick="window.TFTestApp.start(\''+h(meta.id)+'\',\'practice\')">Luyện kèm</button></div><details class="tf-test-advanced"><summary>Luyện từng phần</summary><div class="tf-test-section-actions" id="tf-sections-'+h(meta.id)+'"><button type="button" onclick="window.TFTestApp.loadSections(\''+h(meta.id)+'\',this)">Chọn phần</button></div></details></article>';
   }
   html+='</section><section class="tf-tests-panel"><div class="tf-test-toolbar"><div><h2>Cần ôn</h2><p>Câu sai được lưu trên thiết bị này.</p></div><strong>'+missed.length+' câu</strong></div>';
   if(missed.length)html+='<ul class="tf-test-wrong-list">'+missed.map(item=>'<li><span>'+h(item.prompt)+'<br><small>'+h(getMeta(item.testId)?.title||'')+'</small></span><button type="button" onclick="window.TFTestApp.review(\''+h(item.testId)+'\',\''+h(item.questionId)+'\')">Ôn câu này</button></li>').join('')+'</ul>';
   else html+='<p class="tf-test-empty">Chưa có câu sai cần ôn. Khi làm bài, câu trả lời sai sẽ tự lưu ở đây.</p>';
   html+='</section><p id="tf-test-status" class="tf-writing-status" role="status" aria-live="polite"></p>';
   target.innerHTML=html;target.dataset.catalogReady='true';
  }).catch(error=>{
   if(root()&&skill()===selected)target.innerHTML='<section class="tf-tests-panel"><h2>Chưa mở được kho bài</h2><p>'+h(error.message||'Hãy thử lại khi các tệp ngoại tuyến đã sẵn sàng.')+'</p><button type="button" onclick="window.TFTestApp.refresh()">Thử lại</button></section>';
  });
 }
 function setFilter(key,value){
  const selected=skill();state.filters[selected]=Object.assign({type:'all',topic:'all',level:'all'},state.filters[selected]||{},{[key]:value});save();const target=root();if(target){target.dataset.catalogReady='false';renderCatalog(target,selected)}
 }
 async function loadSections(id,button){
  const box=button?.parentElement;if(!box)return;
  try{
   const data=await ensureTest(id);
   box.innerHTML=data.sections.map((section,index)=>'<button type="button" class="tf-secondary" onclick="window.TFTestApp.start(\''+h(id)+'\',\'section-practice\',\''+h(section.id)+'\')">Luyện phần '+(index+1)+' · '+h(section.title)+'</button>').join('');
  }catch{box.innerHTML='<p class="tf-test-empty">Chưa nạp được các phần của bài này.</p>'}
 }
 function start(id,mode,sectionId){
  const meta=getMeta(id);if(!meta)return;
  state.skill=meta.skill;
  state.active={testId:id,skill:meta.skill,mode:mode,sectionId:sectionId||'',onlyQuestionId:'',answers:{},checked:{},played:[],pane:'passage',startedAt:Date.now(),endsAt:mode==='exam'?Date.now()+meta.minutes*60000:0};
  state.lastResult=null;save();syncPractice();void ensureTest(id).then(()=>paint()).catch(()=>{});
 }
 function startReview(id,qid){
  const meta=getMeta(id);if(!meta)return;
  state.skill=meta.skill;
  state.active={testId:id,skill:meta.skill,mode:'review',sectionId:'',onlyQuestionId:qid,answers:{},checked:{},played:[],pane:'passage',startedAt:Date.now(),endsAt:0};
  save();syncPractice();void ensureTest(id).then(()=>paint()).catch(()=>{});
 }
 function reviewQuestions(id,qids){
  const meta=getMeta(id);if(!meta||!Array.isArray(qids)||!qids.length)return;
  state.skill=meta.skill;
  state.active={testId:id,skill:meta.skill,mode:'practice',sectionId:'',onlyQuestionId:'',onlyQuestionIds:[...new Set(qids.map(String))],answers:{},checked:{},played:[],pane:'passage',startedAt:Date.now(),endsAt:0};
  state.lastResult=null;save();syncPractice();void ensureTest(id).then(()=>paint()).catch(()=>{});
 }
 function resume(){if(state.active){state.skill=state.active.skill;save();syncPractice();paint()}}
 function quit(){stopSpeech();clearInterval(clockHandle);clockHandle=0;state.active=null;save();const target=root();if(target)target.dataset.catalogReady='false';paint()}
 function setAnswer(qid,value){if(!state.active)return;state.active.answers[qid]=value;save()}
 function normalise(value){
  let output=String(value==null?'':value).normalize('NFKC').toLocaleLowerCase('en')
   .replace(/[’‘]/g,"'").replace(/[‐‑‒–—]/g,'-')
   .replace(/[.,!?;:"()[\]{}]/g,' ').replace(/\s+/g,' ').trim();
  const variants={colour:'color',colours:'colors',favourite:'favorite',favourites:'favorites',centre:'center',centres:'centers',organise:'organize',organised:'organized',organising:'organizing',organisation:'organization',travelling:'traveling',travelled:'traveled',cancelled:'canceled',cancelling:'canceling',grey:'gray',metre:'meter',metres:'meters',defence:'defense',programme:'program'};
  output=output.split(' ').map(word=>variants[word]||word).join(' ');
  return output;
 }
 function words(value){return String(value||'').trim().split(/\s+/).filter(Boolean)}
 function sameAnswer(question,value){
  const actual=String(value==null?'':value).trim();if(!actual)return false;
  if(question.maxWords&&words(actual).length>question.maxWords)return false;
  const accepted=[].concat(question.answer||[],question.accept||[]);
  if(question.orderSensitive&&Array.isArray(question.answer)){
   const got=actual.split(/\s*[,;|]\s*/).map(normalise);
   return got.length===question.answer.length&&got.every((item,index)=>item===normalise(question.answer[index]));
  }
  const key=normalise(actual);
  if(accepted.some(answer=>normalise(answer)===key))return true;
  const compact=key.replace(/\s+/g,'');
  return /^\d+$/.test(compact)&&accepted.some(answer=>normalise(answer).replace(/\s+/g,'')===compact);
 }
 function getQuestions(test,active){
  const sections=test.sections.filter(section=>!active.sectionId||section.id===active.sectionId);
  let list=sections.flatMap(section=>section.questions.map(question=>({section,question})));
  if(active.onlyQuestionId)list=list.filter(item=>item.question.id===active.onlyQuestionId);
  if(Array.isArray(active.onlyQuestionIds)&&active.onlyQuestionIds.length){const wanted=new Set(active.onlyQuestionIds);list=list.filter(item=>wanted.has(item.question.id))}
  return list;
 }
 function markMissed(test,q,value,correct){
  if(correct)delete state.missed[q.id];
  else state.missed[q.id]={testId:test.id,testTitle:test.title,questionId:q.id,prompt:q.prompt,answer:String(value||''),correctAnswer:q.answer,explain:q.explain,type:q.type,updated:Date.now()};
 }
 function checkOne(qid){
  const active=state.active;if(!active)return;
  ensureTest(active.testId).then(test=>{
   const q=test.sections.flatMap(section=>section.questions).find(item=>item.id===qid);if(!q)return;
   const value=active.answers[qid]||'',correct=sameAnswer(q,value);
   active.checked[qid]={correct,value:value};markMissed(test,q,value,correct);save();paint();
  });
 }
 function allCorrect(test,active){
  const entries=getQuestions(test,active);
  return entries.map(({section,question})=>({section,question,value:active.answers[question.id]||'',correct:sameAnswer(question,active.answers[question.id]||'')}));
 }
 function finish(){
  const active=state.active;if(!active)return;
  clearInterval(clockHandle);clockHandle=0;
  ensureTest(active.testId).then(test=>{
   const results=allCorrect(test,active),correct=results.filter(x=>x.correct).length,total=results.length;
   const byType={};
   for(const result of results){const key=result.question.type;byType[key]=byType[key]||{right:0,total:0};byType[key].total++;if(result.correct)byType[key].right++;markMissed(test,result.question,result.value,result.correct)}
   if(active.mode==='exam'||active.mode==='practice'||active.mode==='section-practice'){
    const record=state.attempts[test.id]||{count:0,best:null,history:[]};
    record.count++;record.best=Math.max(record.best==null?0:record.best,correct);record.last={correct,total,date:Date.now()};record.history=(record.history||[]).slice(-19);record.history.push({correct,total,date:Date.now(),mode:active.mode,byType,skill:test.skill,title:test.title,durationMs:Math.max(0,Date.now()-Number(active.startedAt||Date.now())),results:results.map(item=>({questionId:item.question.id,sectionId:item.section.id,prompt:item.question.prompt,type:item.question.type,value:item.value,correct:item.correct,answer:item.question.answer,explain:item.question.explain}))});
    state.attempts[test.id]=record;
   }
   state.lastResult={testId:test.id,skill:test.skill,correct,total,byType,results,finishedAt:Date.now(),mode:active.mode};
   state.active=null;stopSpeech();save();paint();
  }).catch(()=>statusText('Chưa nộp được bài. Hãy thử lại.'));
 }
 function approximateBand(percent){
  const rows=[[100,9],[98,8.5],[96,8],[93,7.5],[88,7],[80,6.5],[70,6],[60,5.5],[50,5],[40,4.5],[30,4]];
  return (rows.find(row=>percent>=row[0])||[0,3.5])[1];
 }
 function renderActive(target,active){
  ensureTest(active.testId).then(test=>{
   if(root()!==target||state.active!==active)return;
   const meta=getMeta(test.id)||{title:test.title,level:test.level,minutes:test.minutes,questionCount:test.sections.reduce((n,s)=>n+s.questions.length,0)};
   if(active.mode==='evidence'){target.innerHTML=renderEvidence(test,active.targetQuestionId);return}
   const items=getQuestions(test,active),sections=[...new Set(items.map(item=>item.section))];
   const answered=items.filter(item=>String(active.answers[item.question.id]||'').trim()).length;
   const total=items.length,percent=total?Math.round(answered/total*100):0;
   let html='<div class="tf-test-toolbar"><button type="button" class="tf-secondary" onclick="window.TFTestApp.quit()">← Quay lại kho bài</button><span class="tf-session-meta">'+labels[test.skill]+' · '+h(test.level)+' · '+(active.mode==='exam'?'Làm cả đề có tính giờ':'Luyện có giải thích')+'</span>'+(active.endsAt?'<span class="tf-test-clock" id="tf-test-clock" aria-live="off"></span>':'')+'</div>';
   html+='<section class="tf-session-card"><div class="tf-test-toolbar"><div><p class="tf-session-meta">'+h(meta.title)+'</p><h1>'+h(test.title)+'</h1></div><span class="tf-test-chip">'+answered+'/'+total+' câu</span></div><div class="tf-test-progress" aria-label="Tiến độ trả lời"><span style="width:'+percent+'%"></span></div>';
   html+='<p class="tf-test-stats"><span>'+h(active.mode==='exam'?'Bài thi thử':'Bài luyện')+'</span><span>'+sections.length+' phần trong lượt này</span><span>Chỉ lưu trên thiết bị này</span></p></section>';
   if(test.skill==='listening'){
    html+=renderVoiceSettings();
    for(const section of sections)html+=renderListeningSection(test,section,active);
   }else{
    for(const section of sections)html+=renderReadingSection(test,section,active);
   }
   if(active.mode==='review'){
    const current=items[0]?.question,checked=current&&active.checked[current.id];
    html+='<section class="tf-session-card"><div class="tf-test-actions">'+(checked?'<button type="button" class="tf-primary" onclick="window.TFTestApp.quit()">Trở về Cần ôn</button>':'<button type="button" class="tf-primary" onclick="window.TFTestApp.checkOne(\''+h(current?.id||'')+'\')">Kiểm tra câu này</button>')+'</div></section>';
   }else html+='<section class="tf-session-card"><div class="tf-test-toolbar"><div><strong>'+answered+'/'+total+' câu đã trả lời</strong><p>'+h(active.mode==='exam'?'Nộp bài khi bạn đã sẵn sàng. Bài thi sẽ tự nộp khi hết giờ.':'Bạn có thể chấm từng câu rồi hoàn tất lượt luyện.')+'</p></div><button type="button" class="tf-primary" onclick="window.TFTestApp.finish()">'+(active.mode==='exam'?'Nộp bài':'Hoàn tất lượt luyện')+'</button></div></section>';
   target.innerHTML=html;
   if(active.endsAt)startClock();
   updateReadingPane(active.pane||'passage');
  }).catch(error=>{
   if(root()===target)target.innerHTML='<section class="tf-session-card"><h2>Chưa mở được bài</h2><p>'+h(error.message||'Thử lại khi tệp ngoại tuyến sẵn sàng.')+'</p><button type="button" onclick="window.TFTestApp.quit()">Quay lại kho bài</button></section>';
  });
 }
 function renderListeningSection(test,section,active){
  const played=active.played?.includes(section.id),exam=active.mode==='exam';
  let audio='<section class="tf-session-card"><div class="tf-test-toolbar"><div><p class="tf-session-meta">NGHE</p><h2>'+h(section.title)+'</h2><p>'+h(section.instructions)+'</p></div><span class="tf-test-chip">'+section.questions.length+' câu</span></div><div class="tf-test-actions">';
  audio+='<button type="button" class="tf-primary" '+(exam&&played?'disabled':'')+' onclick="window.TFTestApp.playAudio(\''+h(test.id)+'\',\''+h(section.id)+'\')">'+(played&&exam?'Đã nghe phần này':'Nghe phần này')+'</button>';
  audio+='</div><p class="tf-test-stats">Giọng đọc phụ thuộc thiết bị. Trong chế độ thi, mỗi phần chỉ phát một lần.</p><p id="tf-audio-status-'+h(section.id)+'" class="tf-writing-status" role="status" aria-live="polite"></p>';
  if(section.audio.src)audio+='<audio class="tf-audio-source" id="tf-audio-'+h(section.id)+'" src="'+h(section.audio.src)+'" preload="none" '+(exam?'':'controls')+'></audio>';
  if(active.mode==='practice'||active.mode==='section-practice'){
   audio+='<details class="tf-test-advanced"><summary>Xem bản nghe khi luyện</summary>'+renderTranscript(section,[])+'</details>';
  }
  audio+='</section>';
  return audio+'<section class="tf-session-card"><h2>Câu hỏi</h2><div class="tf-test-questions">'+renderQuestions(test,section,active)+'</div></section>';
 }
 function renderTranscript(section,highlight){
  const lines=section.audio?.script||[];
  if(!lines.length)return '<p class="tf-test-empty">Tệp âm thanh đã thu sẵn không có bản chữ đi kèm.</p>';
  return '<ol class="tf-audio-transcript">'+lines.map((line,index)=>'<li class="tf-transcript-line '+(highlight.includes(index)?'is-evidence':'')+'" id="tf-line-'+h(section.id)+'-'+index+'"><span class="tf-transcript-voice">'+h(line.voice)+'</span>'+h(line.text)+'</li>').join('')+'</ol>';
 }
 function renderVoiceSettings(){
  const current=state.voice||{a:'',b:'',rate:.95};
  return '<details class="tf-session-card tf-test-advanced"><summary>Nâng cao · chọn giọng nghe</summary><p>Chọn hai giọng khác nhau nếu thiết bị có sẵn; ứng dụng ưu tiên tiếng Anh Anh hoặc Mỹ.</p><div class="tf-voice-controls">'+['a','b'].map(key=>'<label>Giọng '+(key==='a'?'A':'B')+'<select onchange="window.TFTestApp.setVoice(\''+key+'\',this.value)"><option value="">Tự chọn tiếng Anh</option>'+getVoices().map(voice=>'<option value="'+h(voice.voiceURI)+'"'+(current[key]===voice.voiceURI?' selected':'')+'>'+h(voice.name+' · '+voice.lang)+'</option>').join('')+'</select></label>').join('')+'<label>Tốc độ đọc · <span id="tf-rate-label">'+Number(current.rate||.95).toFixed(2)+'</span><input type="range" min="0.9" max="1" step="0.05" value="'+clamp(Number(current.rate)||.95,.9,1)+'" oninput="window.TFTestApp.setRate(this.value)"></label></div><div class="tf-test-actions"><button type="button" onclick="window.TFTestApp.tryVoice(\'a\')">Thử giọng A</button><button type="button" onclick="window.TFTestApp.tryVoice(\'b\')">Thử giọng B</button></div><small>Không có mạng. Giọng đọc có thể khác nhau tùy máy và trình duyệt.</small></details>';
 }
 function getVoices(){
  if(!('speechSynthesis' in window))return [];
  voices=window.speechSynthesis.getVoices()||[];
  return voices;
 }
 function renderReadingSection(test,section,active){
  const pane=active.pane||'passage';
  const passage='<article class="tf-reading-pane tf-reading-passage-wrap"><h2>'+h(section.title)+'</h2><p>'+h(section.instructions)+'</p><div class="tf-reading-passage">'+(section.passage?.paragraphs||[]).map(paragraph=>{
   const marked=Boolean(state.marks[paragraph.id]),note=state.notes[paragraph.id]||'';
   return '<section class="tf-reading-paragraph '+(marked?'is-marked':'')+'" id="tf-passage-'+h(paragraph.id)+'"><p><strong>'+h(paragraph.id.toUpperCase())+'</strong> · '+h(paragraph.text)+'</p><div class="tf-reading-tools"><button type="button" aria-pressed="'+marked+'" onclick="window.TFTestApp.toggleMark(\''+h(paragraph.id)+'\',this)">'+(marked?'Bỏ đánh dấu':'Đánh dấu đoạn')+'</button><details><summary>Ghi chú</summary><textarea aria-label="Ghi chú cho '+h(paragraph.id)+'" placeholder="Ghi ý ngắn của bạn" oninput="window.TFTestApp.saveNote(\''+h(paragraph.id)+'\',this.value)">'+h(note)+'</textarea></details></div></section>';
  }).join('')+'</div></article>';
  const questions='<section class="tf-reading-pane tf-reading-questions-wrap"><h2>Câu hỏi</h2><div class="tf-reading-questions">'+renderQuestions(test,section,active)+'</div></section>';
  return '<section class="tf-session-card"><div class="tf-reading-switch" role="tablist" aria-label="Chuyển giữa bài đọc và câu hỏi"><button type="button" role="tab" aria-selected="'+(pane==='passage')+'" onclick="window.TFTestApp.setPane(\'passage\')">Bài đọc</button><button type="button" role="tab" aria-selected="'+(pane==='questions')+'" onclick="window.TFTestApp.setPane(\'questions\')">Câu hỏi</button></div><div class="tf-reading-layout" data-pane="'+h(pane)+'">'+passage+questions+'</div></section>';
 }
 function renderQuestions(test,section,active){
  let questions=section.questions;
  if(active.onlyQuestionId)questions=questions.filter(q=>q.id===active.onlyQuestionId);
  return questions.map((q,index)=>{
   const val=active.answers[q.id]||'',result=active.checked[q.id],options=q.options||[];
   const choices=options.length?'<div class="tf-q-options">'+options.map((option,oi)=>'<label class="tf-q-option"><input type="radio" name="tfq-'+h(q.id)+'" value="'+h(option)+'" '+(val===option?'checked':'')+' onchange="window.TFTestApp.setAnswer(\''+h(q.id)+'\',this.value)"><span>'+h(option)+'</span></label>').join('')+'</div>':'<input type="text" autocomplete="off" aria-label="Câu trả lời '+h(q.id)+'" placeholder="'+(q.maxWords?'Không quá '+q.maxWords+' từ':'Viết câu trả lời ngắn')+'" value="'+h(val)+'" oninput="window.TFTestApp.setAnswer(\''+h(q.id)+'\',this.value)">';
   const checked=result?'<div class="tf-question-feedback"><strong>'+(result.correct?'Đúng':'Thử lại')+'</strong> · '+h(q.explain)+(result.correct?'':'<br>Đáp án: '+h([].concat(q.answer||[]).join(' · ')))+'<br><button type="button" class="tf-secondary" onclick="window.TFTestApp.showEvidence(\''+h(test.id)+'\',\''+h(q.id)+'\')">Xem chứng cứ</button></div>':'';
   const check=active.mode==='practice'||active.mode==='section-practice'?'<button type="button" onclick="window.TFTestApp.checkOne(\''+h(q.id)+'\')">'+(result?'Chấm lại':'Chấm câu này')+'</button>':'';
   const hint=active.mode==='practice'||active.mode==='section-practice'||active.mode==='review'?'<details><summary>Gợi ý</summary><p class="tf-question-hint">'+h(hints[q.type]||'Đọc kỹ câu hỏi rồi đối chiếu thông tin trong bài.')+'</p></details>':'';
   return '<fieldset class="tf-question '+(result?(result.correct?'is-correct':'is-wrong'):'')+'" id="tf-question-'+h(q.id)+'"><legend><span class="tf-question-number">'+h(q.id)+'</span> · '+h(formatType(q.type))+'</legend><div class="tf-question-title">'+h(q.prompt)+'</div>'+choices+(q.maxWords?'<small class="tf-test-kicker">Không quá '+q.maxWords+' từ</small>':'')+hint+'<div class="tf-test-actions">'+check+'</div>'+checked+'</fieldset>';
  }).join('');
 }
 function updateReadingPane(pane){
  const layout=root()?.querySelector('.tf-reading-layout');if(!layout)return;
  layout.dataset.pane=pane;
  root().querySelectorAll('.tf-reading-switch [role="tab"]').forEach(tab=>tab.setAttribute('aria-selected',String((pane==='passage'&&tab.textContent==='Bài đọc')||(pane==='questions'&&tab.textContent==='Câu hỏi'))));
 }
 function setPane(pane){if(!state.active)return;state.active.pane=pane;save();updateReadingPane(pane)}
 function toggleMark(id,button){
  state.marks[id]=!state.marks[id];save();const node=document.getElementById('tf-passage-'+id);
  if(node)node.classList.toggle('is-marked',state.marks[id]);
  if(button){button.setAttribute('aria-pressed',String(state.marks[id]));button.textContent=state.marks[id]?'Bỏ đánh dấu':'Đánh dấu đoạn'}
 }
 function saveNote(id,value){state.notes[id]=value;save()}
 function setVoice(which,value){state.voice[which]=value;save()}
 function setRate(value){state.voice.rate=clamp(Number(value)||.95,.9,1);save();const label=document.getElementById('tf-rate-label');if(label)label.textContent=state.voice.rate.toFixed(2)}
 function defaultVoice(language,exclude){
  const list=getVoices();return list.find(voice=>voice.voiceURI!==exclude&&voice.lang?.toLowerCase().startsWith(language.toLowerCase()))||list.find(voice=>voice.voiceURI!==exclude&&voice.lang?.toLowerCase().startsWith('en'))||list.find(voice=>voice.voiceURI!==exclude)||null;
 }
 function chosenVoice(which,lineVoice){
  const list=getVoices(),pref=state.voice?.[which],selected=list.find(voice=>voice.voiceURI===pref);
  if(selected)return selected;
  const preferred=String(lineVoice||'').toLowerCase().includes('host')||String(lineVoice||'').toLowerCase().includes('announcer')?'en-GB':'en-US';
  return defaultVoice(preferred,which==='b'?state.voice?.a:state.voice?.b);
 }
 function speak(text,voice){
  return new Promise(resolve=>{
   if(!window.SpeechSynthesisUtterance||!window.speechSynthesis){resolve(false);return}
   const item=new SpeechSynthesisUtterance(text);if(voice){item.voice=voice;item.lang=voice.lang||'en-US'}else item.lang='en-US';
   moduleSpeechActive=true;item.rate=clamp(Number(state.voice?.rate)||.95,.9,1);item.onend=()=>{moduleSpeechActive=false;resolve(true)};item.onerror=()=>{moduleSpeechActive=false;resolve(false)};
   window.speechSynthesis.speak(item);
  });
 }
 async function playAudio(testId,sectionId){
  const active=state.active;if(!active)return;
  if(active.mode==='exam'&&active.played?.includes(sectionId))return;
  const test=await ensureTest(testId),section=test.sections.find(item=>item.id===sectionId);if(!section)return;
  const audio=section.audio||{};
  const status=document.getElementById('tf-audio-status-'+sectionId);
  if(!audio.src&&(!window.speechSynthesis||!window.SpeechSynthesisUtterance)){if(status)status.textContent='Thiết bị này chưa có giọng đọc. Hãy mở bài trên trình duyệt có hỗ trợ giọng tiếng Anh.';return}
  if(active.mode==='exam'){active.played=active.played||[];active.played.push(sectionId);save();paint()}
  const srcNode=document.getElementById('tf-audio-'+sectionId);
  if(audio.src&&srcNode){
   try{srcNode.currentTime=0;currentAudio=srcNode;await srcNode.play();if(status)status.textContent='Đang phát bản ghi âm.';srcNode.onended=()=>{if(status)status.textContent='Đã phát xong.';if(currentAudio===srcNode)currentAudio=null};return}
   catch{currentAudio=null;if(active.mode==='exam'){active.played=(active.played||[]).filter(id=>id!==sectionId);save();paint()}if(status)status.textContent='Không phát được tệp âm thanh trên thiết bị này.';return}
  }
  stopSpeech();const token=++speechToken;const lines=audio.script||[];if(!lines.length){if(status)status.textContent='Bài này chưa có bản nghe.';return}
  modulePlaybackActive=true;
  if(status)status.textContent='Đang phát. Bạn có thể dừng bất cứ lúc nào.';
  for(let i=0;i<lines.length;i++){
   if(token!==speechToken){modulePlaybackActive=false;return}
   const line=lines[i],key=['host','announcer','tutor','speaker-a'].includes(String(line.voice).toLowerCase())?'a':'b';
   const ok=await speak(line.text,chosenVoice(key,line.voice));if(!ok&&token===speechToken){modulePlaybackActive=false;if(status)status.textContent='Thiết bị chưa phát được giọng đọc. Có thể thử chọn giọng khác trong Nâng cao.';return}
   if(i<lines.length-1)await new Promise(resolve=>setTimeout(resolve,Number(audio.pauses)||420));
  }
  modulePlaybackActive=false;if(token===speechToken&&status)status.textContent='Đã phát xong phần nghe.';
 }
 function stopSpeech(){speechToken++;if(moduleSpeechActive&&window.speechSynthesis)try{window.speechSynthesis.cancel()}catch{}modulePlaybackActive=false;if(currentAudio){try{currentAudio.pause()}catch{}currentAudio=null}}
 function tryVoice(which){
  const line=which==='a'?'Hello. This is voice A.':'Hello. This is voice B.';
  stopSpeech();
  void speak(line,chosenVoice(which,which==='b'?state.voice?.a:state.voice?.b));
 }
 function startClock(){
  clearInterval(clockHandle);clockHandle=0;
  if(!state.active?.endsAt)return;
  const tick=()=>{
   if(!state.active?.endsAt)return;
   const left=Math.max(0,state.active.endsAt-Date.now()),node=document.getElementById('tf-test-clock');
   if(node)node.textContent='Còn '+String(Math.floor(left/60000)).padStart(2,'0')+':'+String(Math.floor(left%60000/1000)).padStart(2,'0');
   if(left<=0){clearInterval(clockHandle);clockHandle=0;finish();return}
  };
  tick();if(state.active?.endsAt)clockHandle=setInterval(tick,1000);
 }
 function renderResults(result){
  const meta=getMeta(result.testId)||{title:result.testId,questionCount:result.total};
  const percent=result.total?Math.round(result.correct/result.total*100):0,band=approximateBand(percent);
  const wrong=result.results.filter(item=>!item.correct);
  let html='<div class="tf-test-toolbar"><button type="button" class="tf-secondary" onclick="window.TFTestApp.backToCatalog()">← Quay lại kho bài</button><span class="tf-session-meta">Kết quả · '+h(meta.title)+'</span></div>';
  html+='<section class="tf-result-card"><p class="eyebrow">KẾT QUẢ BÀI LUYỆN</p><h1>'+h(meta.title)+'</h1><div class="tf-results-summary"><div class="tf-result-stat"><strong>'+result.correct+'/'+result.total+'</strong><small>Số câu đúng</small></div><div class="tf-result-stat"><strong>'+percent+'%</strong><small>Độ chính xác</small></div><div class="tf-result-stat"><strong>'+band.toFixed(1)+'</strong><small>Band ước tính</small></div></div><p>Band chỉ là ước tính theo tỉ lệ đúng của bài ngắn này; không phải kết quả thi hay quy đổi chính thức.</p><div class="tf-test-actions"><button type="button" class="tf-primary" onclick="window.TFTestApp.start(\''+h(result.testId)+'\',\'exam\')">Làm lại cả đề</button><button type="button" onclick="window.TFTestApp.start(\''+h(result.testId)+'\',\'practice\')">Luyện lại có giải thích</button></div></section>';
  html+='<section class="tf-result-card"><h2>Kết quả theo dạng câu</h2><div class="tf-type-results">'+Object.entries(result.byType).map(([type,count])=>'<div class="tf-type-result"><span>'+h(formatType(type))+'</span><strong>'+count.right+'/'+count.total+'</strong></div>').join('')+'</div></section>';
  html+='<section class="tf-result-card"><h2>Câu cần xem lại</h2>';
  if(wrong.length)html+='<ul class="tf-test-wrong-list">'+wrong.map(item=>'<li><span><strong>'+h(item.question.id)+'</strong> · '+h(item.question.prompt)+'<br><small>'+h(item.question.explain)+'</small></span><button type="button" onclick="window.TFTestApp.showEvidence(\''+h(result.testId)+'\',\''+h(item.question.id)+'\')">Xem chứng cứ</button></li>').join('')+'</ul>';
  else html+='<p class="tf-test-empty">Bạn làm đúng tất cả câu trong lượt này.</p>';
  html+='</section>';
  const test=loaded.get(result.testId);
  html+='<section class="tf-result-card"><h2>Bài và chứng cứ</h2><p>Các đoạn liên quan đến câu hỏi được làm sáng để bạn đối chiếu.</p>';
  if(test&&typeof test.then==='function')html+='<p class="tf-test-empty">Đang nạp phần chứng cứ…</p>';
  html+='</section>';
  return html;
 }
 function resultPage(target,result){
  target.innerHTML=renderResults(result);
  const box=target.querySelectorAll('.tf-result-card')[2];
  ensureTest(result.testId).then(test=>{
   if(!box||!root()?.contains(box))return;
   box.innerHTML='<h2>Bài và chứng cứ</h2><p>Các đoạn liên quan đến câu hỏi được làm sáng để bạn đối chiếu.</p>'+renderAllEvidence(test,result.results);
  });
 }
 function renderAllEvidence(test,results){
  if(test.skill==='listening')return test.sections.map(section=>{
   const evidence=[...new Set(results.filter(item=>item.section.id===section.id).map(item=>item.question.evidence?.lineIndex).filter(Number.isInteger))];
   return '<details class="tf-test-advanced"><summary>'+h(section.title)+' · bản nghe và câu chứng cứ</summary>'+renderTranscript(section,evidence)+'</details>';
  }).join('');
  const relevant=[...new Set(results.map(item=>item.question.evidence?.paragraphId).filter(Boolean))];
  return test.sections.map(section=>'<div class="tf-reading-passage">'+(section.passage?.paragraphs||[]).map(paragraph=>'<section class="tf-reading-paragraph '+(relevant.includes(paragraph.id)?'is-evidence':'')+'"><p><strong>'+h(paragraph.id.toUpperCase())+'</strong> · '+h(paragraph.text)+'</p></section>').join('')+'</div>').join('');
 }
 function renderEvidence(test,qid){
  const result=state.lastResult,testSection=test.sections.find(section=>section.questions.some(q=>q.id===qid));
  const q=testSection?.questions.find(item=>item.id===qid),source=q?.evidence;
  let html='<div class="tf-test-toolbar"><button type="button" onclick="window.TFTestApp.backToResult()">← Quay lại kết quả</button><span class="tf-session-meta">Chứng cứ</span></div>';
  if(!q)return html+'<section class="tf-session-card"><p>Không tìm thấy câu hỏi này.</p></section>';
  html+='<section class="tf-session-card"><h1>'+h(q.id)+'</h1><p>'+h(q.prompt)+'</p><p><strong>Đáp án:</strong> '+h([].concat(q.answer||[]).join(' · '))+'</p><p>'+h(q.explain)+'</p></section>';
  if(test.skill==='listening')html+='<section class="tf-session-card"><h2>'+h(testSection.title)+'</h2>'+renderTranscript(testSection,[source?.lineIndex])+'</section>';
  else html+='<section class="tf-session-card"><h2>'+h(testSection.title)+'</h2>'+(testSection.passage?.paragraphs||[]).map(paragraph=>'<section class="tf-reading-paragraph '+(paragraph.id===source?.paragraphId?'is-evidence':'')+'"><p><strong>'+h(paragraph.id.toUpperCase())+'</strong> · '+h(paragraph.text)+'</p></section>').join('')+'</section>';
  return html;
 }
 function showEvidence(testId,qid){
  const meta=getMeta(testId);if(!meta)return;
  state.active={testId:testId,skill:meta.skill,mode:'evidence',targetQuestionId:qid,answers:{},checked:{},played:[],startedAt:Date.now(),endsAt:0};state.skill=meta.skill;save();syncPractice();
 }
 function backToResult(){state.active=null;save();paint()}
 function backToCatalog(){state.lastResult=null;state.active=null;save();const target=root();if(target){target.dataset.catalogReady='false';renderCatalog(target,skill())}}
 function renderWriting(target){
  if(window.TFWritingCoach?.render){window.TFWritingCoach.render(target);return}
  const mode=state.writingMode||'task2',task=tasks[mode]||tasks.task2;state.writingMode=mode;
  let html='<div class="tf-tests-intro"><div><p class="eyebrow">Luyện tập · Viết</p><h1>Viết riêng một lượt</h1><p>Chọn dạng bài, viết câu trả lời và bản nháp được lưu trên thiết bị này.</p></div><p class="tf-tests-notice">'+NOTICE+'</p></div>';
  html+='<section class="tf-writing-card"><div class="tf-test-actions"><button type="button" '+(mode==='task1'?'class="tf-primary"':'')+' onclick="window.TFTestApp.setWritingMode(\'task1\')">Task 1 · Mô tả số liệu</button><button type="button" '+(mode==='task2'?'class="tf-primary"':'')+' onclick="window.TFTestApp.setWritingMode(\'task2\')">Task 2 · Nêu ý kiến</button></div><p class="tf-session-meta">Khoảng '+task.minutes+' phút · nội dung TaylorFlow tự biên soạn</p><h2>'+h(task.title)+'</h2><p>'+h(task.prompt)+'</p>';
  if(mode==='task1')html+='<div class="tf-writing-data" aria-label="Số người trong khảo sát">'+task.data.map(row=>'<div class="tf-writing-bar"><span>'+h(row[0])+' · '+row[1]+'</span><i style="--bar:'+Math.round(row[1]/42*100)+'%"></i></div>').join('')+'</div>';
  html+='<label for="tf-writing-answer"><strong>Câu trả lời của bạn</strong></label><textarea id="tf-writing-answer" lang="en" placeholder="Bắt đầu viết bằng tiếng Anh…" oninput="window.TFTestApp.saveDraft(this.value)">'+h(state.drafts[mode]||'')+'</textarea><div class="tf-test-toolbar"><span><strong id="tf-writing-word-count">'+words(state.drafts[mode]).length+'</strong> từ</span><span id="tf-writing-save-status" class="tf-writing-status" role="status">Được lưu tự động trên thiết bị này.</span></div><details class="tf-test-advanced"><summary>Mẹo viết</summary><p>'+h(task.tip)+'</p><p>Chế độ Viết chỉ nhận bản viết; phần Nói vẫn nằm riêng ở nút Nói.</p></details></section>';
  target.innerHTML=html;
 }
 function setWritingMode(mode){if(!tasks[mode])return;state.writingMode=mode;save();paint()}
 let draftTimer=0;
 function saveDraft(value){
  const mode=state.writingMode||'task2';state.drafts[mode]=value;save();
  const count=document.getElementById('tf-writing-word-count');if(count)count.textContent=words(value).length;
  const label=document.getElementById('tf-writing-save-status');if(label)label.textContent='Đang lưu…';
  clearTimeout(draftTimer);draftTimer=setTimeout(()=>{const node=document.getElementById('tf-writing-save-status');if(node)node.textContent='Đã lưu trên thiết bị này.'},180);
 }
 function loadVoices(){voices=getVoices();const rootNode=root();if(rootNode?.dataset.skill==='listening'&&rootNode.querySelector('.tf-voice-controls')&&state.active){const details=rootNode.querySelector('.tf-test-advanced');if(details?.open){const scroll=window.scrollY;paint();requestAnimationFrame(()=>window.scrollTo(0,scroll))}}}
 function boot(){
  const start=()=>{if(observer)observer.disconnect();const main=document.getElementById('m');if(main){observer=new MutationObserver(()=>syncPractice());observer.observe(main,{childList:true})}syncPractice()};
  if(document.body)start();else document.addEventListener('DOMContentLoaded',start,{once:true});
  if(window.speechSynthesis){window.speechSynthesis.onvoiceschanged=loadVoices;loadVoices()}
  window.addEventListener('pageshow',syncPractice);
 }
 window.TFTestApp={
  switchSkill:switchSkill,refresh:syncPractice,paint:paint,start:start,loadSections:loadSections,resume:resume,quit:quit,setAnswer:setAnswer,checkOne:checkOne,finish:finish,setFilter:setFilter,
  playAudio:playAudio,setVoice:setVoice,setRate:setRate,tryVoice:tryVoice,setPane:setPane,toggleMark:toggleMark,saveNote:saveNote,showEvidence:showEvidence,backToResult:backToResult,backToCatalog:backToCatalog,
  setWritingMode:setWritingMode,saveDraft:saveDraft,review:startReview,reviewQuestions:reviewQuestions
 };
 boot();
})(); 
