/* =========================================================
   EduSpace — допоміжні функції
   ========================================================= */

/** Екранування тексту перед вставкою в HTML (захист від XSS у власних тестах) */
function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

/** Українські форми множини: plural(5, ['питання', 'питання', 'питань']) */
function plural(n, forms) {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return forms[0];
  if (m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20)) return forms[1];
  return forms[2];
}

/** 125 → "02:05" */
function formatTime(totalSeconds) {
  const s = Math.max(0, totalSeconds);
  const m = Math.floor(s / 60);
  return `${String(m).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

/** Тривалість словами: 75 → "1 хв 15 с" */
function formatDuration(seconds) {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return m ? `${m} хв ${s} с` : `${s} с`;
}

/** Дата у форматі «22 листопада 2026 р.» */
function formatDate(iso, withTime = false) {
  const d = new Date(iso);
  const opts = { day: 'numeric', month: 'long', year: 'numeric' };
  if (withTime) Object.assign(opts, { hour: '2-digit', minute: '2-digit' });
  return d.toLocaleDateString('uk-UA', opts);
}

/** Коротка дата: 22.11 */
function formatShortDate(iso) {
  return new Date(iso).toLocaleDateString('uk-UA', { day: '2-digit', month: '2-digit' });
}

/** Перемішування масиву (алгоритм Фішера — Єйтса), повертає новий масив */
function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Унікальний ідентифікатор */
function uid(prefix = 'id') {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

/** Перетворює всі <i data-lucide="..."> на SVG-іконки */
function refreshIcons() {
  if (window.lucide) window.lucide.createIcons({ icons: window.lucide.icons });
}

/** Спливаюче повідомлення */
function toast(message, type = 'info', title = '') {
  const root = document.getElementById('toast-root');
  if (!root) return;
  const icons = { success: 'circle-check', error: 'circle-alert', info: 'info', badge: 'medal' };
  const el = document.createElement('div');
  el.className = `toast toast-${type}`;
  el.setAttribute('role', 'status');
  el.innerHTML = `
    <span class="toast-icon"><i data-lucide="${icons[type] || 'info'}"></i></span>
    <div class="min-w-0">
      ${title ? `<p class="font-bold">${esc(title)}</p>` : ''}
      <p class="${title ? 'text-sm opacity-80' : ''}">${esc(message)}</p>
    </div>`;
  root.appendChild(el);
  refreshIcons();
  setTimeout(() => {
    el.classList.add('toast-out');
    setTimeout(() => el.remove(), 300);
  }, type === 'badge' ? 4500 : 3200);
}

/** Конфеті при успішному проходженні */
function celebrate() {
  if (typeof window.confetti !== 'function') return;
  if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const colors = ['#e4ff3c', '#ffffff', '#ff3366', '#f4ffb0', '#888888'];
  const end = Date.now() + 900;
  (function frame() {
    window.confetti({ particleCount: 4, angle: 60, spread: 60, origin: { x: 0, y: 0.7 }, colors });
    window.confetti({ particleCount: 4, angle: 120, spread: 60, origin: { x: 1, y: 0.7 }, colors });
    if (Date.now() < end) requestAnimationFrame(frame);
  })();
}

/** Завантаження текстового файлу (експорт тесту) */
function downloadFile(filename, content, type = 'application/json') {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Перетворення назви на безпечне ім'я файлу */
function slugify(text) {
  const map = { а:'a',б:'b',в:'v',г:'h',ґ:'g',д:'d',е:'e',є:'ie',ж:'zh',з:'z',и:'y',і:'i',ї:'i',й:'i',к:'k',л:'l',м:'m',н:'n',о:'o',п:'p',р:'r',с:'s',т:'t',у:'u',ф:'f',х:'kh',ц:'ts',ч:'ch',ш:'sh',щ:'shch',ь:'',ю:'iu',я:'ia' };
  return String(text).toLowerCase().split('').map((c) => map[c] ?? c).join('')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'test';
}
