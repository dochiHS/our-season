(function (global) {
  'use strict';

  const AUTH_STORAGE_KEY = 'our-season-user-auth';
  let client = null;
  let authModal = null;
  let pendingLogin = null;
  let busy = false;
  let statusNode = null;

  const sdk = global.supabase;

  function notifyAuthChange(event, session) {
    const detail = { event, session: session || null, user: session && session.user || null };
    let authEvent;
    if (typeof global.CustomEvent === 'function') authEvent = new CustomEvent('authchange', { detail });
    else {
      authEvent = document.createEvent('CustomEvent');
      authEvent.initCustomEvent('authchange', false, false, detail);
    }
    global.dispatchEvent(authEvent);
  }

  function getClient() {
    if (client) return client;
    const config = global.SUPABASE_CONFIG;
    if (!config || !config.SUPABASE_URL || !config.SUPABASE_ANON_KEY || !sdk || typeof sdk.createClient !== 'function') return null;
    client = sdk.createClient(config.SUPABASE_URL, config.SUPABASE_ANON_KEY, {
      auth: { storageKey: AUTH_STORAGE_KEY, persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
    });
    if (client.auth && typeof client.auth.onAuthStateChange === 'function') {
      client.auth.onAuthStateChange((event, session) => notifyAuthChange(event, session));
    }
    return client;
  }

  async function getUser() {
    const db = getClient();
    if (!db || !db.auth || typeof db.auth.getUser !== 'function') return null;
    try {
      const result = await db.auth.getUser();
      return result && !result.error && result.data ? result.data.user || null : null;
    } catch (error) {
      return null;
    }
  }

  function setStatus(message, isError) {
    if (!statusNode) return;
    statusNode.textContent = message || '';
    statusNode.hidden = !message;
    statusNode.classList.toggle('is-error', Boolean(isError));
  }

  function closeModal(user) {
    if (authModal) authModal.classList.remove('open');
    const resolve = pendingLogin;
    pendingLogin = null;
    if (!resolve) return;
    let done = false;
    const finish = () => { if (done) return; done = true; global.removeEventListener('popstate', finish); resolve(user || null); };
    global.addEventListener('popstate', finish);
    global.setTimeout(finish, 400);
  }

  function makeModal() {
    if (authModal) return authModal;
    authModal = document.createElement('div');
    authModal.id = 'auth-modal';
    authModal.className = 'modal-overlay auth-modal';
    authModal.setAttribute('role', 'dialog');
    authModal.setAttribute('aria-modal', 'true');
    authModal.setAttribute('aria-labelledby', 'auth-title');
    authModal.innerHTML = `
      <div class="modal-sheet auth-sheet">
        <div class="sheet-header auth-sheet-header">
          <h2 id="auth-title" class="sheet-title">로그인</h2>
          <button class="btn-close-modal auth-close" type="button" aria-label="닫기">×</button>
        </div>
        <p class="auth-intro">사진을 올리려면 로그인이 필요해요. 사진 보기는 로그인 없이 할 수 있어요.</p>
        <div class="auth-tabs" role="tablist" aria-label="로그인 방법">
          <button class="auth-tab is-active" type="button" role="tab" aria-selected="true" data-auth-mode="login">로그인</button>
          <button class="auth-tab" type="button" role="tab" aria-selected="false" data-auth-mode="signup">가입하기</button>
        </div>
        <form class="auth-form" novalidate>
          <label class="auth-field-label" for="auth-email">이메일</label>
          <input class="auth-input" id="auth-email" name="email" type="email" autocomplete="email" required placeholder="이메일 주소">
          <label class="auth-field-label" for="auth-password">비밀번호</label>
          <input class="auth-input" id="auth-password" name="password" type="password" autocomplete="current-password" required minlength="6" placeholder="6자 이상">
          <div class="auth-confirm-group" hidden>
            <label class="auth-field-label" for="auth-password-confirm">비밀번호 확인</label>
            <input class="auth-input" id="auth-password-confirm" name="password-confirm" type="password" autocomplete="new-password" minlength="6" placeholder="비밀번호를 다시 입력해 주세요">
          </div>
          <p class="auth-status" role="status" aria-live="polite" hidden></p>
          <button class="btn-submit-upload auth-submit" type="submit">로그인</button>
        </form>
      </div>`;
    document.body.appendChild(authModal);
    statusNode = authModal.querySelector('.auth-status');
    const form = authModal.querySelector('.auth-form');
    const tabs = Array.from(authModal.querySelectorAll('[data-auth-mode]'));
    const confirmGroup = authModal.querySelector('.auth-confirm-group');
    const confirmInput = authModal.querySelector('#auth-password-confirm');
    const passwordInput = authModal.querySelector('#auth-password');
    const submitButton = authModal.querySelector('.auth-submit');
    let mode = 'login';

    function setMode(nextMode) {
      mode = nextMode;
      const signup = mode === 'signup';
      authModal.querySelector('#auth-title').textContent = signup ? '가입하기' : '로그인';
      submitButton.textContent = signup ? '가입하기' : '로그인';
      passwordInput.autocomplete = signup ? 'new-password' : 'current-password';
      confirmGroup.hidden = !signup;
      confirmInput.required = signup;
      tabs.forEach(tab => {
        const active = tab.dataset.authMode === mode;
        tab.classList.toggle('is-active', active);
        tab.setAttribute('aria-selected', String(active));
      });
      setStatus('', false);
    }

    tabs.forEach(tab => tab.addEventListener('click', () => setMode(tab.dataset.authMode)));
    authModal.querySelector('.auth-close').addEventListener('click', () => closeModal(null));
    authModal.addEventListener('click', event => { if (event.target === authModal) closeModal(null); });
    form.addEventListener('submit', async event => {
      event.preventDefault();
      if (busy) return;
      const email = authModal.querySelector('#auth-email').value.trim();
      const password = passwordInput.value;
      if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        setStatus('이메일 주소를 확인해 주세요.', true); return;
      }
      if (password.length < 6) { setStatus('비밀번호는 6자 이상이어야 해요.', true); return; }
      if (mode === 'signup' && password !== confirmInput.value) {
        setStatus('비밀번호가 서로 달라요.', true); return;
      }
      const db = getClient();
      if (!db || !db.auth) { setStatus('로그인 기능을 불러오지 못했어요. 잠시 후 다시 시도해 주세요.', true); return; }
      busy = true; submitButton.disabled = true; setStatus('', false);
      try {
        const result = mode === 'signup'
          ? await db.auth.signUp({ email, password })
          : await db.auth.signInWithPassword({ email, password });
        if (result.error) throw result.error;
        if (mode === 'signup' && !(result.data && result.data.session)) {
          setStatus('메일함에서 확인 링크를 눌러 주세요', false);
          return;
        }
        const user = result.data && (result.data.user || result.data.session && result.data.session.user);
        if (user) closeModal(user);
        else setStatus('로그인하지 못했어요. 잠시 후 다시 시도해 주세요.', true);
      } catch (error) {
        const message = String(error && error.message || '');
        if ((error && Number(error.status) === 429) || /rate limit|too many|429/i.test(message)) {
          setStatus('잠시 후 다시 시도해 주세요.', true);
        } else if (/invalid login credentials/i.test(message)) {
          setStatus('이메일이나 비밀번호가 맞지 않아요.', true);
        } else if (/user already registered/i.test(message)) {
          setStatus('이미 가입된 이메일이에요. 로그인 탭에서 들어와 주세요.', true);
        } else {
          setStatus('로그인하지 못했어요. 잠시 후 다시 시도해 주세요.', true);
        }
      } finally {
        busy = false; submitButton.disabled = false;
      }
    });
    setMode('login');
    return authModal;
  }

  async function requireLogin() {
    const user = await getUser();
    if (user) return user;
    const modal = makeModal();
    if (pendingLogin) return new Promise(resolve => {
      const previous = pendingLogin;
      pendingLogin = value => { previous(value); resolve(value); };
    });
    setStatus('', false);
    modal.classList.add('open');
    return new Promise(resolve => { pendingLogin = resolve; });
  }

  async function signOut() {
    const db = getClient();
    if (!db || !db.auth) return;
    const result = await db.auth.signOut();
    if (result.error) throw result.error;
  }

  global.OurAuth = Object.freeze({ getClient, getUser, requireLogin, signOut });

  function renderHomeAuthStatus(user) {
    const container = document.getElementById('home-auth-status');
    const login = document.getElementById('home-auth-login');
    const name = document.getElementById('home-auth-name');
    const separator = document.getElementById('home-auth-separator');
    const logout = container && container.querySelector('[data-auth-sign-out]');
    if (!container || !login || !name || !separator || !logout) return;
    const loggedIn = Boolean(user);
    login.hidden = loggedIn;
    name.textContent = loggedIn ? `${String(user.email || '').split('@')[0]}님` : '';
    name.hidden = !loggedIn;
    separator.hidden = !loggedIn;
    logout.hidden = !loggedIn;
    const myPhotos = document.getElementById('btn-open-my-photos');
    if (myPhotos) myPhotos.hidden = !loggedIn;
  }

  function setupHomeAuthStatus() {
    const container = document.getElementById('home-auth-status');
    const loginButton = document.getElementById('home-auth-login');
    if (!container) return;
    let authChangeVersion = 0;
    global.addEventListener('authchange', event => {
      authChangeVersion += 1;
      renderHomeAuthStatus(event.detail && event.detail.user || null);
    });
    if (loginButton) loginButton.addEventListener('click', () => requireLogin());
    const myPhotosButton = document.getElementById('btn-open-my-photos');
    if (myPhotosButton) myPhotosButton.addEventListener('click', () => { global.location.hash = '#/my-photos'; });
    const logoutButton = container.querySelector('[data-auth-sign-out]');
    if (logoutButton) logoutButton.addEventListener('click', async () => {
      logoutButton.disabled = true;
      try { await signOut(); }
      catch (error) { console.error('로그아웃하지 못했습니다.', error); }
      finally { logoutButton.disabled = false; }
    });
    const initialVersion = authChangeVersion;
    getUser().then(user => {
      if (authChangeVersion === initialVersion) renderHomeAuthStatus(user);
    });
  }

  setupHomeAuthStatus();
})(globalThis);
