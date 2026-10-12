(function () {
  'use strict';

  const CITY_NAMES = Object.freeze({
    cheongju: '청주',
    cheonan: '천안',
    sejong: '세종',
    gimpo: '김포',
    daejeon: '대전'
  });

  const SEASON_NAMES = Object.freeze({
    spring: '봄',
    summer: '여름',
    autumn: '가을',
    winter: '겨울'
  });

  const TIME_NAMES = Object.freeze({
    sunrise: '일출',
    day: '낮',
    sunset: '일몰',
    night: '밤'
  });

  const WEATHER_NAMES = Object.freeze({
    clear: '맑음',
    cloudy: '흐림',
    rain: '비',
    snow: '눈',
    fog: '안개',
    other: '기타'
  });

  const SELECT_COLUMNS = [
    'id', 'kind', 'spot_id', 'point_id', 'city', 'place_name', 'season',
    'time_of_day', 'weather', 'weather_note', 'memo', 'nickname',
    'photo_path', 'taken_at', 'created_at'
  ].join(',');

  const loginView = document.getElementById('login-view');
  const adminView = document.getElementById('admin-view');
  const loginForm = document.getElementById('login-form');
  const emailInput = document.getElementById('email-input');
  const passwordInput = document.getElementById('password-input');
  const loginButton = document.getElementById('login-button');
  const loginMessage = document.getElementById('login-message');
  const logoutButton = document.getElementById('logout-button');
  const refreshButton = document.getElementById('refresh-button');
  const pendingCount = document.getElementById('pending-count');
  const pendingList = document.getElementById('pending-list');
  const adminMessage = document.getElementById('admin-message');

  let client = null;
  let pendingRows = [];
  let authReady = false;
  const deleteConfirmTimers = new Map();

  function showMessage(element, text, kind) {
    element.textContent = text;
    element.classList.remove('is-error', 'is-success');
    if (kind) element.classList.add(`is-${kind}`);
    element.hidden = !text;
  }

  function clearMessage(element) {
    showMessage(element, '', '');
  }

  function showLogin() {
    loginView.hidden = false;
    adminView.hidden = true;
    loginButton.disabled = false;
    passwordInput.value = '';
  }

  function showAdmin() {
    loginView.hidden = true;
    adminView.hidden = false;
    clearMessage(loginMessage);
    loadPending();
  }

  function getSpotLabels(row) {
    const spot = window.SpotData && typeof window.SpotData.getSpotById === 'function'
      ? window.SpotData.getSpotById(row.spot_id)
      : null;
    const point = spot && Array.isArray(spot.points)
      ? spot.points.find(item => item.id === row.point_id)
      : null;
    return {
      spotName: spot ? spot.name : (row.spot_id || '명소 정보 없음'),
      pointName: point ? point.name : (row.point_id || '지점 정보 없음')
    };
  }

  function getKindLabel(row) {
    if (row.kind === 'free') {
      const cityName = CITY_NAMES[row.city] || row.city || '도시 정보 없음';
      const placeName = row.place_name || '장소 이름 없음';
      return `동네 기록 · ${cityName} · ${placeName}`;
    }
    if (row.kind === 'spot' || !row.kind) {
      const names = getSpotLabels(row);
      return `명소 · ${names.spotName} · ${names.pointName}`;
    }
    return String(row.kind);
  }

  function makeElement(tagName, className, text) {
    const element = document.createElement(tagName);
    if (className) element.className = className;
    if (text !== undefined && text !== null) element.textContent = String(text);
    return element;
  }

  function formatDate(value, includeTime) {
    if (!value) return '날짜 미상';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '날짜 미상';
    const options = includeTime
      ? { year: 'numeric', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }
      : { year: 'numeric', month: 'long', day: 'numeric' };
    try {
      return new Intl.DateTimeFormat('ko-KR', options).format(date);
    } catch (_error) {
      return date.toLocaleString('ko-KR');
    }
  }

  function getWeatherLabel(row) {
    if (row.weather === 'other') return row.weather_note || WEATHER_NAMES.other;
    return WEATHER_NAMES[row.weather] || row.weather || '';
  }

  function clearDeleteTimer(id) {
    const timer = deleteConfirmTimers.get(id);
    if (timer) window.clearTimeout(timer);
    deleteConfirmTimers.delete(id);
  }

  function resetDeleteConfirmations() {
    for (const timer of deleteConfirmTimers.values()) window.clearTimeout(timer);
    deleteConfirmTimers.clear();
  }

  function renderPending() {
    pendingCount.textContent = `승인 대기 ${pendingRows.length}장`;
    pendingList.replaceChildren();

    if (!pendingRows.length) {
      pendingList.appendChild(makeElement('p', 'empty-state', '승인 대기 중인 사진이 없어요'));
      return;
    }

    pendingRows.forEach(row => pendingList.appendChild(createPhotoCard(row)));
  }

  function createPhotoCard(row) {
    const card = makeElement('article', 'photo-card');
    card.dataset.recordId = row.id;

    const frame = makeElement('div', 'photo-frame');
    if (row.photo_path) {
      const result = client.storage.from('season-photos').getPublicUrl(row.photo_path);
      const imageUrl = result && result.data ? result.data.publicUrl : '';
      if (imageUrl) {
        const image = document.createElement('img');
        image.src = imageUrl;
        image.alt = `${getKindLabel(row)} 사진`;
        image.loading = 'lazy';
        image.onerror = function () {
          frame.replaceChildren(makeElement('div', 'photo-unavailable', '사진을 불러오지 못했어요'));
        };
        frame.appendChild(image);
      } else {
        frame.appendChild(makeElement('div', 'photo-unavailable', '사진을 불러오지 못했어요'));
      }
    } else {
      frame.appendChild(makeElement('div', 'photo-unavailable', '사진을 불러오지 못했어요'));
    }
    card.appendChild(frame);

    const content = makeElement('div', 'photo-card-content');
    content.appendChild(makeElement('p', 'photo-kind', getKindLabel(row)));

    const tags = makeElement('div', 'photo-tags');
    const tagLabels = [
      SEASON_NAMES[row.season] || row.season,
      TIME_NAMES[row.time_of_day] || row.time_of_day,
      getWeatherLabel(row)
    ].filter(Boolean);
    tagLabels.forEach(label => tags.appendChild(makeElement('span', 'photo-tag', label)));
    content.appendChild(tags);

    if (row.memo) content.appendChild(makeElement('p', 'photo-memo', row.memo));

    const nickname = row.nickname || '닉네임 없음';
    content.appendChild(makeElement('p', 'photo-byline', `${nickname} · ${formatDate(row.taken_at, false)}`));
    content.appendChild(makeElement('p', 'photo-uploaded-at', `올린 시각 · ${formatDate(row.created_at, true)}`));

    const actions = makeElement('div', 'card-actions');
    const approveButton = makeElement('button', 'button button-primary', '승인');
    approveButton.type = 'button';
    approveButton.addEventListener('click', () => approveRecord(row.id, approveButton, rejectButton));

    const rejectButton = makeElement('button', 'button button-danger', '거절·삭제');
    rejectButton.type = 'button';
    rejectButton.addEventListener('click', () => handleDeleteClick(row, rejectButton, approveButton));

    actions.append(approveButton, rejectButton);
    content.appendChild(actions);
    card.appendChild(content);
    return card;
  }

  async function loadPending() {
    if (!client) return;
    refreshButton.disabled = true;
    clearMessage(adminMessage);
    pendingList.replaceChildren(makeElement('p', 'empty-state', '불러오는 중…'));

    try {
      const { data, error } = await client
        .from('season_photos')
        .select(SELECT_COLUMNS)
        .eq('status', 'pending')
        .order('created_at', { ascending: true });

      if (error) throw error;
      resetDeleteConfirmations();
      pendingRows = Array.isArray(data) ? data : [];
      renderPending();
    } catch (_error) {
      pendingRows = [];
      pendingCount.textContent = '승인 대기';
      pendingList.replaceChildren();
      showMessage(adminMessage, '승인 대기 목록을 불러오지 못했어요. 다시 새로고침해 주세요.', 'error');
    } finally {
      refreshButton.disabled = false;
    }
  }

  function setCardBusy(id, busy, firstButton, secondButton) {
    const card = pendingList.querySelector(`[data-record-id="${CSS.escape(String(id))}"]`);
    const buttons = card ? card.querySelectorAll('button') : [firstButton, secondButton];
    buttons.forEach(button => {
      if (button) button.disabled = busy;
    });
  }

  async function approveRecord(id, approveButton, rejectButton) {
    clearDeleteTimer(id);
    setCardBusy(id, true, approveButton, rejectButton);
    clearMessage(adminMessage);

    try {
      const { data, error } = await client
        .from('season_photos')
        .update({ status: 'approved' })
        .eq('id', id)
        .select('id')
        .maybeSingle();

      if (error || !data) throw error || new Error('No row updated');
      pendingRows = pendingRows.filter(row => String(row.id) !== String(id));
      renderPending();
      showMessage(adminMessage, '승인했어요', 'success');
    } catch (_error) {
      setCardBusy(id, false, approveButton, rejectButton);
      showMessage(adminMessage, '승인하지 못했어요. 잠시 후 다시 시도해 주세요.', 'error');
    }
  }

  function handleDeleteClick(row, rejectButton, approveButton) {
    const id = row.id;
    if (deleteConfirmTimers.has(id)) {
      clearDeleteTimer(id);
      deleteRecord(row, rejectButton, approveButton);
      return;
    }

    rejectButton.textContent = '한 번 더 누르면 삭제돼요';
    const timer = window.setTimeout(() => {
      deleteConfirmTimers.delete(id);
      rejectButton.textContent = '거절·삭제';
    }, 3000);
    deleteConfirmTimers.set(id, timer);
  }

  async function deleteRecord(row, rejectButton, approveButton) {
    const id = row.id;
    setCardBusy(id, true, approveButton, rejectButton);
    clearMessage(adminMessage);

    try {
      const { data, error } = await client
        .from('season_photos')
        .delete()
        .eq('id', id)
        .select('id')
        .maybeSingle();

      if (error || !data) throw error || new Error('No row deleted');
      pendingRows = pendingRows.filter(item => String(item.id) !== String(id));
      renderPending();

      if (row.photo_path) {
        const { error: storageError } = await client.storage
          .from('season-photos')
          .remove([row.photo_path]);
        if (storageError) {
          showMessage(adminMessage, '기록은 지웠지만 사진 파일은 남았어요', 'error');
          return;
        }
      }
      showMessage(adminMessage, '기록을 삭제했어요', 'success');
    } catch (_error) {
      setCardBusy(id, false, approveButton, rejectButton);
      showMessage(adminMessage, '기록을 삭제하지 못했어요. 잠시 후 다시 시도해 주세요.', 'error');
    }
  }

  async function verifyAdminAndOpen() {
    const { data, error } = await client.rpc('is_season_admin');
    if (!error && data === true) {
      showAdmin();
      return true;
    }

    await client.auth.signOut();
    showLogin();
    showMessage(loginMessage, '관리자 권한이 없는 계정이에요', 'error');
    return false;
  }

  loginForm.addEventListener('submit', async event => {
    event.preventDefault();
    loginButton.disabled = true;
    clearMessage(loginMessage);

    try {
      const { error } = await client.auth.signInWithPassword({
        email: emailInput.value.trim(),
        password: passwordInput.value
      });
      if (error) {
        showMessage(loginMessage, '이메일 또는 비밀번호를 확인해 주세요', 'error');
        return;
      }
      await verifyAdminAndOpen();
    } catch (_error) {
      showMessage(loginMessage, '이메일 또는 비밀번호를 확인해 주세요', 'error');
    } finally {
      loginButton.disabled = false;
    }
  });

  logoutButton.addEventListener('click', async () => {
    logoutButton.disabled = true;
    const { error } = await client.auth.signOut();
    logoutButton.disabled = false;
    if (error) {
      showMessage(adminMessage, '로그아웃하지 못했어요. 다시 시도해 주세요.', 'error');
      return;
    }
    resetDeleteConfirmations();
    pendingRows = [];
    showLogin();
    showMessage(loginMessage, '로그아웃했어요', 'success');
  });

  refreshButton.addEventListener('click', loadPending);

  function initialize() {
    const config = window.SUPABASE_CONFIG;
    const supabaseApi = window.supabase;
    if (!config || !config.SUPABASE_URL || !config.SUPABASE_ANON_KEY
      || !supabaseApi || typeof supabaseApi.createClient !== 'function') {
      showMessage(loginMessage, '관리자 화면을 불러오지 못했어요. 설정을 확인해 주세요.', 'error');
      return;
    }

    client = supabaseApi.createClient(config.SUPABASE_URL, config.SUPABASE_ANON_KEY, {
      auth: {
        storageKey: 'our-season-admin-auth',
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true
      }
    });

    client.auth.onAuthStateChange(event => {
      if (event === 'SIGNED_OUT' && authReady) {
        resetDeleteConfirmations();
        pendingRows = [];
        showLogin();
      }
    });

    client.auth.getSession().then(async ({ data, error }) => {
      authReady = true;
      if (error) {
        showMessage(loginMessage, '로그인 상태를 확인하지 못했어요. 다시 로그인해 주세요.', 'error');
        return;
      }
      if (data && data.session) await verifyAdminAndOpen();
    }).catch(() => {
      authReady = true;
      showMessage(loginMessage, '로그인 상태를 확인하지 못했어요. 다시 로그인해 주세요.', 'error');
    });
  }

  initialize();
})();
