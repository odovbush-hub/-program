/* =========================================================
   EduSpace — досягнення (бейджі)
   check(history, ctx) повертає true, якщо бейдж заслужено.
   ========================================================= */

const BADGES = [
  {
    id: 'first-step',
    icon: 'footprints',
    title: 'Перший крок',
    desc: 'Завершіть свій перший тест',
    check: (h) => h.length >= 1,
  },
  {
    id: 'on-fire',
    icon: 'flame',
    title: 'У вогні',
    desc: 'Дайте 5 правильних відповідей поспіль',
    check: (h) => h.some((a) => a.maxStreak >= 5),
  },
  {
    id: 'perfect',
    icon: 'crown',
    title: 'Відмінник',
    desc: 'Складіть іспит на 100%',
    check: (h) => h.some((a) => a.mode === 'exam' && a.percent === 100),
  },
  {
    id: 'fast-mind',
    icon: 'zap',
    title: 'Швидкий розум',
    desc: 'Складіть іспит на 70%+ менш ніж за хвилину',
    check: (h) => h.some((a) => a.mode === 'exam' && a.percent >= 70 && a.seconds < 60),
  },
  {
    id: 'fair-play',
    icon: 'shield-check',
    title: 'Чесна гра',
    desc: 'Складіть іспит на 70%+ без жодного виходу зі сторінки',
    check: (h) => h.some((a) => a.mode === 'exam' && a.percent >= 70 && a.leaves === 0),
  },
  {
    id: 'erudite',
    icon: 'brain',
    title: 'Ерудит',
    desc: 'Пройдіть курси з 3 різних категорій з результатом від 70%',
    check: (h) => new Set(h.filter((a) => !a.review && a.percent >= 70 && a.category).map((a) => a.category)).size >= 3,
  },
  {
    id: 'fixer',
    icon: 'wrench',
    title: 'Над помилками',
    desc: 'Завершіть режим «Робота над помилками»',
    check: (h) => h.some((a) => a.review),
  },
  {
    id: 'graduate',
    icon: 'award',
    title: 'Випускник',
    desc: 'Отримайте свій перший сертифікат',
    check: (h, ctx) => ctx.certificates > 0,
  },
  {
    id: 'author',
    icon: 'pencil-ruler',
    title: 'Автор',
    desc: 'Створіть або імпортуйте власний тест',
    check: (h, ctx) => ctx.customTests > 0,
  },
];

/**
 * Перевіряє всі бейджі, зберігає нові та показує сповіщення.
 * Повертає масив щойно відкритих бейджів.
 */
function checkBadges() {
  const user = Store.getCurrentUser();
  if (!user) return [];
  const history = Store.getHistory(user.id);
  const ctx = {
    certificates: Store.getCertificates(user.id).length,
    customTests: Store.getTests().filter((t) => t.ownerId === user.id).length,
  };
  const unlocked = Store.getBadges(user.id);
  const fresh = [];

  BADGES.forEach((badge) => {
    if (!unlocked[badge.id] && badge.check(history, ctx)) {
      unlocked[badge.id] = new Date().toISOString();
      fresh.push(badge);
    }
  });

  if (fresh.length) {
    Store.saveBadges(user.id, unlocked);
    fresh.forEach((b, i) => {
      setTimeout(() => toast(b.title, 'badge', 'Нове досягнення!'), 600 + i * 700);
    });
  }
  return fresh;
}
