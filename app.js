/* =========================================================
   EduSpace — основна логіка застосунку
   Екрани: каталог, тестування, результати, сертифікат,
   прогрес, конструктор тестів.
   ========================================================= */

'use strict';

// ---------- Налаштування ----------
const EXAM_SECONDS = 180;      // 3 хвилини на іспит
const PASS_PERCENT = 70;       // поріг для сертифіката
const POINTS_CORRECT = 10;     // бали за правильну відповідь
const STREAK_BONUS = 5;        // бонус, починаючи з серії 3+
const STREAK_BONUS_FROM = 3;
const LETTERS = ['A', 'B', 'C', 'D', 'E', 'F'];

const LEVELS = {
  easy:   { label: 'Початковий',  cls: 'bg-primary-soft text-primary', bars: 1 },
  medium: { label: 'Середній',    cls: 'bg-subtle text-ink',           bars: 2 },
  hard:   { label: 'Поглиблений', cls: 'bg-danger-soft text-danger-ink', bars: 3 },
};

const ACCENTS = {
  primary: 'bg-primary-soft text-primary-ink',
  success: 'bg-success-soft text-success-ink',
  reward:  'bg-reward-soft text-reward-ink',
  danger:  'bg-danger-soft text-danger-ink',
};

const MODE_LABELS = { training: 'Тренування', exam: 'Іспит' };

// ---------- Стан застосунку ----------
const state = {
  view: 'auth',        // auth | catalog | quiz | results | certificate | progress | builder | journal
  user: null,          // поточний користувач
  modal: null,         // { type: 'mode' | 'confirm' | 'leave', ... }
  quiz: null,          // поточна спроба
  result: null,        // результат останньої спроби
  certificate: null,   // сертифікат, який зараз показано
  builder: freshBuilder(),
  authTab: 'register', // register | login
  authRole: 'student', // student | teacher
  authBusy: false,
  category: 'all',     // фільтр категорії в каталозі
  query: '',           // пошук у каталозі
  journal: { group: 'all', course: 'all' },
};

const isTeacher = () => state.user && state.user.role === 'teacher';
const ROLE_LABELS = { student: 'Студент', teacher: 'Викладач' };

function initials(fullName) {
  return String(fullName || '').trim().split(/\s+/).slice(0, 2).map((p) => p[0] || '').join('').toUpperCase();
}

function categoryOf(id) {
  return CATEGORIES.find((c) => c.id === id) || CATEGORIES[CATEGORIES.length - 1];
}

let timerId = null;
let lastRenderKey = '';
let lastLeaveAt = 0;
let prevProgress = 0;

const $app = document.getElementById('app');
const $modal = document.getElementById('modal-root');

// =========================================================
//  Модулі
// =========================================================
function getAllModules() {
  return [...MODULES, ...Store.getTests()];
}

function findModule(id) {
  return getAllModules().find((m) => m.id === id) || null;
}

function examSecondsFor(module) {
  // для довгих власних тестів даємо більше часу (≈36 с на питання)
  return Math.max(EXAM_SECONDS, module.questions.length * 36);
}

function levelBadge(level) {
  const l = LEVELS[level] || LEVELS.easy;
  const bars = [1, 2, 3].map((i) => `<span class="level-bar ${i <= l.bars ? 'is-on' : ''}"></span>`).join('');
  return `<span class="badge ${l.cls}"><span class="level-bars">${bars}</span>${l.label}</span>`;
}

// =========================================================
//  Логіка тестування
// =========================================================

/** Готує питання: перемішує порядок питань і варіантів відповідей */
function prepareQuestions(questions) {
  return shuffle(questions).map((q) => {
    const order = shuffle(q.options.map((_, i) => i));
    return {
      text: q.text,
      options: order.map((i) => q.options[i]),
      correct: order.indexOf(q.correct),
      explanation: q.explanation,
    };
  });
}

function startQuiz(moduleId, mode, { review = false, questions = null } = {}) {
  const module = findModule(moduleId);
  if (!module) {
    toast('Модуль не знайдено. Можливо, його видалили.', 'error');
    return navigate('catalog');
  }
  stopTimer();
  const prepared = prepareQuestions(questions || module.questions);
  state.quiz = {
    moduleId: module.id,
    title: module.title,
    mode,
    review,
    questions: prepared,
    index: 0,
    answers: [],
    selected: null,
    locked: false,
    streak: 0,
    maxStreak: 0,
    score: 0,
    lastGain: 0,
    bumped: false,
    leaves: 0,
    timeLeft: examSecondsFor({ questions: prepared }),
    startedAt: Date.now(),
    finished: false,
  };
  state.modal = null;
  state.result = null;
  prevProgress = 0;
  state.view = 'quiz';
  if (mode === 'exam') startTimer();
  render();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

/** Фіксує відповідь, оновлює серію та бали */
function recordAnswer(selected) {
  const z = state.quiz;
  const q = z.questions[z.index];
  const correct = selected === q.correct;
  z.answers.push({ question: q, selected, correct });
  if (correct) {
    z.streak += 1;
    z.maxStreak = Math.max(z.maxStreak, z.streak);
    z.lastGain = POINTS_CORRECT + (z.streak >= STREAK_BONUS_FROM ? STREAK_BONUS : 0);
    z.score += z.lastGain;
    z.bumped = true;
  } else {
    z.streak = 0;
    z.lastGain = 0;
    z.bumped = false;
  }
  return correct;
}

function selectAnswer(index) {
  const z = state.quiz;
  if (!z || z.locked || z.finished) return;
  if (index < 0 || index >= z.questions[z.index].options.length) return;

  z.selected = index;
  if (z.mode === 'training') {
    z.locked = true;          // у тренуванні відповідь одразу перевіряється
    recordAnswer(index);
  }
  render();
  if (z.mode === 'training') z.bumped = false;
}

function nextQuestion() {
  const z = state.quiz;
  if (!z || z.finished) return;
  if (z.mode === 'training' && !z.locked) return;
  if (z.mode === 'exam') {
    if (z.selected === null) return;
    recordAnswer(z.selected);
  }
  if (z.index >= z.questions.length - 1) {
    finishQuiz('done');
    return;
  }
  z.index += 1;
  z.selected = null;
  z.locked = false;
  render();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function finishQuiz(reason) {
  const z = state.quiz;
  if (!z || z.finished) return;
  stopTimer();
  z.finished = true;

  // Якщо час вийшов — зараховуємо вибрану, але не підтверджену відповідь
  if (reason === 'timeout' && z.mode === 'exam' && z.selected !== null && z.answers.length === z.index) {
    recordAnswer(z.selected);
  }
  // Питання без відповіді — неправильні
  for (let i = z.answers.length; i < z.questions.length; i++) {
    z.answers.push({ question: z.questions[i], selected: null, correct: false });
  }

  const total = z.questions.length;
  const correctCount = z.answers.filter((a) => a.correct).length;
  const percent = Math.round((correctCount / total) * 100);
  const seconds = Math.round((Date.now() - z.startedAt) / 1000);

  state.result = {
    moduleId: z.moduleId,
    title: z.title,
    mode: z.mode,
    review: z.review,
    total,
    correctCount,
    percent,
    score: z.score,
    maxStreak: z.maxStreak,
    seconds,
    leaves: z.leaves,
    reason,
    passed: percent >= PASS_PERCENT,
    answers: z.answers,
    date: new Date().toISOString(),
  };

  Store.addAttempt({
    id: uid('attempt'),
    userId: state.user.id,
    userName: state.user.name,
    userGroup: state.user.group,
    userRole: state.user.role,
    category: findModule(z.moduleId)?.category || 'other',
    moduleId: z.moduleId,
    title: z.title,
    mode: z.mode,
    review: z.review,
    total,
    correct: correctCount,
    percent,
    score: z.score,
    maxStreak: z.maxStreak,
    seconds,
    leaves: z.leaves,
    reason,
    date: state.result.date,
  });

  state.modal = null;
  state.view = 'results';
  render();
  window.scrollTo({ top: 0, behavior: 'smooth' });

  if (state.result.passed && !z.review) celebrate();
  checkBadges();
}

// ---------- Таймер іспиту ----------
function timerClass(t) {
  if (t <= 30) return 'pill pill-danger is-urgent';
  if (t <= 60) return 'pill pill-reward';
  return 'pill pill-primary';
}

function startTimer() {
  stopTimer();
  timerId = setInterval(() => {
    const z = state.quiz;
    if (!z || z.finished) return stopTimer();
    z.timeLeft -= 1;
    const pill = document.getElementById('timer');
    const text = document.getElementById('timer-text');
    if (pill && text) {
      pill.className = timerClass(z.timeLeft);
      text.textContent = formatTime(z.timeLeft);
    }
    if (z.timeLeft <= 0) {
      toast('Час вичерпано — тест завершено автоматично.', 'error');
      finishQuiz('timeout');
    }
  }, 1000);
}

function stopTimer() {
  if (timerId) clearInterval(timerId);
  timerId = null;
}

// ---------- Контроль чесності: вихід зі сторінки під час іспиту ----------
function registerLeave() {
  const z = state.quiz;
  if (state.view !== 'quiz' || !z || z.mode !== 'exam' || z.finished) return;
  const now = Date.now();
  if (now - lastLeaveAt < 1500) return; // blur і visibilitychange часто спрацьовують разом
  lastLeaveAt = now;
  z.leaves += 1;
  state.modal = { type: 'leave', count: z.leaves };
  render();
}

// =========================================================
//  Екран: каталог модулів
// =========================================================
function moduleCard(m, history) {
  const n = m.questions.length;
  const attempts = history.filter((a) => a.moduleId === m.id && !a.review);
  const best = attempts.length ? Math.max(...attempts.map((a) => a.percent)) : null;
  const cat = categoryOf(m.category);

  return `
  <article class="card card-hover course-card p-6 flex flex-col">
    <div class="flex items-start justify-between gap-3">
      <div class="icon-tile icon-tile-accent"><i data-lucide="${esc(m.icon || 'notebook-pen')}"></i></div>
      ${levelBadge(m.level)}
    </div>
    <p class="mt-5 eyebrow">${esc(cat.short)}${m.custom ? ` · ${m.imported ? 'імпорт' : 'тест викладача'}` : ''}</p>
    <h3 class="mt-1.5 text-lg font-bold leading-snug">${esc(m.title)}</h3>
    <p class="mt-2 text-sm text-muted flex-1">${esc(m.description)}</p>
    ${m.authorName ? `<p class="mt-3 text-xs text-muted flex items-center gap-1.5"><i data-lucide="user-round" class="w-3.5 h-3.5"></i>${esc(m.authorName)}</p>` : ''}
    ${best !== null ? `
      <div class="mt-4 flex items-center gap-2 text-sm">
        <i data-lucide="trophy" class="w-4 h-4 text-primary"></i>
        <span class="text-muted">Найкращий результат:</span>
        <b class="${best >= PASS_PERCENT ? 'text-primary' : 'text-ink'}">${best}%</b>
      </div>` : ''}
    <div class="mt-5 pt-4 border-t border-line flex items-center justify-between gap-3">
      <div class="flex items-center gap-4 text-sm text-muted">
        <span class="inline-flex items-center gap-1.5"><i data-lucide="list-checks" class="w-4 h-4"></i>${n} ${plural(n, ['питання', 'питання', 'питань'])}</span>
        <span class="inline-flex items-center gap-1.5"><i data-lucide="clock" class="w-4 h-4"></i>~${Math.max(1, Math.ceil(n * 0.7))} хв</span>
      </div>
      <button class="btn btn-primary btn-sm" data-action="open-mode" data-id="${esc(m.id)}">
        Почати <i data-lucide="arrow-up-right"></i>
      </button>
    </div>
  </article>`;
}

/** Курси з урахуванням фільтра категорії та пошуку */
function filteredModules() {
  const q = state.query.trim().toLowerCase();
  return getAllModules().filter((m) =>
    (state.category === 'all' || m.category === state.category) &&
    (!q || `${m.title} ${m.description} ${categoryOf(m.category).title}`.toLowerCase().includes(q)));
}

function courseGridHtml() {
  const history = Store.getHistory(state.user.id);
  const list = filteredModules();
  if (!list.length) {
    return `
      <div class="empty-state">
        <span class="icon-tile icon-tile-accent"><i data-lucide="search-x"></i></span>
        <p class="mt-4 font-bold">Нічого не знайдено</p>
        <p class="mt-1 text-sm text-muted">Спробуйте інший запит або оберіть категорію «Усі».</p>
      </div>`;
  }
  const grid = (items) => `<div class="grid md:grid-cols-2 xl:grid-cols-3 gap-5">${items.map((m) => moduleCard(m, history)).join('')}</div>`;

  // Якщо обрано «Усі» і немає пошуку — групуємо за категоріями
  if (state.category === 'all' && !state.query.trim()) {
    return CATEGORIES.map((c) => {
      const items = list.filter((m) => m.category === c.id);
      if (!items.length) return '';
      return `
        <div class="category-block">
          <div class="category-head">
            <span class="category-head-icon"><i data-lucide="${c.icon}"></i></span>
            <h3>${esc(c.title)}</h3>
            <span class="category-count">${items.length}</span>
            <button class="link ml-auto" data-action="set-category" data-id="${c.id}">Усі курси <i data-lucide="arrow-right"></i></button>
          </div>
          ${grid(items)}
        </div>`;
    }).join('');
  }
  return grid(list);
}

function categoryChipsHtml() {
  const all = getAllModules();
  const chip = (id, title, icon, count) => `
    <button class="cat-chip ${state.category === id ? 'is-active' : ''}" data-action="set-category" data-id="${id}">
      <i data-lucide="${icon}"></i><span>${esc(title)}</span><b>${count}</b>
    </button>`;
  return chip('all', 'Усі', 'layout-grid', all.length) +
    CATEGORIES.map((c) => {
      const n = all.filter((m) => m.category === c.id).length;
      return n ? chip(c.id, c.short, c.icon, n) : '';
    }).join('');
}

function viewCatalog() {
  const u = state.user;
  const all = getAllModules();
  const totalQ = all.reduce((s, m) => s + m.questions.length, 0);
  const usedCats = new Set(all.map((m) => m.category)).size;

  let side;
  if (isTeacher()) {
    const attempts = Store.getAllAttempts().filter((a) => a.userRole === 'student');
    const students = Store.getUsers().filter((x) => x.role === 'student').length;
    const avg = attempts.length ? Math.round(attempts.reduce((s, a) => s + a.percent, 0) / attempts.length) : 0;
    const myTests = Store.getTests().filter((t) => t.ownerId === u.id).length;
    side = `
      <div class="card p-6 flex flex-col">
        <div class="flex items-center justify-between">
          <h2 class="font-bold">Панель викладача</h2>
          <button class="link" data-action="nav" data-view="journal">Журнал <i data-lucide="arrow-right"></i></button>
        </div>
        <div class="mt-5 grid grid-cols-2 gap-3 flex-1">
          <div class="mini-stat"><span class="mini-stat-icon"><i data-lucide="users"></i></span><div><p class="text-2xl font-extrabold">${students}</p><p class="text-xs text-muted">${plural(students, ['студент', 'студенти', 'студентів'])}</p></div></div>
          <div class="mini-stat"><span class="mini-stat-icon"><i data-lucide="target"></i></span><div><p class="text-2xl font-extrabold">${attempts.length}</p><p class="text-xs text-muted">${plural(attempts.length, ['спроба', 'спроби', 'спроб'])}</p></div></div>
          <div class="mini-stat"><span class="mini-stat-icon"><i data-lucide="percent"></i></span><div><p class="text-2xl font-extrabold">${avg}%</p><p class="text-xs text-muted">середній бал</p></div></div>
          <div class="mini-stat"><span class="mini-stat-icon"><i data-lucide="pencil-ruler"></i></span><div><p class="text-2xl font-extrabold">${myTests}</p><p class="text-xs text-muted">моїх тестів</p></div></div>
        </div>
      </div>`;
  } else {
    const history = Store.getHistory(u.id);
    const badgesCount = Object.keys(Store.getBadges(u.id)).length;
    const certs = Store.getCertificates(u.id).length;
    const avg = history.length ? Math.round(history.reduce((s, a) => s + a.percent, 0) / history.length) : 0;
    side = `
      <div class="card p-6 flex flex-col">
        <div class="flex items-center justify-between">
          <h2 class="font-bold">Мій прогрес</h2>
          <button class="link" data-action="nav" data-view="progress">Детальніше <i data-lucide="arrow-right"></i></button>
        </div>
        <div class="mt-5 grid grid-cols-2 gap-3 flex-1">
          <div class="mini-stat"><span class="mini-stat-icon"><i data-lucide="target"></i></span><div><p class="text-2xl font-extrabold">${history.length}</p><p class="text-xs text-muted">${plural(history.length, ['спроба', 'спроби', 'спроб'])}</p></div></div>
          <div class="mini-stat"><span class="mini-stat-icon"><i data-lucide="percent"></i></span><div><p class="text-2xl font-extrabold">${avg}%</p><p class="text-xs text-muted">середній бал</p></div></div>
          <div class="mini-stat"><span class="mini-stat-icon"><i data-lucide="medal"></i></span><div><p class="text-2xl font-extrabold">${badgesCount}/${BADGES.length}</p><p class="text-xs text-muted">досягнень</p></div></div>
          <div class="mini-stat"><span class="mini-stat-icon"><i data-lucide="award"></i></span><div><p class="text-2xl font-extrabold">${certs}</p><p class="text-xs text-muted">${plural(certs, ['сертифікат', 'сертифікати', 'сертифікатів'])}</p></div></div>
        </div>
      </div>`;
  }

  return `
  <section class="grid lg:grid-cols-[1.4fr_1fr] gap-6 items-stretch">
    <div class="hero-card">
      <span class="chip"><i data-lucide="${isTeacher() ? 'presentation' : 'sparkles'}"></i>${esc(u.name)} · ${isTeacher() ? 'Кабінет викладача' : `група ${esc(u.group)}`}</span>
      <h1 class="mt-5 text-3xl sm:text-5xl font-extrabold leading-[1.05] tracking-tight">
        Привіт! 👋<br><span class="text-primary">${isTeacher() ? 'Створюйте. Перевіряйте.' : 'Час прокачати знання.'}</span>
      </h1>
      <p class="mt-4 text-muted max-w-xl">
        ${isTeacher()
          ? 'Переглядайте курси, створюйте власні тести в конструкторі та стежте за результатами студентів у журналі.'
          : 'Обирай курс, тренуйся з поясненнями або складай іспит на час. Збирай серії правильних відповідей, відкривай досягнення й отримуй сертифікати.'}
      </p>
      <div class="mt-6 flex flex-wrap gap-3">
        <span class="stat-chip"><i data-lucide="layers"></i><b>${usedCats}</b> ${plural(usedCats, ['категорія', 'категорії', 'категорій'])}</span>
        <span class="stat-chip"><i data-lucide="library"></i><b>${all.length}</b> ${plural(all.length, ['курс', 'курси', 'курсів'])}</span>
        <span class="stat-chip"><i data-lucide="circle-help"></i><b>${totalQ}</b> ${plural(totalQ, ['питання', 'питання', 'питань'])}</span>
      </div>
    </div>
    ${side}
  </section>

  <section class="mt-12">
    <div class="section-head">
      <div>
        <h2 class="section-title text-2xl">Каталог курсів</h2>
        <p class="text-sm text-muted">Оберіть категорію або знайдіть курс за назвою</p>
      </div>
      <div class="flex flex-wrap gap-2">
        <label class="search">
          <i data-lucide="search"></i>
          <input id="catalog-search" type="search" placeholder="Пошук курсу…" value="${esc(state.query)}" autocomplete="off">
        </label>
        ${isTeacher()
          ? `<button class="btn btn-soft btn-sm" data-action="nav" data-view="builder"><i data-lucide="plus"></i>Створити тест</button>`
          : `<button class="btn btn-soft btn-sm" data-action="import" title="Імпортувати тест, отриманий від викладача"><i data-lucide="upload"></i>Імпорт тесту</button>
             <input type="file" id="import-input" accept=".json,application/json" class="hidden">`}
      </div>
    </div>
    <div class="cat-chips" id="category-chips">${categoryChipsHtml()}</div>
    <div id="course-grid" class="mt-6 grid gap-10">${courseGridHtml()}</div>
  </section>`;
}

/** Оновлює лише сітку курсів (щоб поле пошуку не втрачало фокус) */
function refreshCatalogGrid() {
  const grid = document.getElementById('course-grid');
  const chips = document.getElementById('category-chips');
  if (!grid) return;
  grid.innerHTML = courseGridHtml();
  if (chips) chips.innerHTML = categoryChipsHtml();
  refreshIcons();
}

// =========================================================
//  Екран: тестування
// =========================================================
function viewQuiz() {
  const z = state.quiz;
  const total = z.questions.length;
  const q = z.questions[z.index];
  const isTraining = z.mode === 'training';
  const canNext = isTraining ? z.locked : z.selected !== null;
  const isLast = z.index === total - 1;
  const progress = Math.round((z.answers.length / total) * 100);

  const pills = isTraining ? `
      <div class="pill pill-reward ${z.bumped ? 'is-bump' : ''}" title="Правильних відповідей поспіль">
        <i data-lucide="flame"></i><span>Streak <b>${z.streak}</b></span>
      </div>
      <div class="pill pill-primary" title="Набрані бали">
        <i data-lucide="star"></i><span><b>${z.score}</b> ${plural(z.score, ['бал', 'бали', 'балів'])}</span>
      </div>` : `
      <div id="timer" class="${timerClass(z.timeLeft)}" title="Залишок часу">
        <i data-lucide="timer"></i><span id="timer-text">${formatTime(z.timeLeft)}</span>
      </div>
      ${z.leaves ? `<div class="pill pill-danger" title="Скільки разів ви залишали сторінку"><i data-lucide="eye-off"></i><span>Виходів: <b>${z.leaves}</b></span></div>`
        : `<div class="pill pill-muted hidden sm:inline-flex"><i data-lucide="lock"></i><span>Підказки вимкнено</span></div>`}`;

  const options = q.options.map((opt, i) => {
    let cls = 'option-btn';
    let mark = '';
    if (isTraining && z.locked) {
      if (i === q.correct) { cls += ' is-correct'; mark = '<i data-lucide="circle-check" class="option-mark"></i>'; }
      else if (i === z.selected) { cls += ' is-wrong'; mark = '<i data-lucide="circle-x" class="option-mark"></i>'; }
      else cls += ' is-dim';
    } else if (z.selected === i) {
      cls += ' is-selected';
    }
    return `
      <button class="${cls}" data-action="answer" data-index="${i}" ${isTraining && z.locked ? 'disabled' : ''}>
        <span class="option-letter">${LETTERS[i]}</span>
        <span class="flex-1 text-left">${esc(opt)}</span>
        ${mark}
      </button>`;
  }).join('');

  let feedback = '';
  if (isTraining && z.locked) {
    const ok = z.selected === q.correct;
    feedback = `
      <div class="feedback ${ok ? 'feedback-ok' : 'feedback-bad'}">
        <div class="flex flex-wrap items-center justify-between gap-2">
          <p class="flex items-center gap-2 font-bold text-lg">
            <i data-lucide="${ok ? 'party-popper' : 'circle-x'}"></i>${ok ? 'Правильно!' : 'Неправильно'}
          </p>
          ${ok ? `<span class="gain">+${z.lastGain} ${plural(z.lastGain, ['бал', 'бали', 'балів'])}${z.lastGain > POINTS_CORRECT ? ' · бонус за серію 🔥' : ''}</span>`
               : `<span class="text-sm font-semibold">Правильна відповідь: ${LETTERS[q.correct]}</span>`}
        </div>
        <div class="explain">
          <span class="explain-icon"><i data-lucide="lightbulb"></i></span>
          <div>
            <p class="font-bold text-ink">Чому так?</p>
            <p class="mt-1 text-muted">${esc(q.explanation || 'Викладач не додав пояснення до цього питання.')}</p>
          </div>
        </div>
      </div>`;
  }

  return `
  <section class="max-w-3xl mx-auto">
    <div class="flex flex-wrap items-center justify-between gap-3">
      <div class="min-w-0">
        <p class="text-sm text-muted flex items-center gap-2">
          <span class="badge ${isTraining ? ACCENTS.primary : ACCENTS.danger}">
            <i data-lucide="${isTraining ? 'dumbbell' : 'graduation-cap'}"></i>${MODE_LABELS[z.mode]}
          </span>
          ${z.review ? `<span class="badge ${ACCENTS.reward}"><i data-lucide="rotate-ccw"></i>Робота над помилками</span>` : ''}
        </p>
        <h1 class="mt-2 text-xl sm:text-2xl font-extrabold truncate">${esc(z.title)}</h1>
      </div>
      <div class="flex items-center gap-2">${pills}</div>
    </div>

    <div class="mt-6">
      <div class="flex justify-between text-sm font-semibold mb-2">
        <span>Питання ${z.index + 1} з ${total}</span>
        <span class="text-muted">${progress}%</span>
      </div>
      <div class="progress-track"><div class="progress-fill" style="width:${prevProgress}%" data-progress="${progress}"></div></div>
    </div>

    <div class="card p-6 sm:p-8 mt-6 question-card">
      <h2 class="text-xl sm:text-2xl font-bold leading-snug">${esc(q.text)}</h2>
      <div class="mt-6 grid gap-3">${options}</div>
      ${feedback}
    </div>

    <div class="mt-6 flex items-center justify-between gap-3">
      <button class="btn btn-ghost" data-action="quit"><i data-lucide="log-out"></i>Вийти</button>
      <span class="hidden md:inline text-xs text-muted"><kbd>1</kbd>–<kbd>${q.options.length}</kbd> вибір · <kbd>Enter</kbd> далі</span>
      <button class="btn btn-primary" data-action="next" ${canNext ? '' : 'disabled'}>
        ${isLast ? 'Завершити' : 'Далі'} <i data-lucide="${isLast ? 'flag' : 'arrow-right'}"></i>
      </button>
    </div>
  </section>`;
}

// =========================================================
//  Екран: результати
// =========================================================
function resultMessage(p) {
  if (p === 100) return { title: 'Бездоганно!', text: 'Усі відповіді правильні — так тримати!' };
  if (p >= PASS_PERCENT) return { title: 'Чудовий результат!', text: 'Ви успішно впоралися з модулем.' };
  if (p >= 40) return { title: 'Непогано!', text: 'Ще трохи практики — і буде відмінно.' };
  return { title: 'Варто повторити', text: 'Перегляньте пояснення та спробуйте ще раз.' };
}

function viewResults() {
  const r = state.result;
  const msg = resultMessage(r.percent);
  const wrong = r.answers.filter((a) => !a.correct);
  const C = 2 * Math.PI * 52;
  const ringColor = r.passed ? 'stroke-success' : r.percent >= 40 ? 'stroke-reward' : 'stroke-danger';
  const moduleExists = !!findModule(r.moduleId);

  const stat = (icon, accent, value, label) => `
    <div class="mini-stat"><span class="mini-stat-icon ${ACCENTS[accent]}"><i data-lucide="${icon}"></i></span>
      <div><p class="text-xl font-extrabold">${value}</p><p class="text-xs text-muted">${label}</p></div></div>`;

  const review = wrong.length ? wrong.map((a, i) => {
    const q = a.question;
    return `
      <div class="review-item">
        <p class="font-bold"><span class="text-muted font-semibold">${i + 1}.</span> ${esc(q.text)}</p>
        <div class="mt-3 grid sm:grid-cols-2 gap-2 text-sm">
          <p class="answer-chip bg-danger-soft text-danger-ink"><i data-lucide="circle-x"></i><span>Ваша відповідь: <b>${a.selected === null ? 'немає відповіді' : esc(q.options[a.selected])}</b></span></p>
          <p class="answer-chip bg-success-soft text-success-ink"><i data-lucide="circle-check"></i><span>Правильно: <b>${esc(q.options[q.correct])}</b></span></p>
        </div>
        ${q.explanation ? `<p class="mt-3 text-sm text-muted flex gap-2"><i data-lucide="lightbulb" class="w-4 h-4 mt-0.5 flex-none text-reward"></i>${esc(q.explanation)}</p>` : ''}
      </div>`;
  }).join('') : `
    <div class="empty-state py-8">
      <span class="icon-tile ${ACCENTS.success}"><i data-lucide="party-popper"></i></span>
      <p class="mt-3 font-bold">Помилок немає!</p>
      <p class="text-sm text-muted">Ви відповіли правильно на всі питання.</p>
    </div>`;

  let certBlock;
  if (r.review) {
    certBlock = `
      <div class="cert-locked">
        <i data-lucide="info"></i>
        <p>Сертифікат видається лише за повне проходження модуля. Пройдіть модуль повністю, щоб отримати його.</p>
      </div>`;
  } else if (r.passed) {
    certBlock = `
      <form id="cert-form" class="grid sm:grid-cols-[1fr_200px_auto] gap-3 items-end" autocomplete="on">
        <label class="field">
          <span>Прізвище та ім’я</span>
          <input class="input" name="name" required maxlength="60" placeholder="Напр.: Коваленко Олена" value="${esc(state.user.name)}">
        </label>
        <label class="field">
          <span>${isTeacher() ? 'Посада / кафедра' : 'Навчальна група'}</span>
          <input class="input" name="group" ${isTeacher() ? '' : 'required'} maxlength="40" placeholder="${isTeacher() ? 'Необов’язково' : 'Напр.: КН-21'}" value="${esc(isTeacher() ? state.user.subject : state.user.group)}">
        </label>
        <button class="btn btn-primary" type="submit"><i data-lucide="award"></i>Отримати сертифікат</button>
      </form>`;
  } else {
    certBlock = `
      <div class="cert-locked">
        <i data-lucide="lock"></i>
        <p>Для сертифіката потрібно щонайменше <b>${PASS_PERCENT}%</b>. Ваш результат — <b>${r.percent}%</b>. Спробуйте ще раз!</p>
      </div>`;
  }

  return `
  <section class="grid lg:grid-cols-[340px_1fr] gap-6 items-start">
    <aside class="card p-6 sm:p-8 text-center lg:sticky lg:top-24">
      <div class="ring-wrap">
        <svg viewBox="0 0 120 120" class="w-44 h-44 -rotate-90">
          <circle cx="60" cy="60" r="52" class="ring-track" />
          <circle cx="60" cy="60" r="52" class="ring-value ${ringColor}"
            stroke-dasharray="${C.toFixed(1)}" stroke-dashoffset="${C.toFixed(1)}"
            data-ring="${(C * (1 - r.percent / 100)).toFixed(1)}" />
        </svg>
        <div class="ring-label">
          <span class="text-4xl font-extrabold">${r.percent}%</span>
          <span class="text-xs text-muted">${r.correctCount} з ${r.total}</span>
        </div>
      </div>
      <h1 class="mt-5 text-2xl font-extrabold">${msg.title}</h1>
      <p class="mt-1 text-muted">${msg.text}</p>
      <p class="mt-4 text-sm text-muted">${esc(r.title)} · ${MODE_LABELS[r.mode]}${r.review ? ' · помилки' : ''}</p>

      <div class="mt-6 grid gap-2">
        ${moduleExists ? `<button class="btn btn-primary w-full" data-action="retry"><i data-lucide="rotate-ccw"></i>Пройти ще раз</button>` : ''}
        ${moduleExists && wrong.length ? `<button class="btn btn-soft w-full" data-action="review-mistakes"><i data-lucide="wrench"></i>Робота над помилками (${wrong.length})</button>` : ''}
        <button class="btn btn-ghost w-full" data-action="nav" data-view="catalog"><i data-lucide="house"></i>До каталогу</button>
      </div>
    </aside>

    <div class="grid gap-6">
      ${r.reason === 'timeout' ? `<div class="banner bg-danger-soft text-danger-ink"><i data-lucide="alarm-clock-off"></i><p><b>Час вичерпано.</b> Питання без відповіді зараховано як неправильні.</p></div>` : ''}
      ${r.mode === 'exam' && r.leaves ? `<div class="banner bg-reward-soft text-reward-ink"><i data-lucide="eye-off"></i><p>Під час іспиту ви залишали сторінку <b>${r.leaves}</b> ${plural(r.leaves, ['раз', 'рази', 'разів'])}. Це зафіксовано в історії спроб.</p></div>` : ''}

      <div class="grid grid-cols-2 md:grid-cols-3 gap-3">
        ${stat('circle-check', 'success', r.correctCount, 'правильних')}
        ${stat('circle-x', 'danger', r.total - r.correctCount, 'помилок')}
        ${stat('star', 'primary', r.score, plural(r.score, ['бал', 'бали', 'балів']))}
        ${stat('flame', 'reward', r.maxStreak, 'найкраща серія')}
        ${stat('clock', 'primary', formatDuration(r.seconds), 'витрачено часу')}
        ${r.mode === 'exam' ? stat('shield-check', r.leaves ? 'danger' : 'success', r.leaves, 'виходів зі сторінки') : stat('dumbbell', 'success', 'Тренування', 'режим')}
      </div>

      <div class="card p-6">
        <h2 class="section-title flex items-center gap-2"><i data-lucide="search-check" class="text-primary"></i>Розбір помилок</h2>
        <div class="mt-4 grid gap-3">${review}</div>
      </div>

      <div class="card p-6 cert-card">
        <div class="flex items-start gap-4">
          <span class="icon-tile ${ACCENTS.reward}"><i data-lucide="award"></i></span>
          <div>
            <h2 class="section-title">Електронний сертифікат</h2>
            <p class="text-sm text-muted">Вкажіть свої дані — і отримайте сертифікат з датою, результатом і QR-кодом.</p>
          </div>
        </div>
        <div class="mt-5">${certBlock}</div>
      </div>
    </div>
  </section>`;
}

// =========================================================
//  Екран: сертифікат
// =========================================================
function qrSvg(text) {
  try {
    if (typeof qrcode !== 'function') return '';
    qrcode.stringToBytes = qrcode.stringToBytesFuncs['UTF-8'];
    const qr = qrcode(0, 'M');
    qr.addData(text);
    qr.make();
    return qr.createSvgTag({ cellSize: 4, margin: 0, scalable: true });
  } catch (e) {
    return '';
  }
}

function viewCertificate() {
  const c = state.certificate;
  const qrText = [
    `EduSpace — сертифікат № ${c.number}`,
    `${c.name}, група ${c.group}`,
    `Курс: ${c.title}`,
    `Результат: ${c.percent}% (${MODE_LABELS[c.mode]})`,
    `Дата: ${formatDate(c.date)}`,
  ].join('\n');

  return `
  <section>
    <div class="no-print flex flex-wrap items-center justify-between gap-3 mb-6">
      <button class="btn btn-ghost" data-action="cert-back"><i data-lucide="arrow-left"></i>Назад</button>
      <div class="flex gap-2">
        <button class="btn btn-primary" data-action="print"><i data-lucide="printer"></i>Роздрукувати / Зберегти PDF</button>
      </div>
    </div>

    <div class="cert-scroll">
      <div id="certificate" class="certificate">
        <div class="cert-frame">
          <div class="cert-top">
            <div class="cert-logo"><span class="cert-logo-icon"><i data-lucide="graduation-cap"></i></span>EduSpace</div>
            <div class="cert-number">№ ${esc(c.number)}</div>
          </div>

          <div class="cert-body">
            <p class="cert-kicker">Сертифікат</p>
            <p class="cert-sub">про успішне проходження навчального курсу</p>
            <p class="cert-text">Цим засвідчується, що</p>
            <p class="cert-name">${esc(c.name)}</p>
            <p class="cert-text">${c.role === 'teacher'
              ? `викладач(ка)${c.group ? ` (${esc(c.group)})` : ''}`
              : `студент(ка) групи <b>${esc(c.group)}</b>`} успішно опанував(-ла) курс</p>
            <p class="cert-course">«${esc(c.title)}»</p>

            <div class="cert-stats">
              <div><span>Результат</span><b>${c.percent}%</b></div>
              <div><span>Правильних відповідей</span><b>${c.correct} з ${c.total}</b></div>
              <div><span>Режим</span><b>${MODE_LABELS[c.mode]}</b></div>
            </div>
          </div>

          <div class="cert-bottom">
            <div class="cert-sign">
              <span class="cert-date">${formatDate(c.date)}</span>
              <span class="cert-line"></span>
              <span class="cert-caption">Дата видачі</span>
            </div>
            <div class="cert-seal"><i data-lucide="award"></i><span>${c.percent >= 90 ? 'З відзнакою' : 'Успішно'}</span></div>
            <div class="cert-qr">
              <div class="cert-qr-code">${qrSvg(qrText)}</div>
              <span class="cert-caption">Дані сертифіката</span>
            </div>
          </div>
        </div>
      </div>
    </div>
    <p class="no-print mt-4 text-center text-sm text-muted">Порада: у вікні друку оберіть «Зберегти як PDF» і альбомну орієнтацію.</p>
  </section>`;
}

// =========================================================
//  Екран: мій прогрес
// =========================================================
function chartSvg(history) {
  const items = history.slice(-12);
  if (!items.length) return '';
  const W = 640, H = 220, pad = { l: 36, r: 12, t: 12, b: 28 };
  const iw = W - pad.l - pad.r, ih = H - pad.t - pad.b;
  const slot = iw / 12;
  const bw = Math.min(32, slot * 0.6);
  const y = (p) => pad.t + ih * (1 - p / 100);

  const grid = [0, 50, 100].map((p) => `
    <line x1="${pad.l}" x2="${W - pad.r}" y1="${y(p)}" y2="${y(p)}" class="chart-grid"/>
    <text x="${pad.l - 8}" y="${y(p) + 4}" text-anchor="end" class="chart-label">${p}%</text>`).join('');

  const bars = items.map((a, i) => {
    const x = pad.l + slot * i + (slot - bw) / 2;
    const h = Math.max(3, ih * (a.percent / 100));
    const cls = a.percent >= PASS_PERCENT ? 'chart-bar-pass' : 'chart-bar-fail';
    return `
      <g>
        <title>${esc(a.title)} — ${a.percent}% (${MODE_LABELS[a.mode]}, ${formatDate(a.date, true)})</title>
        <rect x="${x}" y="${y(0) - h}" width="${bw}" height="${h}" rx="6" class="${cls} chart-bar" style="animation-delay:${i * 40}ms"/>
        <text x="${x + bw / 2}" y="${H - 8}" text-anchor="middle" class="chart-label">${formatShortDate(a.date)}</text>
      </g>`;
  }).join('');

  return `
    <svg viewBox="0 0 ${W} ${H}" class="w-full h-auto" role="img" aria-label="Результати останніх спроб">
      ${grid}
      <line x1="${pad.l}" x2="${W - pad.r}" y1="${y(PASS_PERCENT)}" y2="${y(PASS_PERCENT)}" class="chart-pass-line"/>
      <text x="${W - pad.r}" y="${y(PASS_PERCENT) - 6}" text-anchor="end" class="chart-label chart-pass-label">поріг ${PASS_PERCENT}%</text>
      ${bars}
    </svg>`;
}

function viewProgress() {
  const uidCur = state.user.id;
  const history = Store.getHistory(uidCur);
  const unlocked = Store.getBadges(uidCur);
  const certs = Store.getCertificates(uidCur);
  const full = history.filter((a) => !a.review);
  const avg = history.length ? Math.round(history.reduce((s, a) => s + a.percent, 0) / history.length) : 0;
  const bestStreak = history.reduce((m, a) => Math.max(m, a.maxStreak), 0);

  // Статистика по модулях
  const byModule = {};
  full.forEach((a) => {
    (byModule[a.moduleId] ||= { title: a.title, list: [] }).list.push(a.percent);
  });
  const rows = Object.entries(byModule).map(([id, m]) => ({
    id,
    title: findModule(id)?.title || m.title,
    count: m.list.length,
    best: Math.max(...m.list),
    avg: Math.round(m.list.reduce((s, p) => s + p, 0) / m.list.length),
  })).sort((a, b) => b.avg - a.avg);
  const weakest = rows.length > 1 ? rows[rows.length - 1] : null;

  const stat = (icon, accent, value, label) => `
    <div class="card p-5 flex items-center gap-4">
      <span class="icon-tile ${ACCENTS[accent]}"><i data-lucide="${icon}"></i></span>
      <div><p class="text-2xl font-extrabold">${value}</p><p class="text-sm text-muted">${label}</p></div>
    </div>`;

  const badges = BADGES.map((b) => {
    const at = unlocked[b.id];
    return `
      <div class="badge-card ${at ? 'is-unlocked' : ''}" title="${esc(b.desc)}">
        <span class="badge-icon"><i data-lucide="${at ? b.icon : 'lock'}"></i></span>
        <p class="mt-3 font-bold text-sm">${esc(b.title)}</p>
        <p class="mt-1 text-xs text-muted">${esc(b.desc)}</p>
        ${at ? `<p class="mt-2 text-[11px] font-semibold text-reward-ink">Відкрито ${formatShortDate(at)}</p>` : ''}
      </div>`;
  }).join('');

  const empty = (icon, title, text) => `
    <div class="empty-state py-8">
      <span class="icon-tile ${ACCENTS.primary}"><i data-lucide="${icon}"></i></span>
      <p class="mt-3 font-bold">${title}</p>
      <p class="text-sm text-muted">${text}</p>
    </div>`;

  return `
  <section>
    <div class="section-head">
      <div>
        <h1 class="text-2xl sm:text-3xl font-extrabold">Мій прогрес</h1>
        <p class="text-muted">Історія спроб, досягнення та сертифікати</p>
      </div>
      ${history.length || certs.length ? `<button class="btn btn-ghost btn-sm" data-action="reset-progress"><i data-lucide="trash-2"></i>Скинути прогрес</button>` : ''}
    </div>

    <div class="grid grid-cols-2 lg:grid-cols-4 gap-4">
      ${stat('target', 'primary', history.length, plural(history.length, ['спроба', 'спроби', 'спроб']))}
      ${stat('percent', 'success', avg + '%', 'середній результат')}
      ${stat('flame', 'reward', bestStreak, 'найкраща серія')}
      ${stat('award', 'danger', certs.length, plural(certs.length, ['сертифікат', 'сертифікати', 'сертифікатів']))}
    </div>

    <div class="grid lg:grid-cols-[1.5fr_1fr] gap-6 mt-6">
      <div class="card p-6">
        <h2 class="section-title flex items-center gap-2"><i data-lucide="chart-column" class="text-primary"></i>Останні спроби</h2>
        <div class="mt-4">${history.length ? chartSvg(history) : empty('chart-column', 'Поки що порожньо', 'Пройдіть перший тест — і тут з’явиться графік.')}</div>
      </div>
      <div class="card p-6">
        <h2 class="section-title flex items-center gap-2"><i data-lucide="layers" class="text-primary"></i>Результати за модулями</h2>
        ${rows.length ? `
          <div class="mt-4 grid gap-3">
            ${rows.map((r) => `
              <div class="module-row ${weakest && weakest.id === r.id ? 'is-weak' : ''}">
                <div class="flex justify-between gap-3 text-sm">
                  <p class="font-bold truncate">${esc(r.title)}</p>
                  <p class="text-muted whitespace-nowrap">${r.count} ${plural(r.count, ['спроба', 'спроби', 'спроб'])}</p>
                </div>
                <div class="mt-2 progress-track progress-sm"><div class="progress-fill ${r.avg >= PASS_PERCENT ? 'is-success' : ''}" style="width:0%" data-progress="${r.avg}"></div></div>
                <div class="mt-1.5 flex justify-between text-xs text-muted">
                  <span>Середній: <b class="text-ink">${r.avg}%</b> · найкращий: <b class="text-ink">${r.best}%</b></span>
                  ${weakest && weakest.id === r.id ? '<span class="font-bold text-danger-ink">Варто повторити</span>' : ''}
                </div>
              </div>`).join('')}
          </div>` : empty('layers', 'Немає даних', 'Тут буде статистика по кожному модулю.')}
      </div>
    </div>

    <div class="card p-6 mt-6">
      <div class="flex items-center justify-between">
        <h2 class="section-title flex items-center gap-2"><i data-lucide="medal" class="text-reward"></i>Досягнення</h2>
        <span class="badge ${ACCENTS.reward}">${Object.keys(unlocked).length} з ${BADGES.length}</span>
      </div>
      <div class="mt-4 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">${badges}</div>
    </div>

    <div class="grid lg:grid-cols-2 gap-6 mt-6">
      <div class="card p-6">
        <h2 class="section-title flex items-center gap-2"><i data-lucide="award" class="text-reward"></i>Мої сертифікати</h2>
        ${certs.length ? `
          <div class="mt-4 grid gap-2">
            ${certs.slice().reverse().map((c) => `
              <div class="list-row">
                <span class="icon-tile icon-tile-sm ${ACCENTS.reward}"><i data-lucide="award"></i></span>
                <div class="min-w-0 flex-1">
                  <p class="font-bold truncate">${esc(c.title)}</p>
                  <p class="text-xs text-muted">${esc(c.name)} · ${c.percent}% · ${formatDate(c.date)}</p>
                </div>
                <button class="btn btn-soft btn-sm" data-action="open-cert" data-number="${esc(c.number)}">Відкрити</button>
              </div>`).join('')}
          </div>` : empty('award', 'Сертифікатів ще немає', `Наберіть ${PASS_PERCENT}% або більше в будь-якому модулі.`)}
      </div>

      <div class="card p-6">
        <h2 class="section-title flex items-center gap-2"><i data-lucide="history" class="text-primary"></i>Історія спроб</h2>
        ${history.length ? `
          <div class="mt-4 grid gap-2">
            ${history.slice(-8).reverse().map((a) => `
              <div class="list-row">
                <span class="result-dot ${a.percent >= PASS_PERCENT ? 'bg-success-soft text-success-ink' : 'bg-danger-soft text-danger-ink'}">${a.percent}%</span>
                <div class="min-w-0 flex-1">
                  <p class="font-bold truncate">${esc(a.title)}</p>
                  <p class="text-xs text-muted">${MODE_LABELS[a.mode]}${a.review ? ' · помилки' : ''} · ${formatDate(a.date, true)}${a.mode === 'exam' && a.leaves ? ` · <span class="text-danger-ink font-semibold">виходів: ${a.leaves}</span>` : ''}</p>
                </div>
              </div>`).join('')}
          </div>` : empty('history', 'Історія порожня', 'Тут з’являться ваші спроби.')}
      </div>
    </div>
  </section>`;
}

// =========================================================
//  Екран: конструктор тестів
// =========================================================
function blankQuestion() {
  return { text: '', options: ['', '', '', ''], correct: 0, explanation: '' };
}

function freshBuilder() {
  return { title: '', description: '', level: 'easy', category: 'it', questions: [blankQuestion()] };
}

/** Зчитує значення форми конструктора в state.builder */
function syncBuilder() {
  const form = document.getElementById('builder-form');
  if (!form) return;
  const b = state.builder;
  b.title = form.elements.title.value;
  b.description = form.elements.description.value;
  b.level = form.elements.level.value;
  b.category = form.elements.category.value;
  b.questions = b.questions.map((q, qi) => ({
    text: form.querySelector(`[data-q="${qi}"][data-field="text"]`).value,
    options: q.options.map((_, oi) => form.querySelector(`[data-q="${qi}"][data-opt="${oi}"]`).value),
    correct: Number(form.querySelector(`input[name="correct-${qi}"]:checked`)?.value ?? 0),
    explanation: form.querySelector(`[data-q="${qi}"][data-field="explanation"]`).value,
  }));
}

function saveBuilder() {
  syncBuilder();
  const b = state.builder;
  if (!b.title.trim()) return toast('Вкажіть назву тесту.', 'error');

  const questions = [];
  for (let i = 0; i < b.questions.length; i++) {
    const q = b.questions[i];
    const opts = q.options.map((o) => o.trim());
    const filled = opts.map((text, idx) => ({ text, idx })).filter((o) => o.text);
    if (!q.text.trim()) return toast(`Питання ${i + 1}: введіть текст питання.`, 'error');
    if (filled.length < 2) return toast(`Питання ${i + 1}: потрібно щонайменше 2 варіанти відповіді.`, 'error');
    if (!opts[q.correct]) return toast(`Питання ${i + 1}: позначений правильний варіант порожній.`, 'error');
    questions.push({
      text: q.text.trim(),
      options: filled.map((o) => o.text),
      correct: filled.findIndex((o) => o.idx === q.correct),
      explanation: q.explanation.trim(),
    });
  }

  const test = {
    id: uid('custom'),
    title: b.title.trim(),
    description: b.description.trim() || 'Тест, створений викладачем.',
    level: b.level,
    category: b.category,
    icon: 'notebook-pen',
    custom: true,
    ownerId: state.user.id,
    authorName: state.user.name,
    createdAt: new Date().toISOString(),
    questions,
  };

  if (!Store.addTest(test)) return toast('Не вдалося зберегти тест (сховище браузера переповнене).', 'error');
  state.builder = freshBuilder();
  render();
  window.scrollTo({ top: 0, behavior: 'smooth' });
  toast(`Тест «${test.title}» збережено — він уже в каталозі.`, 'success');
  checkBadges();
}

function exportTest(id) {
  const t = Store.getTests().find((x) => x.id === id);
  if (!t) return;
  const data = {
    format: 'eduspace-test',
    version: 1,
    exportedAt: new Date().toISOString(),
    test: { title: t.title, description: t.description, level: t.level, category: t.category, author: t.authorName || '', questions: t.questions },
  };
  downloadFile(`eduspace-${slugify(t.title)}.json`, JSON.stringify(data, null, 2));
  toast('Файл тесту завантажено. Надішліть його студентам.', 'success');
}

/** Перевіряє та нормалізує імпортований тест */
function normalizeImportedTest(data) {
  const t = data && data.format === 'eduspace-test' ? data.test : data;
  if (!t || typeof t.title !== 'string' || !t.title.trim() || !Array.isArray(t.questions) || !t.questions.length) {
    throw new Error('Файл не схожий на тест EduSpace.');
  }
  const questions = t.questions.slice(0, 100).map((q, i) => {
    if (!q || typeof q.text !== 'string' || !Array.isArray(q.options) || q.options.length < 2) {
      throw new Error(`Питання ${i + 1} має неправильний формат.`);
    }
    const options = q.options.slice(0, 6).map((o) => String(o).slice(0, 300));
    const correct = Number(q.correct);
    if (!Number.isInteger(correct) || correct < 0 || correct >= options.length) {
      throw new Error(`Питання ${i + 1}: неправильний номер правильної відповіді.`);
    }
    return {
      text: q.text.slice(0, 500),
      options,
      correct,
      explanation: String(q.explanation || '').slice(0, 800),
    };
  });
  return {
    id: uid('custom'),
    title: t.title.trim().slice(0, 100),
    description: String(t.description || '').slice(0, 300) || 'Імпортований тест.',
    level: LEVELS[t.level] ? t.level : 'easy',
    category: CATEGORIES.some((c) => c.id === t.category) ? t.category : 'other',
    icon: 'file-down',
    custom: true,
    imported: true,
    ownerId: state.user.id,
    authorName: String(t.author || '').slice(0, 60),
    createdAt: new Date().toISOString(),
    questions,
  };
}

function importTestFile(file) {
  if (!file) return;
  if (file.size > 1024 * 1024) return toast('Файл завеликий (максимум 1 МБ).', 'error');
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const test = normalizeImportedTest(JSON.parse(reader.result));
      Store.addTest(test);
      syncBuilder();
      render();
      toast(`Тест «${test.title}» імпортовано (${test.questions.length} ${plural(test.questions.length, ['питання', 'питання', 'питань'])}).`, 'success');
      checkBadges();
    } catch (e) {
      toast(e instanceof SyntaxError ? 'Не вдалося прочитати файл: це не JSON.' : e.message, 'error');
    }
  };
  reader.readAsText(file);
}

function viewBuilder() {
  const b = state.builder;
  const tests = Store.getTests().filter((t) => t.ownerId === state.user.id || !t.ownerId);

  const questionsHtml = b.questions.map((q, qi) => `
    <div class="builder-q">
      <div class="flex items-center justify-between">
        <span class="badge ${ACCENTS.primary}">Питання ${qi + 1}</span>
        ${b.questions.length > 1 ? `<button type="button" class="icon-btn" data-action="builder-remove" data-index="${qi}" title="Видалити питання"><i data-lucide="trash-2"></i></button>` : ''}
      </div>
      <textarea class="input mt-3" rows="2" data-q="${qi}" data-field="text" maxlength="500" placeholder="Текст питання">${esc(q.text)}</textarea>
      <div class="mt-3 grid sm:grid-cols-2 gap-2.5">
        ${q.options.map((opt, oi) => `
          <div class="opt-row">
            <label class="opt-radio" title="Позначити як правильну">
              <input type="radio" name="correct-${qi}" value="${oi}" ${q.correct === oi ? 'checked' : ''}>
              <span>${LETTERS[oi]}</span>
            </label>
            <input class="input input-flat" data-q="${qi}" data-opt="${oi}" maxlength="300" value="${esc(opt)}" placeholder="Варіант ${LETTERS[oi]}${oi > 1 ? ' (необов’язково)' : ''}">
          </div>`).join('')}
      </div>
      <p class="mt-2 text-xs text-muted flex items-center gap-1.5"><i data-lucide="mouse-pointer-click" class="w-3.5 h-3.5"></i>Натисніть на літеру, щоб позначити правильну відповідь</p>
      <input class="input mt-3" data-q="${qi}" data-field="explanation" maxlength="800" value="${esc(q.explanation)}" placeholder="Пояснення «Чому так?» (необов’язково)">
    </div>`).join('');

  return `
  <section>
    <div class="section-head">
      <div>
        <h1 class="text-2xl sm:text-3xl font-extrabold">Конструктор тестів</h1>
        <p class="text-muted">Створюйте власні тести, обирайте категорію та діліться ними з групою через файл</p>
      </div>
    </div>

    <div class="grid lg:grid-cols-[1fr_360px] gap-6 items-start">
      <form id="builder-form" class="card p-6 sm:p-8" novalidate>
        <div class="flex flex-wrap items-center justify-between gap-3">
          <h2 class="section-title flex items-center gap-2"><i data-lucide="pencil-ruler" class="text-primary"></i>Новий тест</h2>
          <button type="button" class="btn btn-ghost btn-sm" data-action="builder-sample"><i data-lucide="wand-sparkles"></i>Заповнити прикладом</button>
        </div>

        <label class="field mt-5"><span>Назва тесту *</span>
          <input class="input" name="title" maxlength="100" value="${esc(b.title)}" placeholder="Напр.: Основи баз даних"></label>
        <div class="mt-4 grid sm:grid-cols-2 gap-4">
          <label class="field"><span>Категорія</span>
            <select class="input" name="category">
              ${CATEGORIES.map((c) => `<option value="${c.id}" ${b.category === c.id ? 'selected' : ''}>${esc(c.title)}</option>`).join('')}
            </select></label>
          <label class="field"><span>Рівень складності</span>
            <select class="input" name="level">
              ${Object.entries(LEVELS).map(([k, l]) => `<option value="${k}" ${b.level === k ? 'selected' : ''}>${l.label}</option>`).join('')}
            </select></label>
        </div>
        <label class="field mt-4"><span>Короткий опис</span>
          <input class="input" name="description" maxlength="300" value="${esc(b.description)}" placeholder="Про що цей тест?"></label>

        <div class="mt-6 grid gap-4">${questionsHtml}</div>

        <button type="button" class="add-q mt-4" data-action="builder-add"><i data-lucide="plus"></i>Додати питання</button>

        <div class="mt-6 pt-6 border-t border-line flex flex-wrap justify-end gap-3">
          <button type="button" class="btn btn-ghost" data-action="builder-clear"><i data-lucide="eraser"></i>Очистити</button>
          <button type="button" class="btn btn-primary" data-action="builder-save"><i data-lucide="save"></i>Зберегти тест</button>
        </div>
      </form>

      <aside class="grid gap-6 lg:sticky lg:top-24">
        <div class="card p-6">
          <h2 class="section-title flex items-center gap-2"><i data-lucide="folder-open" class="text-primary"></i>Мої тести</h2>
          ${tests.length ? `
            <div class="mt-4 grid gap-2">
              ${tests.map((t) => `
                <div class="list-row">
                  <div class="min-w-0 flex-1">
                    <p class="font-bold truncate">${esc(t.title)}</p>
                    <p class="text-xs text-muted">${t.questions.length} ${plural(t.questions.length, ['питання', 'питання', 'питань'])} · ${formatShortDate(t.createdAt)}${t.imported ? ' · імпорт' : ''}</p>
                  </div>
                  <button class="icon-btn" data-action="open-mode" data-id="${esc(t.id)}" title="Пройти"><i data-lucide="play"></i></button>
                  <button class="icon-btn" data-action="export-test" data-id="${esc(t.id)}" title="Експортувати у файл"><i data-lucide="download"></i></button>
                  <button class="icon-btn icon-btn-danger" data-action="delete-test" data-id="${esc(t.id)}" title="Видалити"><i data-lucide="trash-2"></i></button>
                </div>`).join('')}
            </div>` : `<p class="mt-3 text-sm text-muted">Ще немає жодного тесту. Створіть перший або імпортуйте файл.</p>`}
          <button class="btn btn-soft w-full mt-4" data-action="import"><i data-lucide="upload"></i>Імпортувати тест (.json)</button>
          <input type="file" id="import-input" accept=".json,application/json" class="hidden">
        </div>

        <div class="card p-6 tip-card">
          <h2 class="font-bold flex items-center gap-2"><i data-lucide="lightbulb" class="text-reward"></i>Як поділитися тестом</h2>
          <ol class="mt-3 grid gap-2 text-sm text-muted list-decimal pl-5">
            <li>Створіть тест і натисніть <b class="text-ink">«Зберегти»</b>.</li>
            <li>У списку «Мої тести» натисніть <i data-lucide="download" class="inline w-4 h-4"></i> — завантажиться файл.</li>
            <li>Надішліть файл студентам (пошта, Telegram, Classroom).</li>
            <li>Студенти натискають <b class="text-ink">«Імпортувати тест»</b> — і тест з’являється в їхньому каталозі.</li>
          </ol>
        </div>
      </aside>
    </div>
  </section>`;
}

// =========================================================
//  Екран: журнал викладача
// =========================================================
function journalData() {
  const f = state.journal;
  const students = Store.getUsers().filter((u) => u.role === 'student');
  const groups = [...new Set(students.map((u) => u.group).filter(Boolean))].sort();
  const attempts = Store.getAllAttempts()
    .filter((a) => a.userRole === 'student')
    .filter((a) => f.group === 'all' || a.userGroup === f.group)
    .filter((a) => f.course === 'all' || a.moduleId === f.course)
    .sort((a, b) => b.date.localeCompare(a.date));
  return { students, groups, attempts };
}

function exportJournalCsv() {
  const { attempts } = journalData();
  if (!attempts.length) return toast('Немає даних для експорту.', 'error');
  const head = ['Студент', 'Група', 'Курс', 'Режим', 'Результат, %', 'Правильних', 'Усього', 'Бали', 'Виходів зі сторінки', 'Час, с', 'Дата'];
  const cell = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const rows = attempts.map((a) => [
    a.userName, a.userGroup, a.title, MODE_LABELS[a.mode] + (a.review ? ' (помилки)' : ''),
    a.percent, a.correct, a.total, a.score, a.mode === 'exam' ? a.leaves : '', a.seconds, formatDate(a.date, true),
  ].map(cell).join(';'));
  // BOM, щоб Excel правильно відкрив кирилицю
  downloadFile(`eduspace-journal-${new Date().toISOString().slice(0, 10)}.csv`, '﻿' + [head.map(cell).join(';'), ...rows].join('\r\n'), 'text/csv;charset=utf-8');
  toast('Журнал експортовано у CSV — його можна відкрити в Excel.', 'success');
}

function viewJournal() {
  const { students, groups, attempts } = journalData();
  const f = state.journal;
  const full = attempts.filter((a) => !a.review);
  const avg = full.length ? Math.round(full.reduce((s, a) => s + a.percent, 0) / full.length) : 0;
  const passed = full.filter((a) => a.percent >= PASS_PERCENT).length;
  const certs = Store.getAllCertificates().filter((c) => c.role !== 'teacher' &&
    (f.course === 'all' || c.moduleId === f.course) &&
    (f.group === 'all' || students.find((u) => u.id === c.userId)?.group === f.group)).length;
  const courses = getAllModules();

  // Рейтинг студентів
  const visibleStudents = students.filter((u) => f.group === 'all' || u.group === f.group);
  const rating = visibleStudents.map((u) => {
    const list = full.filter((a) => a.userId === u.id);
    return {
      u,
      count: list.length,
      avg: list.length ? Math.round(list.reduce((s, a) => s + a.percent, 0) / list.length) : null,
      best: list.length ? Math.max(...list.map((a) => a.percent)) : null,
      leaves: list.reduce((s, a) => s + (a.mode === 'exam' ? a.leaves : 0), 0),
    };
  }).sort((a, b) => (b.avg ?? -1) - (a.avg ?? -1) || b.count - a.count);

  const stat = (icon, value, label) => `
    <div class="card p-5 flex items-center gap-4">
      <span class="icon-tile icon-tile-accent"><i data-lucide="${icon}"></i></span>
      <div><p class="text-2xl font-extrabold">${value}</p><p class="text-sm text-muted">${label}</p></div>
    </div>`;

  const empty = (icon, title, text) => `
    <div class="empty-state py-10">
      <span class="icon-tile icon-tile-accent"><i data-lucide="${icon}"></i></span>
      <p class="mt-3 font-bold">${title}</p>
      <p class="text-sm text-muted max-w-md">${text}</p>
    </div>`;

  return `
  <section>
    <div class="section-head">
      <div>
        <h1 class="text-2xl sm:text-3xl font-extrabold">Журнал результатів</h1>
        <p class="text-muted">Результати студентів, які проходили тести на цьому пристрої</p>
      </div>
      <button class="btn btn-soft btn-sm" data-action="export-journal"><i data-lucide="sheet"></i>Експорт у Excel (CSV)</button>
    </div>

    <div class="flex flex-wrap gap-3 mb-6">
      <label class="select-wrap"><i data-lucide="users"></i>
        <select class="input" data-journal="group">
          <option value="all">Усі групи</option>
          ${groups.map((g) => `<option value="${esc(g)}" ${f.group === g ? 'selected' : ''}>${esc(g)}</option>`).join('')}
        </select></label>
      <label class="select-wrap"><i data-lucide="library"></i>
        <select class="input" data-journal="course">
          <option value="all">Усі курси</option>
          ${CATEGORIES.map((c) => {
            const items = courses.filter((m) => m.category === c.id);
            return items.length ? `<optgroup label="${esc(c.title)}">${items.map((m) => `<option value="${esc(m.id)}" ${f.course === m.id ? 'selected' : ''}>${esc(m.title)}</option>`).join('')}</optgroup>` : '';
          }).join('')}
        </select></label>
    </div>

    <div class="grid grid-cols-2 lg:grid-cols-4 gap-4">
      ${stat('users', visibleStudents.length, plural(visibleStudents.length, ['студент', 'студенти', 'студентів']))}
      ${stat('target', full.length, plural(full.length, ['спроба', 'спроби', 'спроб']))}
      ${stat('percent', avg + '%', 'середній результат')}
      ${stat('award', `${passed}<span class="text-muted text-base font-bold"> / ${certs}</span>`, 'склали (70%+) / сертифікатів')}
    </div>

    <div class="grid xl:grid-cols-[380px_1fr] gap-6 mt-6 items-start">
      <div class="card p-6">
        <h2 class="section-title flex items-center gap-2"><i data-lucide="trophy" class="text-primary"></i>Рейтинг студентів</h2>
        ${rating.length ? `
          <div class="mt-4 grid gap-2">
            ${rating.map((r, i) => `
              <div class="list-row">
                <span class="rank ${i < 3 && r.avg !== null ? 'is-top' : ''}">${i + 1}</span>
                <span class="avatar avatar-sm">${esc(initials(r.u.name))}</span>
                <div class="min-w-0 flex-1">
                  <p class="font-bold truncate">${esc(r.u.name)}</p>
                  <p class="text-xs text-muted">${esc(r.u.group)} · ${r.count} ${plural(r.count, ['спроба', 'спроби', 'спроб'])}${r.leaves ? ` · <span class="text-danger-ink">виходів: ${r.leaves}</span>` : ''}</p>
                </div>
                <span class="result-dot ${r.avg === null ? 'bg-subtle text-muted' : r.avg >= PASS_PERCENT ? 'bg-primary-soft text-primary' : 'bg-danger-soft text-danger-ink'}">${r.avg === null ? '—' : r.avg + '%'}</span>
              </div>`).join('')}
          </div>` : empty('user-plus', 'Студентів ще немає', 'Коли студенти зареєструються на цьому пристрої, вони з’являться тут.')}
      </div>

      <div class="card p-6 min-w-0">
        <h2 class="section-title flex items-center gap-2"><i data-lucide="clipboard-list" class="text-primary"></i>Усі спроби <span class="text-muted text-sm font-semibold">(${attempts.length})</span></h2>
        ${attempts.length ? `
          <div class="table-wrap mt-4">
            <table class="table">
              <thead><tr><th>Студент</th><th>Курс</th><th>Режим</th><th>Результат</th><th>Виходи</th><th>Дата</th></tr></thead>
              <tbody>
                ${attempts.slice(0, 200).map((a) => `
                  <tr>
                    <td class="whitespace-nowrap"><p class="font-bold">${esc(a.userName)}</p><p class="text-xs text-muted">${esc(a.userGroup)}</p></td>
                    <td class="min-w-[160px]">${esc(a.title)}</td>
                    <td><span class="badge ${a.mode === 'exam' ? 'bg-danger-soft text-danger-ink' : 'bg-subtle text-ink'}">${MODE_LABELS[a.mode]}${a.review ? ' · пом.' : ''}</span></td>
                    <td><b class="${a.percent >= PASS_PERCENT ? 'text-primary' : 'text-danger-ink'}">${a.percent}%</b> <span class="text-xs text-muted">${a.correct}/${a.total}</span></td>
                    <td>${a.mode === 'exam' ? (a.leaves ? `<span class="text-danger-ink font-bold">${a.leaves}</span>` : '<span class="text-muted">0</span>') : '<span class="text-muted">—</span>'}</td>
                    <td class="whitespace-nowrap text-muted">${formatShortDate(a.date)}, ${new Date(a.date).toLocaleTimeString('uk-UA', { hour: '2-digit', minute: '2-digit' })}</td>
                  </tr>`).join('')}
              </tbody>
            </table>
          </div>` : empty('clipboard-list', 'Спроб поки немає', 'Тут з’являться результати студентів: курс, режим, бал, виходи зі сторінки під час іспиту.')}
      </div>
    </div>

    <p class="mt-6 text-xs text-muted flex items-start gap-2 max-w-3xl"><i data-lucide="info" class="w-4 h-4 flex-none mt-0.5"></i>
      Дані зберігаються в браузері цього пристрою. Журнал показує результати студентів, які працювали на ньому (наприклад, у комп’ютерному класі).</p>
  </section>`;
}

// =========================================================
//  Екран: реєстрація та вхід
// =========================================================
function viewAuth() {
  const reg = state.authTab === 'register';
  const teacher = state.authRole === 'teacher';
  const hasUsers = Store.getUsers().length > 0;

  const roleCard = (role, icon, title, text) => `
    <button type="button" class="role-card ${state.authRole === role ? 'is-active' : ''}" data-action="auth-role" data-role="${role}">
      <span class="role-icon"><i data-lucide="${icon}"></i></span>
      <span class="block mt-3 font-extrabold">${title}</span>
      <span class="block mt-0.5 text-xs text-muted">${text}</span>
      <span class="role-check"><i data-lucide="check"></i></span>
    </button>`;

  const form = reg ? `
    <form id="auth-form" data-mode="register" class="grid gap-4" novalidate autocomplete="on">
      <div>
        <p class="field-label">Хто ви?</p>
        <div class="grid grid-cols-2 gap-3 mt-2">
          ${roleCard('student', 'graduation-cap', 'Студент', 'Проходжу курси й тести')}
          ${roleCard('teacher', 'presentation', 'Викладач', 'Створюю тести, бачу журнал')}
        </div>
      </div>
      <label class="field"><span>Прізвище та ім’я</span>
        <input class="input" name="name" autocomplete="name" maxlength="60" placeholder="Коваленко Олена"></label>
      <div class="grid sm:grid-cols-2 gap-4">
        <label class="field"><span>Логін або email</span>
          <input class="input" name="login" autocomplete="username" maxlength="40" placeholder="olena.k" autocapitalize="off" spellcheck="false"></label>
        ${teacher
          ? `<label class="field"><span>Дисципліна / кафедра</span>
               <input class="input" name="subject" maxlength="40" placeholder="Інформатика"></label>`
          : `<label class="field"><span>Навчальна група</span>
               <input class="input" name="group" maxlength="20" placeholder="КН-21" autocapitalize="characters"></label>`}
      </div>
      <div class="grid sm:grid-cols-2 gap-4">
        <label class="field"><span>Пароль</span>
          <input class="input" type="password" name="password" autocomplete="new-password" placeholder="Щонайменше 6 символів"></label>
        <label class="field"><span>Повторіть пароль</span>
          <input class="input" type="password" name="password2" autocomplete="new-password" placeholder="••••••"></label>
      </div>
      <p id="auth-error" class="form-error" hidden></p>
      <button class="btn btn-primary btn-lg w-full mt-1" type="submit" ${state.authBusy ? 'disabled' : ''}>
        <i data-lucide="user-plus"></i>Зареєструватися як ${teacher ? 'викладач' : 'студент'}
      </button>
    </form>` : `
    <form id="auth-form" data-mode="login" class="grid gap-4" novalidate autocomplete="on">
      <label class="field"><span>Логін або email</span>
        <input class="input" name="login" autocomplete="username" maxlength="40" placeholder="olena.k" autocapitalize="off" spellcheck="false"></label>
      <label class="field"><span>Пароль</span>
        <input class="input" type="password" name="password" autocomplete="current-password" placeholder="••••••"></label>
      <p id="auth-error" class="form-error" hidden></p>
      <button class="btn btn-primary btn-lg w-full mt-1" type="submit" ${state.authBusy ? 'disabled' : ''}>
        <i data-lucide="log-in"></i>Увійти
      </button>
    </form>`;

  const feature = (icon, title, text) => `
    <li class="auth-feature"><span class="auth-feature-icon"><i data-lucide="${icon}"></i></span>
      <div><p class="font-bold">${title}</p><p class="text-sm text-muted">${text}</p></div></li>`;

  return `
  <section class="auth-grid">
    <div class="auth-intro">
      <span class="chip"><i data-lucide="sparkles"></i>Платформа навчання та тестування</span>
      <h1 class="mt-6 text-4xl sm:text-6xl font-extrabold leading-[1.02] tracking-tight">
        Вчися.<br>Тренуйся.<br><span class="text-primary">Отримуй результат.</span>
      </h1>
      <p class="mt-5 text-muted max-w-md">EduSpace — інтерактивний тренажер для закладу освіти: ${MODULES.length} курсів у ${new Set(MODULES.map((m) => m.category)).size} категоріях, режими тренування та іспиту, досягнення й сертифікати.</p>
      <ul class="mt-8 grid gap-4 max-w-md">
        ${feature('graduation-cap', 'Для студентів', 'Тренування з поясненнями, іспити на час, серії 🔥 та сертифікати')}
        ${feature('presentation', 'Для викладачів', 'Конструктор тестів, журнал результатів групи та експорт в Excel')}
      </ul>
    </div>

    <div class="card auth-card p-6 sm:p-8">
      <div class="tabs">
        <button class="tab ${reg ? 'is-active' : ''}" data-action="auth-tab" data-tab="register">Реєстрація</button>
        <button class="tab ${!reg ? 'is-active' : ''}" data-action="auth-tab" data-tab="login">Вхід</button>
      </div>
      <h2 class="mt-6 text-2xl font-extrabold">${reg ? 'Створіть акаунт' : 'З поверненням!'}</h2>
      <p class="mt-1 text-sm text-muted">${reg ? 'Оберіть роль і заповніть дані — це займе хвилину.' : 'Введіть логін і пароль, щоб продовжити навчання.'}</p>
      <div class="mt-6">${form}</div>
      <p class="mt-5 text-sm text-muted text-center">
        ${reg
          ? `${hasUsers ? 'Вже маєте акаунт?' : 'Вже реєструвалися?'} <button class="link" data-action="auth-tab" data-tab="login">Увійти</button>`
          : 'Ще не маєте акаунта? <button class="link" data-action="auth-tab" data-tab="register">Зареєструватися</button>'}
      </p>
    </div>
  </section>`;
}

async function submitAuth(form) {
  if (state.authBusy) return;
  const errEl = document.getElementById('auth-error');
  const showError = (res) => {
    errEl.textContent = res.error;
    errEl.hidden = false;
    form.querySelectorAll('.input').forEach((i) => i.classList.remove('is-invalid'));
    if (res.field && form.elements[res.field]) {
      form.elements[res.field].classList.add('is-invalid');
      form.elements[res.field].focus();
    }
  };
  const v = (name) => (form.elements[name] ? form.elements[name].value : '');

  state.authBusy = true;
  const res = form.dataset.mode === 'register'
    ? await Auth.register({ role: state.authRole, name: v('name'), login: v('login'), group: v('group'), subject: v('subject'), password: v('password'), password2: v('password2') })
    : await Auth.login(v('login'), v('password'));
  state.authBusy = false;

  if (res.error) return showError(res);
  state.user = res.user;
  state.view = 'catalog';
  state.category = 'all';
  state.query = '';
  render();
  window.scrollTo({ top: 0 });
  toast(form.dataset.mode === 'register'
    ? 'Акаунт створено — ласкаво просимо до EduSpace!'
    : `Ви увійшли як ${res.user.name}.`, 'success');
}

// =========================================================
//  Модальні вікна
// =========================================================
function modalMode() {
  const m = findModule(state.modal.moduleId);
  if (!m) return '';
  const n = m.questions.length;
  const examTime = formatTime(examSecondsFor(m));
  const feature = (icon, text) => `<li class="flex items-center gap-2"><i data-lucide="${icon}" class="w-4 h-4 flex-none"></i>${text}</li>`;

  return `
    <div class="modal-head">
      <div class="min-w-0">
        <p class="text-sm text-muted">${n} ${plural(n, ['питання', 'питання', 'питань'])} · ${LEVELS[m.level]?.label || ''}</p>
        <h2 class="text-xl sm:text-2xl font-extrabold">${esc(m.title)}</h2>
      </div>
      <button class="icon-btn" data-action="close-modal" aria-label="Закрити"><i data-lucide="x"></i></button>
    </div>
    <p class="mt-2 text-muted">Оберіть режим проходження:</p>

    <div class="mt-5 grid sm:grid-cols-2 gap-4">
      <button class="mode-card mode-training" data-action="start" data-mode="training">
        <span class="icon-tile ${ACCENTS.primary}"><i data-lucide="dumbbell"></i></span>
        <span class="mt-4 block text-lg font-extrabold">Тренування</span>
        <span class="mt-1 block text-sm text-muted">Вчіться без стресу та поспіху</span>
        <ul class="mt-4 grid gap-2 text-sm">
          ${feature('circle-check', 'Миттєва перевірка відповіді')}
          ${feature('lightbulb', 'Пояснення «Чому так?»')}
          ${feature('flame', 'Серія відповідей і бали')}
          ${feature('infinity', 'Без обмеження часу')}
        </ul>
        <span class="mode-cta">Почати тренування <i data-lucide="arrow-right"></i></span>
      </button>

      <button class="mode-card mode-exam" data-action="start" data-mode="exam">
        <span class="icon-tile ${ACCENTS.danger}"><i data-lucide="graduation-cap"></i></span>
        <span class="mt-4 block text-lg font-extrabold">Іспит</span>
        <span class="mt-1 block text-sm text-muted">Перевірте себе в реальних умовах</span>
        <ul class="mt-4 grid gap-2 text-sm">
          ${feature('timer', `Таймер ${examTime}`)}
          ${feature('eye-off', 'Підказки вимкнено')}
          ${feature('flag', 'Результат лише в кінці')}
          ${feature('shield-check', 'Контроль виходу зі сторінки')}
        </ul>
        <span class="mode-cta">Почати іспит <i data-lucide="arrow-right"></i></span>
      </button>
    </div>
    <p class="mt-5 text-xs text-muted flex items-center gap-2"><i data-lucide="shuffle" class="w-4 h-4"></i>Порядок питань і варіантів відповідей змінюється при кожній спробі.</p>`;
}

function modalConfirm() {
  const m = state.modal;
  return `
    <div class="text-center">
      <span class="icon-tile mx-auto ${m.danger ? ACCENTS.danger : ACCENTS.reward}"><i data-lucide="${m.icon || 'circle-alert'}"></i></span>
      <h2 class="mt-4 text-xl font-extrabold">${esc(m.title)}</h2>
      <p class="mt-2 text-muted">${esc(m.text)}</p>
      <div class="mt-6 flex justify-center gap-3">
        <button class="btn btn-ghost" data-action="close-modal">Скасувати</button>
        <button class="btn ${m.danger ? 'btn-danger' : 'btn-primary'}" data-action="confirm-yes">${esc(m.confirmLabel || 'Так')}</button>
      </div>
    </div>`;
}

function modalLeave() {
  const n = state.modal.count;
  return `
    <div class="text-center">
      <span class="icon-tile mx-auto ${ACCENTS.danger}"><i data-lucide="eye-off"></i></span>
      <h2 class="mt-4 text-xl font-extrabold">Ви залишили сторінку іспиту</h2>
      <p class="mt-2 text-muted">Під час іспиту не можна перемикатися на інші вкладки чи програми.
        Кількість виходів фіксується і буде показана в результатах.</p>
      <p class="mt-4 inline-flex items-center gap-2 font-bold text-danger-ink bg-danger-soft rounded-xl px-4 py-2">
        <i data-lucide="triangle-alert" class="w-4 h-4"></i>Зафіксовано виходів: ${n}
      </p>
      <div class="mt-6"><button class="btn btn-primary" data-action="close-modal">Повернутися до іспиту</button></div>
    </div>`;
}

function renderModal() {
  if (!state.modal) {
    $modal.innerHTML = '';
    document.body.classList.remove('modal-open');
    return;
  }
  const content = { mode: modalMode, confirm: modalConfirm, leave: modalLeave }[state.modal.type]();
  const wide = state.modal.type === 'mode';
  $modal.innerHTML = `
    <div class="modal-backdrop" data-backdrop>
      <div class="modal-panel ${wide ? 'max-w-2xl' : 'max-w-md'}" role="dialog" aria-modal="true">${content}</div>
    </div>`;
  document.body.classList.add('modal-open');
}

function openConfirm(opts) {
  state.modal = { type: 'confirm', ...opts };
  renderModal();
  refreshIcons();
}

function closeModal() {
  state.modal = null;
  renderModal();
}

// =========================================================
//  Рендер і навігація
// =========================================================
const VIEWS = {
  auth: viewAuth,
  catalog: viewCatalog,
  quiz: viewQuiz,
  results: viewResults,
  certificate: viewCertificate,
  progress: viewProgress,
  builder: viewBuilder,
  journal: viewJournal,
};

/** Які вкладки бачить кожна роль */
const NAV = {
  student: [
    { view: 'catalog', icon: 'layout-grid', label: 'Курси' },
    { view: 'progress', icon: 'chart-no-axes-combined', label: 'Прогрес' },
  ],
  teacher: [
    { view: 'catalog', icon: 'layout-grid', label: 'Курси' },
    { view: 'journal', icon: 'clipboard-list', label: 'Журнал' },
    { view: 'builder', icon: 'pencil-ruler', label: 'Конструктор' },
  ],
};

/** Шапка: меню залежно від ролі, профіль, вихід */
function renderHeader() {
  const nav = document.getElementById('nav');
  const userArea = document.getElementById('user-area');
  const u = state.user;
  if (!u) {
    nav.innerHTML = '';
    nav.hidden = true;
    userArea.innerHTML = '';
    return;
  }
  const items = NAV[u.role] || NAV.student;
  const active = items.some((i) => i.view === state.view) ? state.view : 'catalog';
  nav.hidden = false;
  nav.innerHTML = items.map((i) => `
    <button class="nav-btn ${i.view === active ? 'is-active' : ''}" data-action="nav" data-view="${i.view}" title="${i.label}">
      <i data-lucide="${i.icon}"></i><span>${i.label}</span>
    </button>`).join('');
  userArea.innerHTML = `
    <div class="user-chip" title="${esc(u.name)} · ${ROLE_LABELS[u.role]}">
      <span class="avatar">${esc(initials(u.name))}</span>
      <span class="hidden lg:block leading-tight text-left">
        <span class="block text-sm font-bold max-w-[160px] truncate">${esc(u.name)}</span>
        <span class="block text-[11px] text-muted">${ROLE_LABELS[u.role]}${u.role === 'student' && u.group ? ` · ${esc(u.group)}` : ''}</span>
      </span>
    </div>
    <button class="icon-btn icon-btn-lg" data-action="logout" title="Вийти з акаунта"><i data-lucide="log-out"></i></button>`;
}

function render() {
  const key = state.view + (state.view === 'quiz' && state.quiz ? `-${state.quiz.index}` : '');
  const animate = key !== lastRenderKey;
  lastRenderKey = key;

  $app.innerHTML = `<div class="${animate ? 'view-enter' : ''}">${VIEWS[state.view]()}</div>`;
  renderHeader();
  renderModal();
  refreshIcons();

  // Плавна анімація шкал прогресу та кільця результату
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      document.querySelectorAll('[data-progress]').forEach((el) => { el.style.width = el.dataset.progress + '%'; });
      document.querySelectorAll('[data-ring]').forEach((el) => { el.style.strokeDashoffset = el.dataset.ring; });
    });
  });
  if (state.view === 'quiz' && state.quiz) prevProgress = Math.round((state.quiz.answers.length / state.quiz.questions.length) * 100);
}

function navigate(view) {
  if (!state.user) view = 'auth';
  // захист: конструктор і журнал — лише для викладача, прогрес — для студента
  if ((view === 'builder' || view === 'journal') && !isTeacher()) view = 'catalog';
  if (view === 'progress' && isTeacher()) view = 'catalog';
  if (state.view === 'builder') syncBuilder();
  const leaving = () => {
    stopTimer();
    if (state.view === 'quiz') state.quiz = null;
    state.modal = null;
    state.view = view;
    render();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };
  if (state.view === 'quiz' && state.quiz && !state.quiz.finished) {
    openConfirm({
      title: 'Перервати тест?',
      text: 'Відповіді цієї спроби не буде збережено.',
      confirmLabel: 'Так, вийти',
      icon: 'log-out',
      danger: true,
      onConfirm: leaving,
    });
    return;
  }
  leaving();
}

// =========================================================
//  Обробка подій
// =========================================================
const ACTIONS = {
  nav: (el) => navigate(el.dataset.view),
  'open-mode': (el) => {
    if (state.view === 'builder') syncBuilder();
    state.modal = { type: 'mode', moduleId: el.dataset.id };
    renderModal();
    refreshIcons();
  },
  'close-modal': closeModal,
  'confirm-yes': () => {
    const fn = state.modal && state.modal.onConfirm;
    closeModal();
    if (fn) fn();
  },
  start: (el) => startQuiz(state.modal.moduleId, el.dataset.mode),
  answer: (el) => selectAnswer(Number(el.dataset.index)),
  next: nextQuestion,
  quit: () => navigate('catalog'),
  retry: () => startQuiz(state.result.moduleId, state.result.mode),
  'review-mistakes': () => {
    const r = state.result;
    // повертаємо оригінальні питання з помилками (без прив'язки до старого перемішування)
    const wrongQuestions = r.answers.filter((a) => !a.correct).map((a) => a.question);
    startQuiz(r.moduleId, 'training', { review: true, questions: wrongQuestions });
  },
  print: () => window.print(),
  'cert-back': () => {
    state.view = state.result && state.certificate.fromResult ? 'results' : 'progress';
    render();
  },
  'open-cert': (el) => {
    const c = Store.getCertificates(state.user.id).find((x) => x.number === el.dataset.number);
    if (!c) return;
    state.certificate = { ...c, fromResult: false };
    state.view = 'certificate';
    render();
    window.scrollTo({ top: 0 });
  },
  'reset-progress': () => openConfirm({
    title: 'Скинути весь прогрес?',
    text: 'Буде видалено історію спроб, досягнення та сертифікати. Тести викладачів залишаться.',
    confirmLabel: 'Скинути',
    icon: 'trash-2',
    danger: true,
    onConfirm: () => { Store.resetProgress(state.user.id); render(); toast('Прогрес скинуто.', 'info'); },
  }),
  'builder-add': () => {
    syncBuilder();
    state.builder.questions.push(blankQuestion());
    render();
    const all = document.querySelectorAll('.builder-q');
    const last = all[all.length - 1];
    if (last) {
      last.scrollIntoView({ behavior: 'smooth', block: 'center' });
      last.querySelector('textarea')?.focus({ preventScroll: true });
    }
  },
  'builder-remove': (el) => {
    syncBuilder();
    state.builder.questions.splice(Number(el.dataset.index), 1);
    render();
  },
  'builder-sample': () => {
    state.builder = JSON.parse(JSON.stringify(SAMPLE_TEST));
    state.builder.questions.forEach((q) => { while (q.options.length < 4) q.options.push(''); });
    render();
    toast('Форму заповнено прикладом — перевірте та збережіть.', 'info');
  },
  'builder-clear': () => openConfirm({
    title: 'Очистити форму?',
    text: 'Усі незбережені питання буде видалено.',
    confirmLabel: 'Очистити',
    icon: 'eraser',
    danger: true,
    onConfirm: () => { state.builder = freshBuilder(); render(); },
  }),
  'builder-save': saveBuilder,
  'export-test': (el) => exportTest(el.dataset.id),
  'delete-test': (el) => {
    const t = Store.getTests().find((x) => x.id === el.dataset.id);
    if (!t) return;
    syncBuilder();
    openConfirm({
      title: 'Видалити тест?',
      text: `Тест «${t.title}» буде видалено з цього пристрою.`,
      confirmLabel: 'Видалити',
      icon: 'trash-2',
      danger: true,
      onConfirm: () => { Store.deleteTest(t.id); render(); toast('Тест видалено.', 'info'); },
    });
  },
  import: () => document.getElementById('import-input')?.click(),
  'set-category': (el) => {
    state.category = el.dataset.id;
    if (state.view !== 'catalog') { navigate('catalog'); return; }
    refreshCatalogGrid();
    document.getElementById('category-chips')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  },
  'export-journal': exportJournalCsv,
  'auth-tab': (el) => {
    state.authTab = el.dataset.tab;
    render();
  },
  'auth-role': (el) => {
    // зберігаємо вже введені дані при перемиканні ролі
    const form = document.getElementById('auth-form');
    const saved = form ? Object.fromEntries(['name', 'login', 'password', 'password2'].map((n) => [n, form.elements[n]?.value || ''])) : {};
    state.authRole = el.dataset.role;
    render();
    const f2 = document.getElementById('auth-form');
    if (f2) Object.entries(saved).forEach(([n, v]) => { if (f2.elements[n]) f2.elements[n].value = v; });
  },
  logout: () => {
    const doLogout = () => {
      stopTimer();
      Auth.logout();
      state.user = null;
      state.quiz = null;
      state.result = null;
      state.certificate = null;
      state.builder = freshBuilder();
      state.modal = null;
      state.authTab = 'login';
      state.view = 'auth';
      render();
      window.scrollTo({ top: 0 });
    };
    const inQuiz = state.view === 'quiz' && state.quiz && !state.quiz.finished;
    openConfirm({
      title: 'Вийти з акаунта?',
      text: inQuiz ? 'Поточний тест буде перервано, відповіді не збережуться.' : 'Ви зможете увійти знову за логіном і паролем.',
      confirmLabel: 'Вийти',
      icon: 'log-out',
      danger: inQuiz,
      onConfirm: doLogout,
    });
  },
};

document.addEventListener('click', (e) => {
  // клік по затемненому фону закриває модальне вікно
  if (e.target.matches('[data-backdrop]')) {
    closeModal();
    return;
  }
  const el = e.target.closest('[data-action]');
  if (!el || el.disabled) return;
  const handler = ACTIONS[el.dataset.action];
  if (handler) {
    e.preventDefault();
    handler(el);
  }
});

document.addEventListener('submit', (e) => {
  if (e.target.id === 'auth-form') {
    e.preventDefault();
    submitAuth(e.target);
    return;
  }
  if (e.target.id !== 'cert-form') return;
  e.preventDefault();
  const r = state.result;
  if (!r || !r.passed || r.review) return;
  const name = e.target.elements.name.value.trim().replace(/\s+/g, ' ');
  const groupRaw = e.target.elements.group.value.trim();
  const group = isTeacher() ? groupRaw : groupRaw.toUpperCase();
  if (name.length < 3) return toast('Введіть прізвище та ім’я.', 'error');
  if (!group && !isTeacher()) return toast('Введіть навчальну групу.', 'error');

  const d = new Date();
  const number = `ES-${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}-${String(Math.floor(1000 + Math.random() * 9000))}`;
  const cert = {
    number,
    userId: state.user.id,
    role: state.user.role,
    name,
    group,
    title: r.title,
    moduleId: r.moduleId,
    percent: r.percent,
    correct: r.correctCount,
    total: r.total,
    mode: r.mode,
    date: d.toISOString(),
  };
  Store.addCertificate(cert);
  state.certificate = { ...cert, fromResult: true };
  state.view = 'certificate';
  render();
  window.scrollTo({ top: 0, behavior: 'smooth' });
  celebrate();
  checkBadges();
});

document.addEventListener('input', (e) => {
  if (e.target.id === 'catalog-search') {
    state.query = e.target.value;
    refreshCatalogGrid();
  }
  if (e.target.closest && e.target.closest('#auth-form')) {
    e.target.classList.remove('is-invalid');
  }
});

document.addEventListener('change', (e) => {
  if (e.target.dataset && e.target.dataset.journal) {
    state.journal[e.target.dataset.journal] = e.target.value;
    render();
    return;
  }
  if (e.target.id === 'import-input') {
    importTestFile(e.target.files[0]);
    e.target.value = '';
  }
});

// Клавіатура: 1–6 — вибір відповіді, Enter — далі, Esc — закрити вікно
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && state.modal) {
    closeModal();
    return;
  }
  if (state.view !== 'quiz' || !state.quiz || state.modal) return;
  if (['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName)) return;
  const n = parseInt(e.key, 10);
  if (n >= 1 && n <= 6) {
    selectAnswer(n - 1);
  } else if (e.key === 'Enter') {
    e.preventDefault();
    nextQuestion();
  }
});

// Контроль чесності
document.addEventListener('visibilitychange', () => { if (document.hidden) registerLeave(); });
window.addEventListener('blur', registerLeave);

// =========================================================
//  Тема та запуск
// =========================================================
function init() {
  state.user = Store.getCurrentUser();
  if (state.user) {
    state.view = 'catalog';
  } else {
    state.view = 'auth';
    state.authTab = Store.getUsers().length ? 'login' : 'register';
  }
  render();
}

init();
