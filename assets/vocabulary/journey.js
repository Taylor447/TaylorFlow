(() => {
  const LEVELS = [
    { id: "A0", title: "Nền tảng", subtitle: "Từ thông dụng để bắt đầu nói những điều gần gũi.", color: "#18a84c", bg: "#e4f9e9", topics: ["Ẩm thực và mua sắm", "Gia đình và bạn bè"] },
    { id: "A1", title: "Sơ cấp", subtitle: "Từ vựng thiết yếu cho đời sống và sinh hoạt hằng ngày.", color: "#39ad35", bg: "#eaf8df", topics: ["Đời sống sinh viên", "Sức khỏe và vận động"] },
    { id: "A2", title: "Sơ trung cấp", subtitle: "Mở rộng khả năng mô tả sở thích và việc học.", color: "#08a99b", bg: "#e0f8f3", topics: ["Học tập đại học", "Sở thích và giao tiếp"] },
    { id: "B1", title: "Trung cấp", subtitle: "Diễn đạt trải nghiệm và các chủ đề quen thuộc rõ ràng hơn.", color: "#168ee0", bg: "#e4f2ff", topics: ["Du lịch và trải nghiệm", "Quê hương và cộng đồng"] },
    { id: "B2", title: "Trung cao cấp", subtitle: "Trao đổi về xã hội, nghề nghiệp và các vấn đề rộng hơn.", color: "#5868d8", bg: "#eceeff", topics: ["Giao thông và đô thị", "Công việc và nghề nghiệp"] },
    { id: "C1", title: "Cao cấp", subtitle: "Từ vựng linh hoạt cho chủ đề chuyên môn và công nghệ.", color: "#8a54c5", bg: "#f3eaff", topics: ["Công nghệ số và AI", "Điện và kỹ thuật"] },
    { id: "C2", title: "Thành thạo", subtitle: "Khám phá sắc thái trong các chủ đề phức tạp.", color: "#d64e75", bg: "#ffeaf0", topics: ["Năng lượng và môi trường", "Thiên nhiên và thời tiết"] }
  ];
  const KEY = "taylorflow-vocabulary-journey-v1";
  let root = null;
  let units = [];
  let rowsById = new Map();
  let selected = null;
  let quiz = null;
  let quizAnswers = {};
  let quizResult = null;
  let progress = readProgress();

  function readProgress() {
    try {
      const saved = JSON.parse(localStorage.getItem(KEY) || "{}");
      return {
        learned: Array.isArray(saved.learned) ? saved.learned : [],
        completed: Array.isArray(saved.completed) ? saved.completed : []
      };
    } catch {
      return { learned: [], completed: [] };
    }
  }
  function saveProgress() {
    try { localStorage.setItem(KEY, JSON.stringify(progress)); } catch {}
  }
  function esc(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, char => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    })[char]);
  }
  function slug(value) {
    return String(value || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "")
      .replace(/đ/g, "d").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  }
  function makeUnits(data) {
    const byTopic = new Map();
    (Array.isArray(data) ? data : []).forEach(row => {
      if (!Array.isArray(row) || !row[0] || !row[5]) return;
      const topic = String(row[5]).trim();
      if (!byTopic.has(topic)) byTopic.set(topic, []);
      byTopic.get(topic).push(row);
    });
    const result = [];
    rowsById = new Map();
    LEVELS.forEach(level => {
      level.topics.forEach(topic => {
        const seen = new Set();
        const rows = (byTopic.get(topic) || []).filter(row => {
          const word = String(row[0]).trim();
          const key = word.toLocaleLowerCase("en");
          if (!word || seen.has(key)) return false;
          seen.add(key);
          return true;
        });
        for (let start = 0; start < rows.length; start += 10) {
          const part = rows.slice(start, start + 10);
          const unit = {
            id: slug(level.id + "-" + topic + "-" + (Math.floor(start / 10) + 1)),
            level: level.id,
            topic,
            rows: part,
            index: result.length,
            topicPart: Math.floor(start / 10) + 1,
            topicParts: Math.ceil(rows.length / 10)
          };
          part.forEach(row => rowsById.set(wordId(unit, row), row));
          result.push(unit);
        }
      });
    });
    return result;
  }
  function wordId(unit, row) { return unit.id + "-" + slug(row[0]); }
  function firstOpenIndex() {
    const next = units.findIndex(unit => !progress.completed.includes(unit.id));
    return next < 0 ? units.length : next;
  }
  function isUnlocked(unit) {
    return unit.index <= firstOpenIndex();
  }
  function currentUnit() {
    return units.find(unit => !progress.completed.includes(unit.id)) || null;
  }
  function levelDone(level) {
    const group = units.filter(unit => unit.level === level.id);
    return group.filter(unit => progress.completed.includes(unit.id)).length;
  }
  function learnedIn(unit) {
    return unit.rows.filter(row => progress.learned.includes(wordId(unit, row))).length;
  }
  function totalUniqueWords() { return units.reduce((sum, unit) => sum + unit.rows.length, 0); }
  function allLearnedCount() { return new Set(progress.learned).size; }
  function curvePath(count, mobile) {
    const cols = mobile ? 3 : 5;
    const pattern = mobile ? [2, 3, 2, 1, 2, 3, 2, 1] : [3, 4, 3, 2, 1, 2, 3, 4, 5, 4, 3, 2, 1];
    const width = 1000;
    const height = Math.max(120, count * 136 + 30);
    const points = Array.from({ length: count }, (_, i) => {
      const col = pattern[i % pattern.length];
      return { x: ((col - 0.5) / cols) * width, y: i * 136 + 42 };
    });
    let d = "";
    points.forEach((point, i) => {
      if (!i) d = "M " + point.x + " " + point.y;
      else {
        const previous = points[i - 1];
        const middleY = (previous.y + point.y) / 2;
        d += " Q " + previous.x + " " + middleY + " " + ((previous.x + point.x) / 2) + " " + middleY;
        d += " T " + point.x + " " + point.y;
      }
    });
    return { d, height, pattern, mobilePattern: mobile ? pattern : [2, 3, 2, 1, 2, 3, 2, 1] };
  }
  function unitStatus(unit) {
    if (progress.completed.includes(unit.id)) return "done";
    if (unit.index === firstOpenIndex()) return "current";
    return "locked";
  }
  function mapMarkup() {
    const active = currentUnit();
    const learned = allLearnedCount();
    const completed = progress.completed.length;
    const total = totalUniqueWords();
    const levelsMarkup = LEVELS.map(level => {
      const levelUnits = units.filter(unit => unit.level === level.id);
      if (!levelUnits.length) return "";
      const done = levelDone(level);
      const percent = Math.round(done / levelUnits.length * 100);
      const activeLevel = active && active.level === level.id;
      const route = curvePath(levelUnits.length, false);
      const mobileRoute = curvePath(levelUnits.length, true);
      const stops = levelUnits.map((unit, i) => {
        const status = unitStatus(unit);
        const desktopCol = route.pattern[i % route.pattern.length];
        const mobileCol = mobileRoute.pattern[i % mobileRoute.pattern.length];
        const glyph = status === "done" ? "✓" : status === "locked" ? "🔒" : "★";
        const label = unit.topicParts > 1 ? unit.topic + " · Chặng " + unit.topicPart : unit.topic;
        const unitLearned = learnedIn(unit);
        const bubble = status === "current" ? '<span class="vj-label-bubble">HỌC TIẾP</span>' : "";
        return '<button type="button" class="vj-stop is-' + status + '" data-vj-action="open" data-vj-unit="' + esc(unit.id) + '"' +
          (status === "locked" ? ' disabled aria-disabled="true"' : "") +
          ' style="--stop-col:' + desktopCol + ';--stop-col-mobile:' + mobileCol + ';--stop-row:' + (i + 1) + '"' +
          ' aria-label="' + esc((status === "locked" ? "Đã khóa: " : "Mở bài: ") + label + ", " + unit.rows.length + " từ") + '">' +
          bubble + '<span class="vj-stop-core" aria-hidden="true">' + glyph + '</span>' +
          '<span class="vj-stop-name">' + esc(label) + '</span>' +
          '<span class="vj-stop-meta">' + (status === "done" ? "Hoàn thành" : status === "locked" ? "Còn khóa" : unitLearned + "/" + unit.rows.length + " từ") + '</span></button>';
      }).join("");
      return '<details class="vj-level" ' + (activeLevel ? "open" : "") + ' style="--lv-color:' + level.color + ';--lv-bg:' + level.bg + '">' +
        '<summary><span class="vj-level-badge">' + level.id + '</span><span><span class="vj-level-title">' + esc(level.title) +
        '</span><span class="vj-level-desc">' + esc(level.subtitle) + '</span></span><span class="vj-level-count">' + done + "/" + levelUnits.length + " chặng · " + percent + '%</span><span class="vj-chevron" aria-hidden="true">›</span></summary>' +
        '<div class="vj-level-progress" aria-label="Tiến độ ' + level.id + '"><span style="width:' + percent + '%"></span></div>' +
        '<div class="vj-road"><svg viewBox="0 0 1000 ' + route.height + '" preserveAspectRatio="none" aria-hidden="true">' +
        '<path class="vj-road-line vj-road-line-desktop" d="' + route.d + '"></path><path class="vj-road-line vj-road-line-mobile" d="' + mobileRoute.d + '"></path></svg>' +
        '<div class="vj-stops" style="grid-template-rows:repeat(' + levelUnits.length + ',136px)">' + stops + '</div></div></details>';
    }).join("");
    const next = active;
    const todayLabel = next ? next.level + " · " + next.topic : "Lộ trình đã hoàn thành";
    return '<div class="vj-shell"><header class="vj-header"><div><p class="vj-kicker">TaylorFlow · Học theo cấp độ</p><h2>Đường học từ vựng</h2><p class="vj-subtitle">Đi từng chặng theo chủ đề, ghi nhớ từ mới và mở khóa cấp độ tiếp theo.</p></div></header>' +
      '<div class="vj-overview"><div class="vj-stat"><strong>' + total.toLocaleString("vi-VN") + '</strong><span>Từ theo chủ đề</span></div>' +
      '<div class="vj-stat"><strong>' + learned.toLocaleString("vi-VN") + '</strong><span>Từ đã đánh dấu nhớ</span></div>' +
      '<div class="vj-stat"><strong>' + completed + "/" + units.length + '</strong><span>Chặng đã hoàn thành</span></div></div>' +
      '<div class="vj-daily"><div><small>' + esc(todayLabel) + '</small><strong>' + (next ? "Chặng tiếp theo đang chờ bạn" : "Bạn đã đi hết lộ trình!") + '</strong></div>' +
      (next ? '<button type="button" data-vj-action="open" data-vj-unit="' + esc(next.id) + '">Tiếp tục học →</button>' : '<span aria-hidden="true">🏆</span>') + '</div>' +
      '<div class="vj-levels">' + levelsMarkup + '</div></div>';
  }
  function courseMarkup(unit) {
    const level = LEVELS.find(item => item.id === unit.level);
    const remembered = learnedIn(unit);
    const threshold = Math.ceil(unit.rows.length * 0.7);
    const rows = unit.rows.map(row => {
      const id = wordId(unit, row);
      const saved = typeof window.taylorFlowVocabularyIsSaved === "function" && window.taylorFlowVocabularyIsSaved(row[0]);
      const example = row[3] ? '<p class="vj-word-example" lang="en">' + esc(row[3]) + '</p>' : "";
      return '<article class="vj-word"><div class="vj-word-main"><h4 lang="en">' + esc(row[0]) + '</h4>' +
        '<small>' + esc(row[1] || "Chưa có phiên âm") + '</small><p>' + esc(row[2]) + '</p>' + example + '</div>' +
        '<div class="vj-word-actions"><button type="button" class="vj-save" data-vj-action="save" data-vj-word="' + esc(row[0]) + '"' + (saved ? " disabled" : "") + '>' + (saved ? "✓ Đã lưu" : "+ Lưu từ") + '</button>' +
        '<label class="vj-remember"><input type="checkbox" data-vj-action="remember" data-vj-id="' + esc(id) + '"' + (progress.learned.includes(id) ? " checked" : "") + '> Đã nhớ</label></div></article>';
    }).join("");
    const quizPanel = Array.isArray(quiz) ? quizMarkup(unit) : "";
    return '<div class="vj-course"><div class="vj-course-head"><div><p class="vj-kicker">' + unit.level + " · " + esc(level.title) + " · " + esc(unit.topic) +
      '</p><h3>' + esc(unit.topic) + (unit.topicParts > 1 ? " · Chặng " + unit.topicPart : "") + '</h3><p>' + unit.rows.length + " từ · Đã nhớ " + remembered + "/" + unit.rows.length +
      '</p></div><button type="button" class="vj-button secondary" data-vj-action="back">← Bản đồ</button></div><div class="vj-course-list">' + rows + '</div>' +
      '<p class="vj-note">Đánh dấu đã nhớ ít nhất ' + threshold + " từ để mở bài kiểm tra chặng này.</p>" +
      '<div style="margin-top:16px"><button type="button" class="vj-button" data-vj-action="quiz" ' + (remembered < threshold ? "disabled" : "") + '>' +
      (progress.completed.includes(unit.id) ? "Ôn lại bài kiểm tra" : "Bắt đầu kiểm tra →") + '</button></div>' + quizPanel + '</div>';
  }
  function quizMarkup(unit) {
    if (!Array.isArray(quiz) || quiz.length === 0) return "";
    const questions = quiz;
    const checked = quizResult !== null;
    const items = questions.map((question, index) => {
      const selectedAnswer = quizAnswers[index];
      const options = question.options.map(row => {
        const correct = row[0] === question.answer[0];
        const isSelected = selectedAnswer === row[0];
        const classes = ["vj-quiz-option"];
        if (isSelected) classes.push("is-selected");
        if (checked && correct) classes.push("is-correct");
        if (checked && isSelected && !correct) classes.push("is-wrong");
        return '<button type="button" class="' + classes.join(" ") + '" data-vj-action="answer" data-vj-question="' + index + '" data-vj-answer="' + esc(row[0]) + '"' +
          (checked ? " disabled" : "") + '>' + esc(row[0]) + '</button>';
      }).join("");
      return '<div class="vj-quiz-item"><p>' + (index + 1) + ". " + esc(question.answer[2] || question.answer[0]) + '</p><div class="vj-quiz-options">' + options + '</div></div>';
    }).join("");
    let feedback = "";
    if (checked) {
      const score = questions.reduce((sum, question, index) => sum + (quizAnswers[index] === question.answer[0] ? 1 : 0), 0);
      const passed = score / questions.length >= 0.8;
      feedback = '<p class="vj-feedback ' + (passed ? "good" : "retry") + '">' + (passed ?
        "Tuyệt vời! " + score + "/" + questions.length + " câu đúng. Chặng tiếp theo đã được mở." :
        score + "/" + questions.length + " câu đúng. Hãy ôn lại từ và thử lại nhé.") + '</p>';
      if (passed && !progress.completed.includes(unit.id)) {
        progress.completed.push(unit.id);
        saveProgress();
      }
    }
    return '<section class="vj-quiz"><h4>Kiểm tra nhanh · Chọn từ tiếng Anh đúng nghĩa</h4>' + items + feedback +
      (!checked ? '<button type="button" class="vj-button" data-vj-action="submit-quiz" ' + (Object.keys(quizAnswers).length < questions.length ? "disabled" : "") + '>Nộp đáp án</button>' :
        '<button type="button" class="vj-button secondary" data-vj-action="back-map">Quay lại đường học</button>') + '</section>';
  }
  function startQuiz(unit) {
    const pool = unit.rows.slice();
    const count = Math.min(5, pool.length);
    const chosen = pool.sort(() => Math.random() - 0.5).slice(0, count);
    const allRows = units.flatMap(item => item.rows);
    quiz = chosen.map(answer => {
      const distractors = allRows.filter(row => row[0] !== answer[0] && row[2] !== answer[2]).sort(() => Math.random() - 0.5).slice(0, 3);
      return { answer, options: [answer, ...distractors].sort(() => Math.random() - 0.5) };
    });
    quizAnswers = {};
    quizResult = null;
    render();
  }
  function render() {
    if (!root) return;
    if (selected) {
      root.innerHTML = courseMarkup(selected);
      return;
    }
    root.innerHTML = mapMarkup();
  }
  function openUnit(id) {
    const unit = units.find(item => item.id === id);
    if (!unit || !isUnlocked(unit)) return;
    selected = unit;
    quiz = null;
    quizAnswers = {};
    quizResult = null;
    render();
    root.scrollIntoView({ block: "start", behavior: "smooth" });
  }
  function onClick(event) {
    const button = event.target.closest("[data-vj-action]");
    if (!button || !root.contains(button)) return;
    const action = button.dataset.vjAction;
    if (action === "open") openUnit(button.dataset.vjUnit);
    if (action === "back" || action === "back-map") {
      selected = null; quiz = null; quizAnswers = {}; quizResult = null; render();
    }
    if (action === "quiz" && selected && learnedIn(selected) >= Math.ceil(selected.rows.length * 0.7)) startQuiz(selected);
    if (action === "answer" && quizResult === null) {
      quizAnswers[button.dataset.vjQuestion] = button.dataset.vjAnswer;
      render();
    }
    if (action === "submit-quiz" && quiz) { quizResult = true; render(); }
    if (action === "save" && selected && typeof window.taylorFlowVocabularySaveWord === "function") {
      const row = selected.rows.find(item => item[0] === button.dataset.vjWord);
      if (row) { window.taylorFlowVocabularySaveWord(row); render(); }
    }
    if (action === "remember") {
      const id = event.target.dataset.vjId;
      if (event.target.checked && !progress.learned.includes(id)) progress.learned.push(id);
      if (!event.target.checked) progress.learned = progress.learned.filter(item => item !== id);
      saveProgress();
      render();
    }
  }
  function mount(target, data) {
    if (!target) return;
    if (root !== target) {
      if (root) root.removeEventListener("click", onClick);
      root = target;
      root.addEventListener("click", onClick);
    }
    if (!units.length) units = makeUnits(data);
    progress = readProgress();
    render();
  }
  window.TaylorFlowVocabularyJourney = { mount };
})();