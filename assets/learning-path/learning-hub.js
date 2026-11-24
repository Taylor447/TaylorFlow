(function (window, document) {
  'use strict';

  const KEY = 'taylorflow-learning-hub-v1';
  const TESTS_KEY = 'taylorflow-skill-tests-v1';
  const WRITING_KEY = 'taylorflow-writing-coach-v1';
  const SKILLS = [
    { id: 'speaking', label: 'Nói', icon: '◉', action: 'Trả lời thành tiếng, mỗi lần một ý.' },
    { id: 'listening', label: 'Nghe', icon: '♫', action: 'Nghe ý chính rồi kiểm tra chi tiết.' },
    { id: 'reading', label: 'Đọc', icon: '▤', action: 'Tìm bằng chứng trong đoạn văn.' },
    { id: 'writing', label: 'Viết', icon: '✎', action: 'Viết câu rõ ý rồi nối thành đoạn.' }
  ];
  const TOPICS = ['Học thử', 'Food & Drink', 'Hobbies', 'Shopping', 'Places', 'Travel'];
  const TOPIC_VI = ['Làm quen cách học', 'Ăn uống', 'Sở thích', 'Mua sắm', 'Địa điểm', 'Du lịch'];
  const esc = value => String(value == null ? '' : value).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  const safeJson = (key, fallback) => { try { return JSON.parse(localStorage.getItem(key) || 'null') || fallback; } catch { return fallback; } };
  const blank = () => ({ version: 1, skill: 'speaking', done: {}, early: {}, drafts: {}, reviewDone: {}, guidePage: null, historyFilter: 'all', historyDetail: null });
  let state = readState(), booted = false;

  function readState() {
    const old = safeJson(KEY, null);
    if (!old || old.version !== 1) return blank();
    return Object.assign(blank(), old, {
      done: old.done && typeof old.done === 'object' ? old.done : {},
      early: old.early && typeof old.early === 'object' ? old.early : {},
      drafts: old.drafts && typeof old.drafts === 'object' ? old.drafts : {},
      reviewDone: old.reviewDone && typeof old.reviewDone === 'object' ? old.reviewDone : {}
    });
  }
  function save() { try { localStorage.setItem(KEY, JSON.stringify(state)); } catch {} }
  function skillMeta(id) { return SKILLS.find(item => item.id === id) || SKILLS[0]; }
  function taskKey(skill, session, task) { return skill + ':' + session + ':' + task; }
  function sessionTitle(index) { return 'Session ' + index + ' · ' + (TOPICS[index] || 'Luyện tập'); }

  function theory(skill, index) {
    const topic = TOPIC_VI[index] || 'chủ đề quen thuộc';
    const copy = {
      speaking: index === 0 ? 'Nói một câu trả lời ngắn, thêm một lý do và một ví dụ nhỏ. Ví dụ: “I like tea because it helps me relax.”' : 'Bắt đầu bằng câu trả lời trực tiếp về ' + topic + ', giải thích một lý do rồi thêm trải nghiệm thật của bạn.',
      listening: index === 0 ? 'Nghe toàn đoạn để biết ai đang nói và họ cần gì. Ở lượt sau, chú ý tên, số và thời gian.' : 'Trước khi nghe về ' + topic + ', đọc câu hỏi để biết cần tìm loại thông tin nào; đừng cố dịch từng từ.',
      reading: index === 0 ? 'Đọc câu hỏi trước, gạch từ khóa trong đầu rồi tìm đoạn có cùng ý. Đọc cả câu để kiểm tra bằng chứng.' : 'Với bài về ' + topic + ', tìm từ đồng nghĩa và cách diễn đạt lại; đáp án phải có căn cứ trong bài.',
      writing: index === 0 ? 'Mỗi đoạn chỉ nên có một ý chính. Viết câu chủ đề, giải thích ngắn và đưa một ví dụ phù hợp.' : 'Khi viết về ' + topic + ', nêu ý chính trước, sau đó thêm lý do và ví dụ cụ thể; giữ câu ngắn, rõ nghĩa.'
    };
    return copy[skill] || copy.speaking;
  }
  function taskList(skill, session) {
    const extra = {
      speaking: { kind: 'shadow', label: 'Nói theo mẫu', detail: 'Nghe câu mẫu rồi nói lại thành tiếng; không cần gõ câu trả lời.' },
      listening: { kind: 'dictation', label: 'Nghe và chép', detail: 'Nghe câu mẫu rồi viết lại từ đã nghe; không cần ghi âm.' },
      reading: { kind: 'reading-evidence', label: 'Tìm câu làm căn cứ', detail: 'Đọc lại đoạn ngắn và chọn câu xác nhận đáp án.' },
      writing: { kind: 'writing-revise', label: 'Viết lại một câu', detail: 'Sửa câu của mình cho rõ ý hơn; không cần ghi âm.' }
    }[skill] || { kind: 'dictation', label: 'Nghe và chép', detail: 'Nghe câu mẫu rồi viết lại từ đã nghe.' };
    return [
      { kind: 'theory', label: 'Nắm ý chính', detail: theory(skill, session), minutes: 5 },
      { kind: 'practice', label: 'Thực hành ' + skillMeta(skill).label.toLocaleLowerCase('vi'), detail: 'Làm một lượt ngắn theo chủ đề ' + TOPIC_VI[session] + '.', minutes: 8 },
      { ...extra, minutes: 5 }
    ];
  }
  function isDone(key) { return Boolean(state.done[key]); }
  function isUnlocked(skill, session, task) {
    const key = taskKey(skill, session, task);
    if (state.early[key]) return true;
    if (session === 0 && task === 0) return true;
    const previous = task > 0 ? taskKey(skill, session, task - 1) : taskKey(skill, session - 1, 2);
    return Boolean(state.done[previous]);
  }
  function nextTask(skill) {
    for (let session = 0; session < TOPICS.length; session++) {
      for (let task = 0; task < 3; task++) {
        const key = taskKey(skill, session, task);
        if (!isDone(key) && isUnlocked(skill, session, task)) return { skill, session, task };
      }
    }
    return { skill, session: 0, task: 0 };
  }
  function taskTitle(skill, session, task) {
    const item = taskList(skill, session)[task];
    return sessionTitle(session) + ' · ' + item.label;
  }
  function goHub(page, data) {
    state.route = Object.assign({ page }, data || {});
    state.guidePage = null;
    save();
    if (page === 'guide') {
      const targetSkill = data?.skill || 'listening';
      window.TFTestApp?.switchSkill?.(targetSkill);
    }
    window.go?.(page === 'guide' ? 'prac' : 'les');
    if (typeof window.openView === 'function') window.openView();
    setTimeout(mountPracticeGuides, 0);
  }
  function openPath(skill) { state.skill = skill || state.skill; goHub('path', { skill: state.skill }); }
  function resumePath(skill) { const next = nextTask(skill || state.skill); goHub('lesson', next); }
  function openTask(skill, session, task, early) {
    const key = taskKey(skill, session, task);
    if (!isUnlocked(skill, session, task) && !early) return;
    if (early) { state.early[key] = true; save(); }
    goHub('lesson', { skill, session, task });
  }
  function completeTask() {
    const route = state.route;
    if (!route || route.page !== 'lesson') return;
    const key = taskKey(route.skill, route.session, route.task);
    if (taskList(route.skill, route.session)[route.task]?.kind === 'writing-revise' && !String(state.drafts[key] || '').trim()) return;
    state.done[key] = Date.now();
    save();
    const following = route.task < 2 ? { skill: route.skill, session: route.session, task: route.task + 1 } : route.session + 1 < TOPICS.length ? { skill: route.skill, session: route.session + 1, task: 0 } : null;
    if (following) goHub('lesson', following);
    else goHub('path', { skill: route.skill });
  }
  function saveTaskDraft(skill, session, task, value) {
    if (skill !== 'writing') return;
    state.drafts[taskKey(skill, session, task)] = String(value || '').slice(0, 500);
    save();
  }
  function startExisting(skill, session, task) {
    const item = taskList(skill, session)[task];
    state.skill = skill;
    state.route = { page: 'lesson', skill, session, task };
    save();
    if (item?.kind === 'shadow' || item?.kind === 'dictation') {
      if (typeof window.openEnglishStudy === 'function') { window.openEnglishStudy('videos'); return; }
    }
    if (skill === 'speaking') {
      window.go?.('prac');
      window.openView?.();
      return;
    }
    if (skill === 'listening' && item.kind === 'dictation') {
      if (typeof window.openEnglishStudy === 'function') { window.openEnglishStudy('videos'); return; }
    }
    if (skill === 'reading' || skill === 'writing' || skill === 'listening') {
      window.TFTestApp?.switchSkill?.(skill);
      window.go?.('prac');
      window.openView?.();
      setTimeout(() => {
        if (skill === 'writing' && window.TFTestApp?.setWritingMode) window.TFTestApp.setWritingMode('task2');
      }, 20);
      return;
    }
    if (typeof window.openEnglishStudy === 'function') window.openEnglishStudy('videos');
  }
  function markEarly(skill, session, task) { state.early[taskKey(skill, session, task)] = true; save(); openPath(skill); }

  function completionCount(skill, session) {
    const done = [0, 1, 2].filter(task => isDone(taskKey(skill, session, task))).length;
    return { done, total: 3 };
  }
  function pathFolder() {
    const skill = state.skill || 'speaking', next = nextTask(skill), progress = TOPICS.reduce((sum, _, index) => sum + completionCount(skill, index).done, 0);
    return `<details class="c compact-folder tf-hub-folder" open><summary><span class="compact-folder-icon" aria-hidden="true">⌁</span><span class="compact-folder-copy"><strong>Lộ trình của tôi</strong><small>${skillMeta(skill).label} · ${progress}/${TOPICS.length * 3} nhiệm vụ</small></span><span class="compact-folder-chevron" aria-hidden="true">⌄</span></summary><div class="compact-folder-body"><section class="tf-hub-compact"><p class="eyebrow">HỌC THEO TỪNG BƯỚC</p><h2>Lộ trình của tôi</h2><p>Mỗi buổi đi từ nắm ý, thực hành rồi củng cố theo đúng kỹ năng.</p><button type="button" class="tf-hub-primary" onclick="TFStudyHub.resumePath('${skill}')">Học tiếp · ${esc(taskTitle(next.skill, next.session, next.task))}</button><div class="tf-hub-skill-row" role="group" aria-label="Chọn kỹ năng">${SKILLS.map(item => `<button type="button" aria-pressed="${skill === item.id}" onclick="TFStudyHub.selectPathSkill('${item.id}')"><span aria-hidden="true">${item.icon}</span> ${item.label}</button>`).join('')}</div>${reviewChips(true)}<div class="tf-hub-tools"><button type="button" class="g" onclick="TFStudyHub.openInsights()">Bản đồ kỹ năng</button><button type="button" class="g" onclick="TFStudyHub.openInsights('insights')">Xem xu hướng</button></div><div class="tf-hub-session-list">${TOPICS.map((topic, index) => {
      if (index === 3) return `<div class="tf-hub-midpoint"><strong>Ôn tập giữa khóa</strong><span>Điểm lại ba chủ đề đã học rồi tiếp tục.</span><button type="button" class="g" onclick="TFStudyHub.openReview('grammar')">Ôn nhanh</button></div>` + sessionCard(skill, topic, index);
      return sessionCard(skill, topic, index);
    }).join('')}</div></section></div></details>`;
  }
  function sessionCard(skill, topic, index) {
    const count = completionCount(skill, index), isOpen = index === 0 || count.done > 0;
    const rows = taskList(skill, index).map((task, taskIndex) => {
      const key = taskKey(skill, index, taskIndex), done = isDone(key), unlocked = isUnlocked(skill, index, task);
      const status = done ? 'Xong' : unlocked ? 'Sẵn sàng' : 'Đang khóa';
      const action = done ? `<button type="button" class="g" onclick="TFStudyHub.openTask('${skill}',${index},${taskIndex},true)">Học lại</button>` : unlocked ? `<button type="button" class="g" onclick="TFStudyHub.openTask('${skill}',${index},${taskIndex},false)">Mở bài</button>` : `<button type="button" class="tf-hub-open-early" onclick="TFStudyHub.openTask('${skill}',${index},${taskIndex},true)">Mở sớm</button>`;
      return `<li class="${done ? 'is-done' : unlocked ? '' : 'is-locked'}"><span class="tf-hub-task-state" aria-hidden="true">${done ? '✓' : unlocked ? '○' : '·'}</span><span><strong>${task.label}</strong><small>${task.minutes} phút · ${esc(task.detail)}</small></span><span class="tf-hub-status">${status}</span>${action}</li>`;
    }).join('');
    return `<details class="tf-hub-session"${isOpen ? ' open' : ''}><summary><span><strong>${esc(sessionTitle(index))}</strong><small>${esc(topic)} · ${count.done}/${count.total} nhiệm vụ</small></span><span class="tf-hub-session-count">${count.done}/${count.total}</span></summary><ol>${rows}</ol></details>`;
  }
  function selectPathSkill(skill) { state.skill = skillMeta(skill).id; save(); openPath(state.skill); }
  function lessonPage(route) {
    const item = taskList(route.skill, route.session)[route.task];
    if (!item) return `<section class="tf-hub-page"><p>Không tìm thấy nhiệm vụ này.</p><button type="button" class="g" onclick="TFStudyHub.openPath()">Về lộ trình</button></section>`;
    const theoryMode = item.kind === 'theory';
    const draftKey = taskKey(route.skill, route.session, route.task), draft = state.drafts[draftKey] || '';
    const action = theoryMode
      ? `<button type="button" class="tf-hub-primary" onclick="TFStudyHub.completeTask()">Đã nắm ý · Tiếp tục</button>`
      : item.kind === 'writing-revise'
        ? `<div class="tf-hub-action-stack tf-hub-writing-task"><label for="tf-hub-writing-draft">Viết một câu về ${esc(TOPIC_VI[route.session])}</label><textarea id="tf-hub-writing-draft" maxlength="500" placeholder="Viết câu trả lời của bạn bằng tiếng Anh…" oninput="TFStudyHub.saveTaskDraft('${route.skill}',${route.session},${route.task},this.value);this.nextElementSibling.disabled=!this.value.trim()">${esc(draft)}</textarea><button type="button" class="tf-hub-primary" onclick="TFStudyHub.completeTask()"${draft.trim() ? '' : ' disabled'}>Đã viết · Tiếp tục</button><small>Phần này chỉ luyện viết; bài nháp lưu trên thiết bị này.</small></div>`
      : `<div class="tf-hub-action-stack"><button type="button" class="tf-hub-primary" onclick="TFStudyHub.startExisting('${route.skill}',${route.session},${route.task})">${route.skill === 'speaking' ? 'Mở luyện nói' : route.skill === 'listening' ? 'Mở bài nghe' : route.skill === 'reading' ? 'Mở bài đọc' : 'Mở bài viết'}</button><button type="button" class="g" onclick="TFStudyHub.completeTask()">Đã hoàn thành · Tiếp tục</button></div>`;
    const examples = route.skill === 'speaking' ? '<p lang="en">I enjoy cooking because it helps me relax.</p><small>Trả lời trực tiếp + lý do. Khi nói, hãy nói thành tiếng.</small>' : route.skill === 'writing' ? '<p lang="en">Cooking is a useful way to relax after class.</p><small>Viết thành câu hoàn chỉnh. Ở phần này, bạn chỉ viết.</small>' : '';
    return `<section class="tf-hub-page" aria-labelledby="tf-hub-lesson-title"><button type="button" class="g tf-hub-back" onclick="TFStudyHub.openPath('${route.skill}')">← Lộ trình của tôi</button><div class="tf-hub-lesson-top"><span class="tf-hub-skill-chip">${skillMeta(route.skill).label} · ${esc(sessionTitle(route.session))}</span><span>${route.task + 1}/3 nhiệm vụ</span></div><progress max="3" value="${route.task + 1}" aria-label="Tiến độ buổi học"></progress><p class="eyebrow">${item.minutes} PHÚT · ${route.task === 0 ? 'NẮM Ý' : route.task === 1 ? 'THỰC HÀNH' : 'LUYỆN THÊM'}</p><h1 id="tf-hub-lesson-title">${esc(item.label)}</h1><p class="tf-hub-lead">${esc(item.detail)}</p>${theoryMode ? `<article class="tf-hub-theory"><span class="tf-hub-number">01</span><div><h2>Ghi nhớ</h2><p>${esc(theory(route.skill, route.session))}</p>${examples}</div></article><article class="tf-hub-theory"><span class="tf-hub-number">02</span><div><h2>Thử áp dụng</h2><p>${route.skill === 'writing' ? 'Tự viết một câu hoàn chỉnh theo chủ đề. Không cần ghi âm.' : route.skill === 'speaking' ? 'Nói thành tiếng một câu theo chủ đề, rồi thêm một lý do.' : 'Đọc yêu cầu, thử tự trả lời trước khi mở bài luyện.'}</p></div></article>` : `<article class="tf-hub-theory"><span class="tf-hub-number">${route.task + 1}</span><div><h2>${esc(item.label)}</h2><p>${esc(item.detail)}</p><p>${route.skill === 'speaking' ? 'Lượt này chỉ luyện nói; bạn không cần gõ câu trả lời.' : route.skill === 'writing' ? 'Lượt này chỉ luyện viết; bạn không cần ghi âm.' : 'Sau khi hoàn thành hoạt động trong app, quay lại đây để cập nhật tiến độ.'}</p></div></article>`}${action}</section>`;
  }

  function readEpu() { return safeJson('epu', {}); }
  function reviewSources() {
    const epu = readEpu(), testState = safeJson(TESTS_KEY, {}), writing = safeJson(WRITING_KEY, {}), now = Date.now();
    const done = state.reviewDone || {};
    const dueWords = (Array.isArray(epu.c) ? epu.c : []).map((card, index) => ({ card, index })).filter(({ card }) => (Number.isFinite(Number(card?.due)) ? Number(card.due) : 0) <= now).sort((a, b) => (Number(a.card?.due) || 0) - (Number(b.card?.due) || 0)).slice(0, 8);
    const missed = Object.values(testState.missed || {}).filter(row => row && !done['miss:' + row.testId + ':' + row.questionId]).sort((a, b) => Number(b.updated) - Number(a.updated)).slice(0, 8);
    const placementWrong = (epu.learningProfileV2?.placement?.latest?.answerFeedback || []).map((row, index) => ({ row, index })).filter(({ row }) => row?.correct === false && (!row.skills?.length || row.skills.some(skill => /grammar|ngữ pháp/i.test(String(skill)))) && !done['placement:' + (row.itemId || index)]).slice(0, 8);
    const writingQueue = (Array.isArray(writing.queue) ? writing.queue : []).map((row, index) => ({ row, index })).filter(({ row, index }) => !done['writing:' + row?.at]).slice(0, 8);
    const grammar = [...writingQueue.map(({ row, index }) => ({ id: 'writing:' + row?.at, source: 'writing', index, title: row.label || 'Lỗi ngữ pháp', prompt: row.example || '', answer: row.suggestion || '', explain: row.explanation || '' })), ...placementWrong.map(({ row, index }) => ({ id: 'placement:' + (row.itemId || index), source: 'placement', title: row.stem || row.prompt || 'Câu ngữ pháp cần xem lại', prompt: row.selected || '', answer: row.key || '', explain: row.why || '' }))].slice(0, 8);
    const pronunciation = (Array.isArray(epu.h) ? epu.h : []).filter(row => typeof row?.p === 'number' && Number.isFinite(row.p) && row.p < 5.5 && !done['pron:' + (row.id || row.d)]).sort((a, b) => Number(b.d) - Number(a.d)).slice(0, 5).map(row => ({ id: 'pron:' + (row.id || row.d), title: row.t || 'Lượt luyện nói', value: row.p.toFixed(1), date: Number(row.d) }));
    return { dueWords, missed, grammar, pronunciation };
  }
  function reviewCounts() { const rows = reviewSources(); return { words: rows.dueWords.length, wrong: rows.missed.length, grammar: rows.grammar.length, pronunciation: rows.pronunciation.length }; }
  function reviewChips(compact) {
    const count = reviewCounts(), kinds = [
      ['words', 'Từ đến hạn', count.words], ['wrong', 'Câu làm sai', count.wrong], ['grammar', 'Ngữ pháp yếu', count.grammar], ['pronunciation', 'Phát âm cần xem', count.pronunciation]
    ];
    return `<section class="tf-hub-review-chips${compact ? ' is-compact' : ''}" aria-label="Cần ôn"><div><p class="eyebrow">CẦN ÔN</p><h2>${compact ? 'Ôn lại nhanh' : 'Cần ôn'}</h2></div><div class="tf-hub-chip-row">${kinds.map(([id, label, amount]) => `<button type="button" class="tf-hub-review-chip" onclick="TFStudyHub.openReview('${id}')"><span>${label}</span><strong>${amount}</strong></button>`).join('')}</div></section>`;
  }
  function homeSummary() {
    const dayOrder = [0, 1, 2, 3].map(offset => SKILLS[(new Date().getDate() + offset - 1) % SKILLS.length]);
    const measured = skillMetrics().filter(item => item.value != null).sort((a, b) => a.value - b.value)[0];
    const preferred = measured?.id || (state.done && Object.keys(state.done).some(key => key.startsWith(state.skill + ':')) ? state.skill : dayOrder[0].id);
    const skills = [skillMeta(preferred), ...dayOrder.filter(item => item.id !== preferred)];
    const todaySkill = skills[0], next = nextTask(todaySkill.id);
    return `<section class="tf-hub-home" aria-label="Hôm nay và cần ôn"><article class="tf-hub-today"><div><p class="eyebrow">HÔM NAY</p><h2>Mỗi ngày một bước</h2><p>${skills.map(item => `<span class="tf-hub-today-chip">${item.label} · 10 phút</span>`).join('')}</p><small>Kế hoạch luân phiên đủ bốn kỹ năng; tiến độ lưu trên thiết bị.</small></div><button type="button" class="tf-hub-primary" onclick="TFStudyHub.resumePath('${todaySkill.id}')">Bắt đầu · ${todaySkill.label}</button></article>${reviewChips(false)}</section><section class="tf-hub-home-path" aria-label="Lộ trình và tiến độ"><div><p class="eyebrow">LỘ TRÌNH CỦA TÔI</p><h2>Trình độ, tiến độ, kế hoạch</h2><p>Theo dõi lộ trình cá nhân và bản đồ kỹ năng.</p></div><div class="tf-hub-home-links"><button type="button" class="g" onclick="TFStudyHub.openPath('${todaySkill.id}')">Mở lộ trình của tôi</button><button type="button" class="g" onclick="TFStudyHub.openInsights()">Bản đồ kỹ năng</button></div></section>`;
  }
  function openReview(type) { goHub('review', { source: type }); }
  function markReviewDone(source, id, index) {
    if (source === 'writing' && Number.isInteger(index)) window.TFWritingCoach?.removeQueue?.(index);
    state.reviewDone[id] = Date.now();
    save();
    openReview(source === 'pron' ? 'pronunciation' : source === 'miss' ? 'wrong' : 'grammar');
  }
  function reviewPage(source) {
    const rows = reviewSources();
    let content = '', title = 'Cần ôn';
    if (source === 'words') {
      title = 'Từ đến hạn';
      content = `<p>${rows.dueWords.length ? `Có ${rows.dueWords.length} từ đến hạn trong lượt ngắn.` : 'Hiện chưa có từ nào đến hạn.'}</p>${rows.dueWords.map(({ card }) => `<article class="tf-hub-review-item"><strong lang="en">${esc(card.w || 'Từ đã lưu')}</strong><p>${esc(card.m || 'Nghĩa chưa thêm')}</p>${card.e ? `<small lang="en">${esc(card.e)}</small>` : ''}</article>`).join('')}${rows.dueWords.length ? '<button type="button" class="tf-hub-primary" onclick="TFStudyHub.startDueWords()">Bắt đầu ôn</button>' : ''}`;
    } else if (source === 'wrong') {
      title = 'Câu làm sai';
      if (rows.missed.length) {
        const groups = new Map();
        rows.missed.forEach(row => { const group = groups.get(row.testId) || []; group.push(row); groups.set(row.testId, group); });
        content = [...groups.entries()].map(([testId, items]) => `<section class="tf-hub-review-group"><div><strong>${items.length} câu · ${esc(items[0]?.testTitle || 'Bài luyện')}</strong><button type="button" class="tf-hub-primary" onclick="TFTestApp.reviewQuestions('${esc(testId)}',[${items.map(row => `'${esc(row.questionId)}'`).join(',')}])">Làm lại ${items.length} câu</button></div>${items.map(row => `<article class="tf-hub-review-item"><strong>${esc(row.prompt || 'Câu cần làm lại')}</strong><p>${row.correctAnswer ? 'Đáp án: ' + esc(Array.isArray(row.correctAnswer) ? row.correctAnswer.join(' / ') : row.correctAnswer) : 'Thử trả lời lại để xem giải thích.'}</p>${row.explain ? `<small>${esc(row.explain)}</small>` : ''}<button type="button" class="g" onclick="TFTestApp.review('${esc(row.testId)}','${esc(row.questionId)}')">Ôn câu này</button></article>`).join('')}</section>`).join('');
      } else content = '<p>Chưa có câu sai cần ôn.</p>';
    } else if (source === 'grammar') {
      title = 'Ngữ pháp cần xem';
      content = rows.grammar.length ? rows.grammar.map(row => `<article class="tf-hub-review-item"><strong>${esc(row.title)}</strong>${row.prompt ? `<p lang="en">${esc(row.prompt)}</p>` : ''}${row.answer ? `<p><b>Gợi ý:</b> ${esc(row.answer)}</p>` : ''}${row.explain ? `<small>${esc(row.explain)}</small>` : ''}<button type="button" class="g" onclick="TFStudyHub.markReviewDone('${row.source}','${esc(row.id)}',${row.index ?? 'null'})">Đã xem</button></article>`).join('') : '<p>Chưa có lỗi ngữ pháp lưu trong các bài gần đây.</p>';
    } else {
      source = 'pronunciation'; title = 'Phát âm cần xem';
      content = rows.pronunciation.length ? rows.pronunciation.map(row => `<article class="tf-hub-review-item"><strong>${esc(row.title)}</strong><p>Điểm phát âm ước tính ${row.value}/9 · ${new Date(row.date).toLocaleDateString('vi-VN')}</p><button type="button" class="g" onclick="TFStudyHub.practiceSkill('speaking')">Mở luyện nói</button><button type="button" class="tf-hub-open-early" onclick="TFStudyHub.markReviewDone('pron','${esc(row.id)}',null)">Đã xem</button></article>`).join('') : '<p>Chưa có lượt phát âm thấp được lưu gần đây.</p>';
    }
    return `<section class="tf-hub-page tf-hub-review-page"><button type="button" class="g tf-hub-back" onclick="TFStudyHub.openPath()">← Lộ trình của tôi</button><p class="eyebrow">ÔN NGẮN · TỐI ĐA 8 MỤC</p><h1>${title}</h1>${content}<button type="button" class="g" onclick="TFStudyHub.openPath()">Quay lại</button></section>`;
  }
  function startDueWords() {
    window.go?.('col');
    window.openView?.();
    setTimeout(() => { if (typeof window.startFlashcards === 'function') window.startFlashcards(5); }, 30);
  }
  function practiceSkill(skill) {
    if (window.TFTestApp?.switchSkill) window.TFTestApp.switchSkill(skill);
    window.go?.('prac');
    window.openView?.();
  }

  function skillMetrics() {
    const epu = readEpu(), tests = safeJson(TESTS_KEY, {}), writing = safeJson(WRITING_KEY, {});
    const speaking = (Array.isArray(epu.h) ? epu.h : []).map(row => row?.o).filter(value => typeof value === 'number' && Number.isFinite(value));
    const getTestMetric = skill => {
      const rows = Object.values(tests.attempts || {}).flatMap(record => (record.history || []).filter(item => item.skill === skill));
      const right = rows.reduce((sum, row) => sum + (Number(row.correct) || 0), 0), total = rows.reduce((sum, row) => sum + (Number(row.total) || 0), 0);
      return { value: total >= 5 ? right / total : null, count: rows.length, total, right };
    };
    const writingRows = Object.entries(writing.feedback || {}).filter(([id, feedback]) => writing.submissions?.[id] && Array.isArray(feedback?.criteria));
    const writingPassed = writingRows.reduce((sum, [, feedback]) => sum + feedback.criteria.filter(row => row.ok).length, 0), writingTotal = writingRows.reduce((sum, [, feedback]) => sum + feedback.criteria.length, 0);
    return [
      { id: 'speaking', label: 'Nói', value: speaking.length >= 3 ? Math.max(0, Math.min(1, speaking.slice(-12).reduce((a, b) => a + b, 0) / speaking.slice(-12).length / 9)) : null, count: speaking.length, next: 'Luyện một câu Part 1 thành tiếng.' },
      { id: 'listening', label: 'Nghe', ...getTestMetric('listening'), next: 'Nghe lại phần có từ khóa trong câu hỏi.' },
      { id: 'reading', label: 'Đọc', ...getTestMetric('reading'), next: 'Chỉ chọn đáp án khi tìm thấy bằng chứng.' },
      { id: 'writing', label: 'Viết', value: writingTotal >= 5 ? writingPassed / writingTotal : null, count: writingRows.length, total: writingTotal, next: 'Viết một đoạn có câu chủ đề và ví dụ.' }
    ];
  }
  function skillMapMarkup() {
    const rows = skillMetrics(), left = 110, width = 180, top = 24, step = 42;
    const bars = rows.map((row, index) => {
      const y = top + index * step, value = row.value;
      return `<g class="tf-hub-svg-row"><text x="8" y="${y + 5}">${esc(row.label)}</text><line x1="${left}" y1="${y}" x2="${left + width}" y2="${y}" stroke="currentColor" stroke-opacity=".2" stroke-width="14" stroke-linecap="round"/>${value == null ? `<line x1="${left}" y1="${y}" x2="${left + 10}" y2="${y}" stroke="currentColor" stroke-opacity=".45" stroke-width="14" stroke-linecap="round" stroke-dasharray="2 4"/><text x="${left + 14}" y="${y + 5}" class="tf-hub-svg-note">Chưa đủ dữ liệu</text>` : `<line x1="${left}" y1="${y}" x2="${left + Math.max(4, width * value)}" y2="${y}" stroke="currentColor" stroke-width="14" stroke-linecap="round"/><text x="${left + width + 15}" y="${y + 5}">${Math.round(value * 100)}%</text>`}</g>`;
    }).join('');
    return `<svg class="tf-hub-skill-map" viewBox="0 0 350 190" role="img" aria-labelledby="tf-map-title tf-map-desc"><title id="tf-map-title">Bản đồ kỹ năng</title><desc id="tf-map-desc">Mức hoàn thành theo bốn kỹ năng; phần chưa đủ dữ liệu được ghi rõ.</desc>${bars}</svg>`;
  }
  function insightsData() {
    const epu = readEpu(), tests = safeJson(TESTS_KEY, {});
    const entries = Object.values(tests.attempts || {}).flatMap(record => record.history || []);
    const rows = entries.slice().sort((a, b) => Number(a.date) - Number(b.date));
    const total = rows.reduce((sum, row) => sum + (Number(row.total) || 0), 0), right = rows.reduce((sum, row) => sum + (Number(row.correct) || 0), 0);
    const byType = {};
    rows.forEach(row => Object.entries(row.byType || {}).forEach(([type, score]) => { byType[type] ||= { right: 0, total: 0 }; byType[type].right += Number(score.right) || 0; byType[type].total += Number(score.total) || 0; }));
    const averageTime = rows.filter(row => Number(row.durationMs) > 0 && Number(row.total) > 0).map(row => row.durationMs / 60000 / row.total);
    const speakingRecent = (Array.isArray(epu.h) ? epu.h : []).filter(row => Number(row.d) >= Date.now() - 28 * 86400000).length;
    return { entries: rows, total, right, byType, averageTime, speakingRecent };
  }
  function insightsPage() {
    const data = insightsData(), enough = data.entries.length >= 3 && data.total >= 10, typeRows = Object.entries(data.byType).sort((a, b) => (a[1].right / Math.max(a[1].total, 1)) - (b[1].right / Math.max(b[1].total, 1)));
    const weakest = typeRows[0], now = Date.now(), weeks = Array.from({ length: 4 }, (_, index) => {
      const start = now - (3 - index + 1) * 7 * 86400000, end = start + 7 * 86400000;
      const entries = data.entries.filter(row => Number(row.date) >= start && Number(row.date) < end);
      const total = entries.reduce((sum, row) => sum + (Number(row.total) || 0), 0), right = entries.reduce((sum, row) => sum + (Number(row.correct) || 0), 0);
      return { attempts: entries.length, total, accuracy: total ? right / total : null };
    });
    return `<section class="tf-hub-page"><button type="button" class="g tf-hub-back" onclick="TFStudyHub.openPath()">← Lộ trình của tôi</button><p class="eyebrow">TIẾN ĐỘ CỦA BẠN</p><h1>Bản đồ kỹ năng</h1><div class="tf-hub-map-card">${skillMapMarkup()}<div class="tf-hub-map-notes">${skillMetrics().map(row => `<article><strong>${esc(row.label)} · ${row.value == null ? 'Chưa đủ dữ liệu' : Math.round(row.value * 100) + '%'}</strong><small>${esc(row.next)}</small></article>`).join('')}</div></div><section class="tf-hub-insights"><h2>Nhìn lại 4 tuần</h2>${enough ? `<p>Độ chính xác hiện tại: ${Math.round(data.right / data.total * 100)}% trên ${data.total} câu.</p><p>Thời gian trung bình: ${data.averageTime.length ? (data.averageTime.reduce((a, b) => a + b, 0) / data.averageTime.length).toFixed(1) + ' phút/câu' : 'chưa đủ dữ liệu'}.</p><h3>Độ chính xác theo dạng</h3><div class="tf-hub-type-list">${typeRows.map(([type, score]) => `<article><strong>${esc(type.replace(/-/g, ' '))}</strong><span>${Math.round(score.right / Math.max(score.total, 1) * 100)}% · ${score.right}/${score.total}</span></article>`).join('')}</div><h3>Xu hướng theo tuần</h3><div class="tf-hub-week-bars" aria-label="Độ chính xác từng tuần">${weeks.map((week, index) => `<div><span style="height:${week.accuracy == null ? 5 : Math.max(5, Math.round(week.accuracy * 64))}px"></span><small>Tuần ${index + 1}</small><b>${week.accuracy == null ? '—' : Math.round(week.accuracy * 100) + '%'}</b></div>`).join('')}</div><p>${weakest ? `Gợi ý: dành một lượt ngắn cho dạng ${esc(weakest[0].replace(/-/g, ' '))}.` : 'Tiếp tục luyện để có gợi ý theo dạng câu.'}</p>` : `<p>Hoàn thành thêm vài bài để TaylorFlow nhận ra xu hướng. Hiện có ${data.entries.length} bài và ${data.total} câu đã lưu.</p>`}<p class="tf-hub-muted">Chỉ kết luận khi có đủ dữ liệu; kết quả được tính trên thiết bị này.</p></section><button type="button" class="g" onclick="TFStudyHub.openHistory()">Xem bài đã làm</button></section>`;
  }

  function historyRows() {
    const tests = safeJson(TESTS_KEY, {}), writing = safeJson(WRITING_KEY, {}), epu = readEpu(), rows = [];
    Object.entries(tests.attempts || {}).forEach(([testId, record]) => (record.history || []).forEach((item, index) => rows.push({ type: item.skill || 'reading', title: item.title || record.title || testId, date: Number(item.date) || 0, correct: item.correct, total: item.total, results: item.results || [], testId, index, mode: item.mode || '' })));
    Object.entries(writing.submissions || {}).forEach(([id, row]) => {
      const feedback = writing.feedback?.[id];
      if (row?.at) rows.push({ type: 'writing', title: id === 'task1Chart' ? 'Viết Task 1' : id === 'task2Opinion' ? 'Viết Task 2' : 'Bài viết', date: Number(row.at), criteria: feedback?.criteria || [], text: row.text || feedback?.text || '', id });
    });
    (Array.isArray(epu.h) ? epu.h : []).forEach((row, index) => rows.push({ type: 'speaking', title: row.t || 'Luyện nói', date: Number(row.d) || 0, band: row.o, row, id: row.id || String(index) }));
    return rows.sort((a, b) => b.date - a.date);
  }
  function openHistory() { state.route = { page: 'history' }; state.historyDetail = null; state.historyFilter = state.historyFilter || 'all'; save(); window.go?.('pro'); window.openView?.(); }
  function setHistoryFilter(value) { state.historyFilter = value; save(); const target = document.getElementById('tf-hub-history'); if (target) { const template = document.createElement('template'); template.innerHTML = historyMarkup(); const replacement = template.content.firstElementChild; if (replacement) target.replaceWith(replacement); } }
  function historyMarkup() {
    if (state.historyDetail) return `<button type="button" class="g" onclick="TFStudyHub.clearHistoryDetail()">← Danh sách bài đã làm</button>${historyDetailMarkup(state.historyDetail)}`;
    const rows = historyRows().filter(row => state.historyFilter === 'all' || row.type === state.historyFilter).slice(0, 40);
    return `<section class="tf-hub-history" id="tf-hub-history"><div class="tf-hub-history-head"><div><p class="eyebrow">HỒ SƠ</p><h2>Bài đã làm</h2></div><label>Lọc theo kỹ năng<select aria-label="Lọc bài đã làm" onchange="TFStudyHub.setHistoryFilter(this.value)">${[['all','Tất cả'],...SKILLS.map(item=>[item.id,item.label])].map(([id,label])=>`<option value="${id}"${state.historyFilter===id?' selected':''}>${label}</option>`).join('')}</select></label></div>${rows.length ? `<div class="tf-hub-history-list">${rows.map((row,index) => `<button type="button" class="tf-hub-history-row" onclick="TFStudyHub.showHistoryDetail(${index})"><span class="tf-hub-skill-chip">${skillMeta(row.type).label}</span><strong>${esc(row.title)}</strong><small>${row.date ? new Date(row.date).toLocaleString('vi-VN') : 'Ngày chưa lưu'} · ${row.total != null ? `${row.correct}/${row.total} câu` : row.band != null ? 'Band nói ước tính ' + esc(row.band) : `${row.criteria.filter(item=>item.ok).length}/${row.criteria.length} mục đạt`}</small><span aria-hidden="true">→</span></button>`).join('')}</div>` : '<p class="tf-hub-muted">Chưa có bài đã làm trong kỹ năng này.</p>'}</section>`;
  }
  function showHistoryDetail(index) {
    const rows = historyRows().filter(row => state.historyFilter === 'all' || row.type === state.historyFilter).slice(0, 40);
    state.historyDetail = rows[index] || null; state.route = { page: 'history-detail' }; save();
    if (document.getElementById('m')?.dataset.route !== 'pro') window.go?.('pro');
    window.openView?.();
  }
  function clearHistoryDetail() { state.historyDetail = null; state.route = { page: 'history' }; save(); window.openView?.(); }
  function historyDetailMarkup(row) {
    if (!row) return '<section class="tf-hub-history-detail"><p>Không tìm thấy bài đã làm.</p></section>';
    const details = row.results?.length ? `<div class="tf-hub-answer-review">${row.results.map((item, index) => `<article class="${item.correct ? 'is-correct' : 'is-wrong'}"><strong>${index + 1}. ${esc(item.prompt || item.questionId)}</strong><p>Bạn trả lời: ${esc(item.value || 'Chưa trả lời')}</p><p>Đáp án: ${esc(Array.isArray(item.answer) ? item.answer.join(' / ') : item.answer || '—')}</p><small>${esc(item.explain || '')}</small></article>`).join('')}</div>` : row.criteria?.length ? `<ul>${row.criteria.map(item => `<li>${item.ok ? '✓' : '✗'} ${esc(item.label)} · ${esc(item.detail)}</li>`).join('')}</ul><details><summary>Bài viết</summary><pre>${esc(row.text || '')}</pre></details>` : row.row ? `<p>Fluency ${esc(row.row.f ?? '—')} · Vocabulary ${esc(row.row.l ?? '—')} · Grammar ${esc(row.row.g ?? '—')}</p><p>Bản ghi chi tiết được lưu trong lịch sử luyện nói.</p>` : '<p>Bài cũ chưa lưu giải thích từng câu.</p>';
    const wrongIds = (row.results || []).filter(item => item.correct === false).map(item => item.questionId).filter(Boolean);
    return `<section class="tf-hub-page tf-hub-history-detail" id="tf-hub-history-detail"><button type="button" class="g" onclick="TFStudyHub.openHistory()">← Bài đã làm</button><p class="eyebrow">${skillMeta(row.type).label} · ${row.date ? new Date(row.date).toLocaleString('vi-VN') : ''}</p><h2>${esc(row.title)}</h2>${row.correct != null ? `<p>${row.correct}/${row.total} câu đúng</p>` : ''}${details}${wrongIds.length && row.testId ? `<button type="button" class="tf-hub-primary" onclick="TFTestApp.reviewQuestions('${esc(row.testId)}',${JSON.stringify(wrongIds).replace(/"/g, "'")})">Làm lại ${wrongIds.length} câu sai</button>` : ''}</section>`;
  }
  function profileHistoryMarkup() { return `<section class="c tf-hub-profile-history">${historyMarkup()}</section>`; }

  const GUIDES = {
    'form-completion': { skill: 'listening', title: 'Điền thông tin', when: 'Gặp khi đề có phiếu, bảng hoặc ghi chú còn chỗ trống.', steps: ['Đọc nhãn để đoán loại từ cần nghe.', 'Nghe từ khóa quanh chỗ trống.', 'Kiểm tra chính tả và số từ.'], trap: 'Đừng điền quá số từ cho phép hoặc chép nhầm phần đánh vần.', quiz: [{ q: 'Cần điền tên người. Bạn chú ý điều gì?', options: ['Tên được đánh vần', 'Mọi từ trong câu'], answer: 0 }, { q: 'Đề giới hạn “ONE WORD”. Bạn điền mấy từ?', options: ['Một từ', 'Hai từ'], answer: 0 }], type: 'form-completion' },
    'multiple-choice-listening': { skill: 'listening', title: 'Chọn đáp án khi nghe', when: 'Gặp khi cần chọn một hoặc nhiều ý đúng theo đoạn nghe.', steps: ['Đọc câu hỏi và dự đoán ý cần nghe.', 'Nghe hết lựa chọn, để ý người nói đổi ý.', 'Chọn ý được xác nhận rõ ràng.'], trap: 'Một từ giống đáp án chưa đủ; người nói có thể phủ định hoặc sửa lại.', quiz: [{ q: 'Người nói bảo định đi xe buýt nhưng cuối cùng gọi taxi. Họ đi bằng gì?', options: ['Xe buýt', 'Taxi'], answer: 1 }, { q: 'Có thể dừng nghe sau khi nghe từ khóa đầu tiên không?', options: ['Có', 'Không'], answer: 1 }], type: 'multiple-choice' },
    'matching-listening': { skill: 'listening', title: 'Nối thông tin khi nghe', when: 'Gặp khi ghép người, địa điểm hoặc lựa chọn với mô tả.', steps: ['Đọc nhanh danh sách hai cột.', 'Ghi nhận từ đồng nghĩa khi nghe.', 'Rà lại lựa chọn chưa dùng.'], trap: 'Đừng ghép chỉ theo thứ tự xuất hiện; thông tin có thể đổi thứ tự.', quiz: [{ q: 'Người nói dùng “near the station” để diễn đạt “close to the station”. Hai ý này?', options: ['Có thể tương đương', 'Chắc chắn trái nghĩa'], answer: 0 }, { q: 'Các câu trả lời luôn xuất hiện đúng thứ tự danh sách?', options: ['Có', 'Không'], answer: 1 }], type: 'matching' },
    'short-answer-listening': { skill: 'listening', title: 'Trả lời ngắn khi nghe', when: 'Gặp khi đề hỏi một chi tiết như ngày, tên hoặc lý do.', steps: ['Xác định dạng câu trả lời.', 'Nghe chính xác thông tin được hỏi.', 'Viết gọn và kiểm tra số từ.'], trap: 'Câu trả lời dài dễ sai giới hạn và thêm chi tiết không cần thiết.', quiz: [{ q: 'Câu hỏi “When?” cần loại thông tin nào?', options: ['Thời gian', 'Địa điểm'], answer: 0 }, { q: 'Đề giới hạn hai từ. Câu trả lời bốn từ?', options: ['Đạt', 'Vượt giới hạn'], answer: 1 }], type: 'short-answer' },
    tfng: { skill: 'reading', title: 'Đúng / Sai / Không có thông tin', when: 'Gặp khi so sánh một phát biểu với dữ kiện trong bài đọc.', steps: ['Tìm đúng đoạn chứa ý.', 'So sánh ý nghĩa, không chỉ từ giống nhau.', 'Chọn “Không có thông tin” nếu bài không xác nhận cũng không phủ định.'], trap: 'Thông tin có vẻ hợp lý ngoài đời không thay thế bằng chứng trong bài.', quiz: [{ q: 'Bài nói cửa mở lúc 8 giờ. Phát biểu nói mở lúc 9 giờ.', options: ['Sai', 'Không có thông tin'], answer: 0 }, { q: 'Bài không nhắc giá vé. Phát biểu nói vé rẻ.', options: ['Đúng', 'Không có thông tin'], answer: 1 }], type: 'tfng' },
    'heading-matching': { skill: 'reading', title: 'Nối tiêu đề với đoạn', when: 'Gặp khi chọn tiêu đề tóm tắt ý chính của từng đoạn.', steps: ['Đọc câu mở và kết đoạn.', 'Tóm tắt đoạn bằng vài từ của mình.', 'So sánh với tiêu đề, bỏ lựa chọn quá hẹp.'], trap: 'Một chi tiết nổi bật không nhất thiết là ý chính của cả đoạn.', quiz: [{ q: 'Đoạn nói nhiều cách tiết kiệm nước. Tiêu đề phù hợp nhất?', options: ['Các cách dùng ít nước hơn', 'Một chiếc vòi bị hỏng'], answer: 0 }, { q: 'Nên chọn tiêu đề chỉ lặp lại một ví dụ nhỏ?', options: ['Nên', 'Không nên'], answer: 1 }], type: 'heading-matching' },
    'multiple-choice-reading': { skill: 'reading', title: 'Chọn đáp án khi đọc', when: 'Gặp khi câu hỏi yêu cầu chọn thông tin đúng theo bài.', steps: ['Đọc câu hỏi trước.', 'Tìm đoạn liên quan và đọc câu đầy đủ.', 'Loại đáp án sai chi tiết hoặc quá rộng.'], trap: 'Đáp án có từ giống bài nhưng đổi quan hệ nguyên nhân có thể sai.', quiz: [{ q: 'Bài nói mưa làm chuyến đi chậm. Đáp án nói điều gì?', options: ['Chuyến đi chậm vì mưa', 'Mưa làm chuyến đi nhanh hơn'], answer: 0 }, { q: 'Chọn đáp án chỉ vì thấy một từ giống hệt?', options: ['Có', 'Không'], answer: 1 }], type: 'multiple-choice' },
    'ynng': { skill: 'reading', title: 'Có / Không / Không có thông tin', when: 'Gặp khi phát biểu hỏi về quan điểm hoặc nhận định của tác giả.', steps: ['Tìm câu thể hiện ý của tác giả.', 'So sánh lập trường và mức độ chắc chắn.', 'Chọn “Không có thông tin” nếu tác giả chưa nêu ý đó.'], trap: 'Đừng nhầm sự thật được kể trong bài với quan điểm của tác giả.', quiz: [{ q: 'Tác giả ủng hộ xe đạp; phát biểu nói tác giả phản đối.', options: ['Không', 'Không có thông tin'], answer: 0 }, { q: 'Bài chỉ nêu giờ mở cửa, không nêu ý kiến về giá.', options: ['Có', 'Không có thông tin'], answer: 1 }], type: 'ynng' },
    'sentence-completion': { skill: 'reading', title: 'Điền từ còn thiếu', when: 'Gặp khi hoàn thành câu hoặc tóm tắt bằng từ trong bài.', steps: ['Đọc phần trước và sau chỗ trống.', 'Đoán loại từ và số từ cần điền.', 'Tìm đúng từ trong bài rồi kiểm tra ngữ pháp.'], trap: 'Câu trả lời có nghĩa gần đúng nhưng vượt giới hạn số từ vẫn không đạt.', quiz: [{ q: 'Chỗ trống cần một danh từ chỉ nơi chốn. Nên tìm gì?', options: ['Tên địa điểm', 'Một tính từ bất kỳ'], answer: 0 }, { q: 'Đề ghi “NO MORE THAN TWO WORDS”. Ba từ có hợp lệ?', options: ['Có', 'Không'], answer: 1 }], type: 'sentence-completion' },
    'matching-headings': { skill: 'reading', title: 'Nối thông tin với đoạn', when: 'Gặp khi tìm đoạn có một chi tiết cụ thể.', steps: ['Khoanh từ khóa trong yêu cầu.', 'Tìm cách diễn đạt cùng ý trong bài.', 'Đọc trọn câu để xác nhận.'], trap: 'Tên gọi có thể được thay bằng đại từ hoặc cách nói khác.', quiz: [{ q: '“cost” có thể được diễn đạt lại là gì?', options: ['price', 'colour'], answer: 0 }, { q: 'Chỉ cần thấy cùng một danh từ là đủ?', options: ['Đủ', 'Chưa đủ'], answer: 1 }], type: 'information-matching' },
    'task1': { skill: 'writing', title: 'Mô tả số liệu', when: 'Gặp khi đề yêu cầu tóm tắt biểu đồ, bảng hoặc quy trình.', steps: ['Viết câu tổng quan về điểm nổi bật.', 'Chọn số liệu chính và so sánh.', 'Rà lại đơn vị và mốc thời gian.'], trap: 'Đừng liệt kê mọi con số mà thiếu xu hướng chung.', quiz: [{ q: 'Đoạn mở nên có gì?', options: ['Xu hướng nổi bật', 'Mọi số liệu nhỏ'], answer: 0 }, { q: 'So sánh hai nhóm cần ít nhất gì?', options: ['Hai dữ kiện liên quan', 'Một con số không nhãn'], answer: 0 }], type: 'task1' },
    'task2': { skill: 'writing', title: 'Viết bài nêu ý kiến', when: 'Gặp khi đề hỏi đồng ý, thảo luận hoặc nêu nguyên nhân và giải pháp.', steps: ['Trả lời trực tiếp câu hỏi.', 'Mỗi đoạn phát triển một lý do kèm ví dụ.', 'Kết luận nhắc lại quan điểm.'], trap: 'Đừng đưa nhiều ý rời rạc mà chưa giải thích.', quiz: [{ q: 'Bài hỏi mức độ đồng ý. Bạn cần làm rõ điều gì?', options: ['Quan điểm của mình', 'Chỉ kể lại đề'], answer: 0 }, { q: 'Một lý do tốt thường đi cùng gì?', options: ['Giải thích hoặc ví dụ', 'Một danh sách từ nối'], answer: 0 }], type: 'task2' }
  };
  function guideList(skill) { return Object.values(GUIDES).filter(item => item.skill === skill); }
  function guideEntry(skill) {
    const guides = guideList(skill);
    if (!guides.length) return '';
    return `<section class="tf-hub-guide-entry"><div><p class="eyebrow">HỌC THEO CÁCH DỄ NHỚ</p><h2>Cách làm từng dạng</h2><p>Xem 3 bước, lưu ý thường gặp rồi thử nhanh.</p></div><div class="tf-hub-guide-links">${guides.map(guide => `<button type="button" class="g" onclick="TFStudyHub.openGuide('${guide.type}','${guide.skill}')">${esc(guide.title)} →</button>`).join('')}</div></section>`;
  }
  function guidePage(route) {
    const guide = Object.values(GUIDES).find(item => item.skill === route.skill && item.type === route.type) || GUIDES.task2;
    return `<section class="tf-hub-page tf-hub-guide-page"><button type="button" class="g tf-hub-back" onclick="TFStudyHub.closeGuide()">← Luyện tập</button><p class="eyebrow">${skillMeta(guide.skill).label.toLocaleUpperCase('vi')} · CÁCH LÀM</p><h1>${esc(guide.title)}</h1><p>${esc(guide.when)}</p><article class="tf-hub-theory"><div><h2>Ba bước dễ nhớ</h2><ol>${guide.steps.map(step => `<li>${esc(step)}</li>`).join('')}</ol><p class="tf-hub-trap"><strong>Hay nhầm:</strong> ${esc(guide.trap)}</p></div></article><section class="tf-hub-quick-check"><h2>Thử nhanh</h2>${guide.quiz.map((item, index) => `<fieldset data-guide-question="${index}"><legend>${esc(item.q)}</legend>${item.options.map((option, opt) => `<label><input type="radio" name="tf-guide-${index}" value="${opt}"> ${esc(option)}</label>`).join('')}<button type="button" class="g" onclick="TFStudyHub.checkGuide('${guide.skill}','${guide.type}',${index})">Kiểm tra</button><small class="tf-guide-answer" role="status"></small></fieldset>`).join('')}</section><button type="button" class="tf-hub-primary" onclick="TFStudyHub.practiceGuide('${guide.skill}','${guide.type}')">Luyện dạng này</button></section>`;
  }
  function openGuide(type, skill) { goHub('guide', { type, skill }); }
  function closeGuide() { state.route = null; state.guidePage = null; save(); const page = document.querySelector('.tf-hub-practice-page'); if (page) page.remove(); const root = document.getElementById('tf-tests-main'); if (root) root.hidden = false; window.TFTestApp?.paint?.(); setTimeout(mountPracticeGuides, 0); }
  function checkGuide(skill, type, index) {
    const guide = Object.values(GUIDES).find(item => item.skill === skill && item.type === type); if (!guide) return;
    const field = document.querySelector(`[data-guide-question="${index}"]`), selected = Number(field?.querySelector('input:checked')?.value), correct = selected === guide.quiz[index]?.answer, status = field?.querySelector('.tf-guide-answer');
    if (status) status.textContent = Number.isFinite(selected) ? (correct ? '✓ Đúng rồi.' : 'Chưa đúng, thử đọc lại ba bước.') : 'Chọn một đáp án trước nhé.';
  }
  function practiceGuide(skill, type) {
    state.route = null; state.skill = skill; save();
    if (skill === 'writing') {
      window.TFTestApp?.switchSkill?.('writing'); window.go?.('prac'); window.openView?.();
      setTimeout(() => window.TFTestApp?.setWritingMode?.(type === 'task1' ? 'task1' : 'task2'), 20);
    } else {
      window.TFTestApp?.switchSkill?.(skill); window.go?.('prac'); window.openView?.();
      setTimeout(() => window.TFTestApp?.setFilter?.('type', type), 30);
    }
  }
  function mountPracticeGuides() {
    const main = document.getElementById('m'); if (!main || main.dataset.route !== 'prac') return;
    const root = main.querySelector('#tf-tests-main');
    if (state.route?.page === 'guide') {
      if (!root) return;
      root.hidden = true;
      if (main.querySelector('.tf-hub-practice-page')) return;
      const page = document.createElement('div'); page.className = 'tf-hub-practice-page'; page.innerHTML = guidePage(state.route);
      root.insertAdjacentElement('beforebegin', page); return;
    }
    const oldPage = main.querySelector('.tf-hub-practice-page'); if (oldPage) oldPage.remove();
    if (root) root.hidden = false;
    if (!root || root.querySelector('.tf-hub-guide-entry')) return;
    const skill = root.dataset.skill || (root.querySelector('[data-skill]')?.dataset.skill) || 'listening';
    if (skill === 'speaking') return;
    const section = document.createElement('div'); section.innerHTML = guideEntry(skill);
    const entry = section.firstElementChild; if (!entry) return;
    const intro = root.querySelector('.tf-tests-intro');
    if (intro) intro.insertAdjacentElement('afterend', entry); else root.prepend(entry);
  }

  function routeMarkup() {
    const route = state.route;
    if (!route) return '';
    if (route.page === 'path') return pathPage(route.skill || state.skill);
    if (route.page === 'lesson') return lessonPage(route);
    if (route.page === 'review') return reviewPage(route.source);
    if (route.page === 'insights') return insightsPage();
    if (route.page === 'guide') return '';
    return '';
  }
  function pathPage(skill) {
    state.skill = skillMeta(skill).id;
    const next = nextTask(state.skill), count = TOPICS.reduce((sum, _, index) => sum + completionCount(state.skill, index).done, 0);
    return `<section class="tf-hub-page tf-hub-path-page"><button type="button" class="g tf-hub-back" onclick="TFStudyHub.backToLessons()">← Bài học</button><p class="eyebrow">LỘ TRÌNH CỦA TÔI · ${skillMeta(skill).label.toLocaleUpperCase('vi')}</p><h1>Học từng bước, theo chủ đề</h1><p class="tf-hub-muted">${count}/${TOPICS.length * 3} nhiệm vụ hoàn thành · tiến độ được lưu trên thiết bị.</p><div class="tf-hub-skill-row" role="group" aria-label="Chọn kỹ năng">${SKILLS.map(item => `<button type="button" aria-pressed="${skill === item.id}" onclick="TFStudyHub.selectPathSkill('${item.id}')"><span aria-hidden="true">${item.icon}</span> ${item.label}</button>`).join('')}</div><article class="tf-hub-next"><div><p class="eyebrow">HỌC TIẾP</p><h2>${esc(taskTitle(next.skill, next.session, next.task))}</h2><small>${next.session ? TOPIC_VI[next.session] : 'Bắt đầu với buổi học thử'}</small></div><button type="button" class="tf-hub-primary" onclick="TFStudyHub.resumePath('${skill}')">Học tiếp</button></article>${reviewChips(false)}<section class="tf-hub-session-list">${TOPICS.map((topic, index) => (index === 3 ? `<div class="tf-hub-midpoint"><strong>Ôn tập giữa khóa</strong><span>Ôn các chủ đề đã học trước khi tiếp tục.</span><button type="button" class="g" onclick="TFStudyHub.openReview('wrong')">Xem câu sai</button></div>` : '') + sessionCard(skill, topic, index)).join('')}</section><div class="tf-hub-tools"><button type="button" class="g" onclick="TFStudyHub.openInsights()">Bản đồ kỹ năng</button><button type="button" class="g" onclick="TFStudyHub.openInsights('insights')">Nhìn lại 4 tuần</button><button type="button" class="g" onclick="TFStudyHub.openHistory()">Bài đã làm</button></div></section>`;
  }
  function backToLessons() { state.route = null; save(); window.go?.('les'); window.openView?.(); }
  function openInsights(page) { goHub(page === 'insights' ? 'insights' : 'insights', {}); }

  function injectHome() {
    const main = document.getElementById('m'); if (!main || main.dataset.route !== 'home') return;
    const videoHero = main.querySelector('.home-interface-one .home-video-hero');
    if (videoHero) {
      let homeSummaryNode = main.querySelector('.tf-hub-home');
      let pathSummaryNode = main.querySelector('.tf-hub-home-path');
      if (!homeSummaryNode || !pathSummaryNode) {
        const template = document.createElement('template'); template.innerHTML = homeSummary().trim();
        homeSummaryNode ||= template.content.querySelector('.tf-hub-home');
        pathSummaryNode ||= template.content.querySelector('.tf-hub-home-path');
      }
      let videoCard = videoHero.querySelector(':scope > .tf-hub-video-card');
      if (!videoCard) {
        videoCard = document.createElement('article'); videoCard.className = 'tf-hub-video-card';
        const copy = videoHero.querySelector('.hero-copy'), score = videoHero.querySelector('.hero-score');
        if (copy) videoCard.append(copy);
        if (score) videoCard.append(score);
        videoHero.insertBefore(videoCard, videoHero.querySelector('.home-video-orbit'));
      }
      if (homeSummaryNode && !videoHero.contains(homeSummaryNode)) videoHero.append(homeSummaryNode);
      if (pathSummaryNode && !videoHero.contains(pathSummaryNode)) videoHero.append(pathSummaryNode);
      return;
    }
    if (main.querySelector('.tf-hub-home')) return;
    const markup = homeSummary(); const template = document.createElement('template'); template.innerHTML = markup.trim();
    const home = main.querySelector('.home-interface-one, .home-interface-two');
    const anchor = main.querySelector('.pwa-install-box, .bubble-home-results');
    const homeSummaryNode = template.content.querySelector('.tf-hub-home');
    const pathSummaryNode = template.content.querySelector('.tf-hub-home-path');
    if (anchor) { anchor.insertAdjacentElement('afterend', homeSummaryNode); homeSummaryNode?.insertAdjacentElement('afterend', pathSummaryNode); }
    else if (home) home.prepend(homeSummaryNode, pathSummaryNode);
  }
  function installProfileHistory() {
    if (window.profilePage?.__tfStudyHubWrapped) return;
    const old = window.profilePage;
    if (typeof old !== 'function') return;
    const wrapped = function () { return old.apply(this, arguments) + profileHistoryMarkup(); };
    wrapped.__tfStudyHubWrapped = true; window.profilePage = wrapped;
  }
  function boot() {
    if (booted) return;
    booted = true;
    installProfileHistory();
    const main = document.getElementById('m');
    if (main) {
      const observer = new MutationObserver(() => { mountPracticeGuides(); injectHome(); installProfileHistory(); });
      observer.observe(main, { childList: true, subtree: true });
      mountPracticeGuides(); injectHome();
    }
    if (main?.dataset.route === 'home' || main?.dataset.route === 'pro') window.openView?.();
  }

  window.TFStudyHub = {
    routeMarkup, pathFolder, homeSummary, openPath, resumePath, openTask, completeTask, startExisting,
    selectPathSkill, openReview, markReviewDone, startDueWords, practiceSkill, openInsights, openHistory, saveTaskDraft,
    setHistoryFilter, showHistoryDetail, clearHistoryDetail, openGuide, closeGuide, checkGuide, practiceGuide,
    reviewChips, skillMapMarkup, historyMarkup
  };
  window.addEventListener('DOMContentLoaded', boot, { once: true });
  if (document.readyState !== 'loading') boot();
})(window, document);
