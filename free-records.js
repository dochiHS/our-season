/**
 * free-records.js
 * 승인된 우리 동네 기록 목록 화면
 * 공개 API: globalThis.FreeRecords.render(params)
 */
(function (global) {
  'use strict';

  const PLACES = global.FreePlaces;
  const CITIES = PLACES && PLACES.CITIES ? PLACES.CITIES : {};
  const REGION_ORDER = Object.keys(CITIES);
  // 시·군 칩 순서: 시·도 순서, 그 안에서는 가나다 순(FreePlaces.UNITS 순서)
  const UNIT_ORDER = (PLACES && PLACES.UNITS ? PLACES.UNITS : []).reduce((order, unit, index) => {
    order[unit.key] = index;
    return order;
  }, {});
  const SEASONS = { spring: '봄', summer: '여름', autumn: '가을', winter: '겨울' };
  const WEATHER = { clear: '맑음', cloudy: '흐림', rain: '비', snow: '눈', fog: '안개', other: '기타' };
  const app = document.getElementById('app');
  // place: 'all' 또는 '시·도코드|시·군이름' (시·군 정보가 없는 예전 기록은 '시·도코드|')
  let screen = null, list = null, place = 'all', season = 'all', records = null, loadPromise = null, loadFailed = false;

  function createScreen() {
    if (!app) return;
    screen = document.createElement('section');
    screen.id = 'free-records-screen';
    screen.className = 'screen free-records-screen';
    screen.setAttribute('aria-label', '우리 동네 기록');
    screen.hidden = true;
    screen.innerHTML = '<header class="screen-topbar free-records-topbar"><button class="back-button free-records-back" type="button" aria-label="첫 화면으로 돌아가기">‹</button><h1 class="free-records-title">우리 동네 기록</h1><span class="free-records-topbar-spacer" aria-hidden="true"></span></header><nav class="free-records-filters" aria-label="기록 필터"><div class="free-records-filter-row free-records-city-filter" role="group" aria-label="시·군 선택"></div><div class="free-records-filter-row free-records-season-filter" role="group" aria-label="계절 선택"></div></nav><main class="free-record-list" aria-live="polite"></main><div class="free-records-bottom-bar"><button class="btn-submit-upload free-records-upload-button" type="button">📷 우리 동네 기록 올리기</button></div>';
    app.appendChild(screen);
    list = screen.querySelector('.free-record-list');
    screen.querySelector('.free-records-back').addEventListener('click', () => { global.location.hash = '#/'; });
    screen.querySelector('.free-records-upload-button').addEventListener('click', () => {
      if (global.FreeUpload && typeof global.FreeUpload.open === 'function') global.FreeUpload.open();
    });
  }

  function getSupabaseClient() {
    const config = global.SUPABASE_CONFIG;
    if (!config || !config.SUPABASE_URL || !config.SUPABASE_ANON_KEY || !global.supabase || typeof global.supabase.createClient !== 'function') return null;
    if (!getSupabaseClient.client) getSupabaseClient.client = global.supabase.createClient(config.SUPABASE_URL, config.SUPABASE_ANON_KEY);
    return getSupabaseClient.client;
  }

  async function loadRecords() {
    const client = getSupabaseClient();
    if (!client) throw new Error('Supabase unavailable');
    const { data, error } = await client.from('season_photos')
      .select('city, district, place_name, season, time_of_day, weather, weather_note, memo, nickname, photo_path, taken_at, created_at')
      .eq('status', 'approved').eq('kind', 'free').order('created_at', { ascending: false });
    if (error) throw error;
    return (data || []).filter(row => row && row.city).map(row => {
      const { data: publicData } = client.storage.from('season-photos').getPublicUrl(row.photo_path);
      return { ...row, photoUrl: publicData && publicData.publicUrl ? publicData.publicUrl : '' };
    });
  }

  function appendChip(container, label, value, activeValue, type) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `spot-sort-button${value === activeValue ? ' is-active' : ''}`;
    button.textContent = label;
    button.setAttribute('aria-pressed', value === activeValue ? 'true' : 'false');
    button.addEventListener('click', () => {
      if (type === 'place') place = value;
      else season = value;
      updateHash();
    });
    container.appendChild(button);
  }

  function renderFilters() {
    if (!screen) return;
    const cityFilter = screen.querySelector('.free-records-city-filter');
    const seasonFilter = screen.querySelector('.free-records-season-filter');
    cityFilter.replaceChildren();
    seasonFilter.replaceChildren();
    appendChip(cityFilter, '전체', 'all', place, 'place');
    // 실제로 기록이 있는 시·군(과 지금 고른 시·군)만 칩으로 보여 준다.
    const keys = new Set(Array.isArray(records) ? records.map(placeKey) : []);
    if (place !== 'all') keys.add(place);
    Array.from(keys).sort(comparePlaceKeys)
      .forEach(key => appendChip(cityFilter, labelOfKey(key), key, place, 'place'));
    appendChip(seasonFilter, '전체', 'all', season, 'season');
    Object.entries(SEASONS).forEach(([code, name]) => appendChip(seasonFilter, name, code, season, 'season'));
  }

  function placeKey(record) {
    return `${record.city || ''}|${record.district || ''}`;
  }

  function splitKey(key) {
    const parts = String(key).split('|');
    return { city: parts[0] || '', district: parts[1] || '' };
  }

  function labelOfKey(key) {
    const parts = splitKey(key);
    return PLACES ? PLACES.placeLabel(parts.city, parts.district) : parts.district || parts.city;
  }

  function comparePlaceKeys(a, b) {
    const pa = splitKey(a), pb = splitKey(b);
    const ra = REGION_ORDER.indexOf(pa.city), rb = REGION_ORDER.indexOf(pb.city);
    if (ra !== rb) return ra - rb;
    // 시·군 정보가 없는 예전 기록(시·도만 있음)은 그 시·도의 맨 뒤에 둔다.
    const ua = Object.prototype.hasOwnProperty.call(UNIT_ORDER, a) ? UNIT_ORDER[a] : Number.MAX_SAFE_INTEGER;
    const ub = Object.prototype.hasOwnProperty.call(UNIT_ORDER, b) ? UNIT_ORDER[b] : Number.MAX_SAFE_INTEGER;
    return ua - ub;
  }

  function isKnownKey(key) {
    const parts = splitKey(key);
    if (!Object.prototype.hasOwnProperty.call(CITIES, parts.city)) return false;
    return !parts.district || Boolean(PLACES && PLACES.isValidPlace(parts.city, parts.district));
  }

  function updateHash() {
    const params = new URLSearchParams();
    if (place !== 'all') params.set('place', place);
    if (season !== 'all') params.set('season', season);
    const query = params.toString();
    global.location.hash = `#/local${query ? `?${query}` : ''}`;
    if (global.location.hash === `#/local${query ? `?${query}` : ''}`) renderFiltersAndRecords();
  }

  function formatDate(raw) {
    if (!raw) return '촬영 날짜 미상';
    const date = new Date(raw);
    if (Number.isNaN(date.getTime())) return String(raw).slice(0, 10);
    const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date);
    const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
    return `${values.year}.${values.month}.${values.day}`;
  }

  function addTag(container, text) {
    const tag = document.createElement('span');
    tag.className = 'season-photo-tag';
    tag.textContent = text;
    container.appendChild(tag);
  }

  function renderRecords() {
    if (!list) return;
    list.replaceChildren();
    if (loadFailed) {
      const notice = document.createElement('p');
      notice.className = 'free-records-message is-error';
      notice.textContent = '기록을 불러오지 못했어요. 잠시 후 다시 시도해 주세요';
      list.appendChild(notice);
      return;
    }
    if (!records) {
      const notice = document.createElement('p');
      notice.className = 'free-records-message';
      notice.textContent = '기록을 불러오는 중이에요';
      list.appendChild(notice);
      return;
    }
    const filtered = records.filter(record => (place === 'all' || placeKey(record) === place) && (season === 'all' || record.season === season));
    if (!filtered.length) {
      const empty = document.createElement('p');
      empty.className = 'free-records-message';
      empty.textContent = '아직 올라온 기록이 없어요. 첫 기록을 남겨 주세요';
      list.appendChild(empty);
      return;
    }
    filtered.forEach(record => {
      const card = document.createElement('article');
      card.className = 'free-record-card';
      if (record.photoUrl) {
        const image = document.createElement('img');
        image.className = 'free-record-photo';
        image.src = record.photoUrl;
        image.alt = record.place_name || '우리 동네 기록 사진';
        image.loading = 'lazy';
        image.setAttribute('role', 'button');
        image.setAttribute('aria-label', '사진 크게 보기');
        image.style.cursor = 'zoom-in';
        image.addEventListener('click', () => {
          if (!global.FreePhotoViewer || typeof global.FreePhotoViewer.open !== 'function') return;
          global.FreePhotoViewer.open(record.photoUrl, `${record.place_name || ''} · ${labelOfKey(placeKey(record))}`);
        });
        card.appendChild(image);
      }
      const body = document.createElement('div');
      body.className = 'free-record-card-body';
      const place = document.createElement('h2');
      place.className = 'free-record-place';
      place.textContent = record.place_name || '';
      const cityName = document.createElement('p');
      cityName.className = 'free-record-city';
      cityName.textContent = PLACES ? PLACES.placeFullName(record.city, record.district) : (record.district || record.city || '');
      const tags = document.createElement('div');
      tags.className = 'free-record-tags';
      const seasonNames = global.SpotData && global.SpotData.SEASONS_KO ? global.SpotData.SEASONS_KO : SEASONS;
      const timeNames = global.SpotData && global.SpotData.TIME_OF_DAY_KO ? global.SpotData.TIME_OF_DAY_KO : { sunrise: '일출', day: '낮', sunset: '일몰', night: '밤' };
      const weatherText = record.weather === 'other' ? (record.weather_note || WEATHER.other) : (WEATHER[record.weather] || '날씨 미상');
      [seasonNames[record.season] || '계절 미상', timeNames[record.time_of_day] || '시간 미상', weatherText].forEach(text => addTag(tags, text));
      const memo = document.createElement('p');
      memo.className = 'free-record-memo';
      memo.textContent = record.memo || '';
      memo.hidden = !record.memo;
      const credit = document.createElement('p');
      credit.className = 'free-record-credit';
      credit.textContent = `${record.nickname || '익명'} · ${formatDate(record.taken_at || record.created_at)}`;
      body.append(place, cityName, tags, memo, credit);
      card.appendChild(body);
      list.appendChild(card);
    });
  }

  function renderFiltersAndRecords() {
    renderFilters();
    renderRecords();
  }

  function render(params) {
    if (!screen) return;
    const query = params instanceof URLSearchParams ? params : new URLSearchParams();
    const requestedPlace = query.get('place') || 'all';
    const requestedSeason = query.get('season') || 'all';
    place = requestedPlace === 'all' || isKnownKey(requestedPlace) ? requestedPlace : 'all';
    season = requestedSeason === 'all' || Object.prototype.hasOwnProperty.call(SEASONS, requestedSeason) ? requestedSeason : 'all';
    renderFiltersAndRecords();
    if (!loadPromise) {
      loadPromise = loadRecords().then(result => { records = result; }).catch(() => { loadFailed = true; });
    }
    loadPromise.then(renderFiltersAndRecords);
  }

  createScreen();
  global.FreeRecords = Object.freeze({ render });
})(globalThis);
