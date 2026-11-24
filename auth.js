/* =========================================================
   EduSpace — реєстрація та вхід
   Пароль не зберігається у відкритому вигляді: зберігається
   хеш SHA-256 від «сіль + пароль».
   ========================================================= */

const Auth = (() => {
  function toHex(buffer) {
    return Array.from(new Uint8Array(buffer)).map((b) => b.toString(16).padStart(2, '0')).join('');
  }

  /** Запасний хеш, якщо браузер не підтримує crypto.subtle */
  function fallbackHash(str) {
    let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
    for (let i = 0; i < str.length; i++) {
      const ch = str.charCodeAt(i);
      h1 = Math.imul(h1 ^ ch, 2654435761);
      h2 = Math.imul(h2 ^ ch, 1597334677);
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return 'f' + (h2 >>> 0).toString(16).padStart(8, '0') + (h1 >>> 0).toString(16).padStart(8, '0');
  }

  async function hashPassword(password, salt) {
    const text = `${salt}:${password}`;
    if (window.crypto && window.crypto.subtle) {
      try {
        const buf = await window.crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
        return toHex(buf);
      } catch (e) { /* див. нижче */ }
    }
    return fallbackHash(text);
  }

  function makeSalt() {
    const arr = new Uint8Array(16);
    if (window.crypto && window.crypto.getRandomValues) window.crypto.getRandomValues(arr);
    else arr.forEach((_, i) => { arr[i] = Math.floor(Math.random() * 256); });
    return toHex(arr);
  }

  /**
   * Реєстрація. Повертає { user } або { error }.
   * data: { role, name, login, group, subject, password, password2 }
   */
  async function register(data) {
    const name = String(data.name || '').trim().replace(/\s+/g, ' ');
    const login = String(data.login || '').trim().toLowerCase();
    const group = String(data.group || '').trim().toUpperCase();
    const subject = String(data.subject || '').trim();
    const role = data.role === 'teacher' ? 'teacher' : 'student';

    if (name.split(' ').length < 2) return { error: 'Вкажіть прізвище та ім’я через пробіл.', field: 'name' };
    if (!/^[a-z0-9._@-]{3,40}$/.test(login)) return { error: 'Логін: 3–40 символів, латиниця, цифри, крапка, @, дефіс.', field: 'login' };
    if (role === 'student' && !group) return { error: 'Вкажіть свою навчальну групу.', field: 'group' };
    if (String(data.password || '').length < 6) return { error: 'Пароль має містити щонайменше 6 символів.', field: 'password' };
    if (data.password !== data.password2) return { error: 'Паролі не збігаються.', field: 'password2' };
    if (Store.findUserByLogin(login)) return { error: 'Користувач з таким логіном уже існує. Увійдіть або оберіть інший логін.', field: 'login' };

    const salt = makeSalt();
    const user = {
      id: uid('user'),
      role,
      name,
      login,
      group: role === 'student' ? group : '',
      subject: role === 'teacher' ? subject : '',
      salt,
      passHash: await hashPassword(data.password, salt),
      createdAt: new Date().toISOString(),
    };
    if (!Store.addUser(user)) return { error: 'Не вдалося зберегти дані (сховище браузера недоступне).' };
    Store.setSession(user.id);
    return { user };
  }

  /** Вхід. Повертає { user } або { error } */
  async function login(loginValue, password) {
    const user = Store.findUserByLogin(loginValue || '');
    if (!user) return { error: 'Користувача з таким логіном не знайдено.', field: 'login' };
    const hash = await hashPassword(password || '', user.salt);
    if (hash !== user.passHash) return { error: 'Неправильний пароль.', field: 'password' };
    Store.setSession(user.id);
    return { user };
  }

  function logout() {
    Store.clearSession();
  }

  return { register, login, logout };
})();
