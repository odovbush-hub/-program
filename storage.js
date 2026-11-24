/* =========================================================
   EduSpace — робота з localStorage
   Усі дані зберігаються в браузері. Спроби, досягнення та
   сертифікати прив'язані до конкретного користувача.
   ========================================================= */

const Store = (() => {
  const KEYS = {
    users: 'eduspace_users',            // зареєстровані користувачі
    session: 'eduspace_session',        // хто зараз увійшов
    tests: 'eduspace_custom_tests',     // тести викладачів (спільні для пристрою)
    attempts: 'eduspace_attempts',      // усі спроби (з userId)
    badges: 'eduspace_user_badges',     // { userId: { badgeId: дата } }
    certificates: 'eduspace_certs',     // видані сертифікати (з userId)
  };

  function read(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (e) {
      return fallback;
    }
  }

  function write(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch (e) {
      return false;
    }
  }

  return {
    // --- Користувачі ---
    getUsers: () => read(KEYS.users, []),
    findUserByLogin(login) {
      const l = String(login).trim().toLowerCase();
      return read(KEYS.users, []).find((u) => u.login === l) || null;
    },
    getUser: (id) => read(KEYS.users, []).find((u) => u.id === id) || null,
    addUser(user) {
      const list = read(KEYS.users, []);
      list.push(user);
      return write(KEYS.users, list);
    },

    // --- Сесія ---
    getCurrentUser() {
      const s = read(KEYS.session, null);
      return s ? this.getUser(s.userId) : null;
    },
    setSession: (userId) => write(KEYS.session, { userId, since: new Date().toISOString() }),
    clearSession: () => localStorage.removeItem(KEYS.session),

    // --- Тести викладачів ---
    getTests: () => read(KEYS.tests, []).map((t) => ({ category: 'other', ...t })),
    addTest(test) {
      const list = read(KEYS.tests, []);
      list.push(test);
      return write(KEYS.tests, list);
    },
    deleteTest(id) {
      return write(KEYS.tests, read(KEYS.tests, []).filter((t) => t.id !== id));
    },

    // --- Спроби ---
    getAllAttempts: () => read(KEYS.attempts, []),
    getHistory: (userId) => read(KEYS.attempts, []).filter((a) => a.userId === userId),
    addAttempt(attempt) {
      const list = read(KEYS.attempts, []);
      list.push(attempt);
      return write(KEYS.attempts, list.slice(-2000));
    },

    // --- Досягнення ---
    getBadges: (userId) => read(KEYS.badges, {})[userId] || {},
    saveBadges(userId, obj) {
      const all = read(KEYS.badges, {});
      all[userId] = obj;
      return write(KEYS.badges, all);
    },

    // --- Сертифікати ---
    getAllCertificates: () => read(KEYS.certificates, []),
    getCertificates: (userId) => read(KEYS.certificates, []).filter((c) => c.userId === userId),
    addCertificate(cert) {
      const list = read(KEYS.certificates, []);
      list.push(cert);
      return write(KEYS.certificates, list);
    },

    // --- Скидання прогресу конкретного користувача ---
    resetProgress(userId) {
      write(KEYS.attempts, read(KEYS.attempts, []).filter((a) => a.userId !== userId));
      write(KEYS.certificates, read(KEYS.certificates, []).filter((c) => c.userId !== userId));
      const b = read(KEYS.badges, {});
      delete b[userId];
      write(KEYS.badges, b);
    },
  };
})();
