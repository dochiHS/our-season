(function (global) {
  'use strict';

  const PLACES = global.FreePlaces;
  const SEASONS = { spring: '봄', summer: '여름', autumn: '가을', winter: '겨울' };
  const WEATHER = { clear: '맑음', cloudy: '흐림', rain: '비', snow: '눈', fog: '안개', other: '기타' };
  const app = document.getElementById('app');
  let screen, placeScreen, list, place = 'all', season = 'all', records = null, loadPromise = null, loadFailed = false;
  let lastListHash = '#/local', pendingPlaceNavigation = false, placeMap = null;

  function createScreen() {
    if (!app) return;
    screen = document.createElement('section');
    screen.id = 'free-records-screen'; screen.className = 'screen free-records-screen';
    screen.setAttribute('aria-label', '우리 동네 기록'); screen.hidden = true;
    screen.innerHTML = '<header class="screen-topbar free-records-topbar"><button class="back-button free-records-back" type="button" aria-label="첫 화면으로 돌아가기">‹</button><h1 class="free-records-title">우리 동네 기록</h1><span class="free-records-topbar-spacer" aria-hidden="true"></span></header><nav class="free-records-filters" aria-label="기록 필터"><div class="free-records-filter-row free-records-city-filter" role="group" aria-label="시·군 선택"></div><div class="free-records-filter-row free-records-season-filter" role="group" aria-label="계절 선택"></div></nav><main class="free-record-list" aria-live="polite"></main><div class="free-records-bottom-bar"><button class="btn-submit-upload free-records-upload-button" type="button"><img src="my-photos-icon.png" alt="" aria-hidden="true" class="ui-icon ui-icon-22"> 우리 동네 기록 올리기</button></div>';
    app.appendChild(screen); list = screen.querySelector('.free-record-list');
    screen.querySelector('.free-records-back').addEventListener('click', () => { global.location.hash = '#/'; });
    screen.querySelector('.free-records-upload-button').addEventListener('click', () => global.FreeUpload && global.FreeUpload.open());

    placeScreen = document.createElement('section');
    placeScreen.id = 'free-record-place-screen'; placeScreen.className = 'screen free-record-place-screen';
    placeScreen.setAttribute('aria-label', '사진 장소'); placeScreen.hidden = true;
    placeScreen.innerHTML = '<header class="screen-topbar free-place-topbar"><button class="back-button free-place-back" type="button" aria-label="우리 동네 기록으로 돌아가기">‹</button><h1 class="free-place-title">사진 장소</h1><span class="free-records-topbar-spacer" aria-hidden="true"></span></header><main class="free-place-content" aria-live="polite"></main>';
    app.appendChild(placeScreen);
    placeScreen.querySelector('.free-place-back').addEventListener('click', returnToList);
  }

  function client() {
    return global.OurAuth ? global.OurAuth.getClient() : null;
  }

  async function loadRecords() {
    const db = client();
    if (!db) throw new Error('Supabase unavailable');
    const result = await db.from('season_photos')
      .select('id, city, district, place_name, season, time_of_day, weather, weather_note, memo, nickname, photo_path, taken_at, created_at, approx_lat, approx_lng')
      .eq('status', 'approved').eq('kind', 'free').order('created_at', { ascending: false });
    if (result.error) throw result.error;
    return (result.data || []).filter(row => row && row.city).map(row => {
      const url = db.storage.from('season-photos').getPublicUrl(row.photo_path).data;
      return { ...row, photoUrl: url && url.publicUrl || '' };
    });
  }

  function ensureRecords(force) {
    if (force) { loadPromise = null; loadFailed = false; }
    if (!loadPromise) loadPromise = loadRecords().then(data => { records = data; }).catch(() => { loadFailed = true; });
    return loadPromise;
  }

  async function refresh() {
    await ensureRecords(true);
    if (screen && !screen.hidden) renderFiltersAndRecords();
  }

  function key(record) { return `${record.city || ''}|${record.district || ''}`; }
  function splitKey(value) { const parts = String(value).split('|'); return { city: parts[0] || '', district: parts[1] || '' }; }
  function labelKey(value) {
    const parts = splitKey(value);
    return PLACES ? PLACES.placeLabel(parts.city, parts.district) : parts.district || parts.city;
  }
  function knownKey(value) {
    const parts = splitKey(value);
    return Boolean(PLACES && PLACES.isRegionCode(parts.city) && (!parts.district || PLACES.isValidPlace(parts.city, parts.district)));
  }

  function currentListHash() {
    const params = new URLSearchParams();
    if (place !== 'all') params.set('place', place);
    if (season !== 'all') params.set('season', season);
    const query = params.toString(); return `#/local${query ? `?${query}` : ''}`;
  }

  function updateHash() {
    const hash = currentListHash();
    global.location.hash = hash;
    if (global.location.hash === hash) renderFiltersAndRecords();
  }

  function chip(parent, text, value, active, type) {
    const button = document.createElement('button'); button.type = 'button';
    button.className = `spot-sort-button${value === active ? ' is-active' : ''}`;
    button.textContent = text; button.setAttribute('aria-pressed', String(value === active));
    button.addEventListener('click', () => { if (type === 'place') place = value; else season = value; updateHash(); });
    parent.appendChild(button);
  }

  function renderFilters() {
    const cityFilter = screen.querySelector('.free-records-city-filter');
    const seasonFilter = screen.querySelector('.free-records-season-filter');
    cityFilter.replaceChildren(); seasonFilter.replaceChildren();
    chip(cityFilter, '전체', 'all', place, 'place');
    const keys = new Set((records || []).map(key)); if (place !== 'all') keys.add(place);
    Array.from(keys).sort((a, b) => labelKey(a).localeCompare(labelKey(b), 'ko')).forEach(value => chip(cityFilter, labelKey(value), value, place, 'place'));
    chip(seasonFilter, '전체', 'all', season, 'season');
    Object.entries(SEASONS).forEach(([code, name]) => chip(seasonFilter, name, code, season, 'season'));
  }

  function dateText(raw) {
    if (!raw) return '촬영 날짜 미상';
    const date = new Date(raw); if (Number.isNaN(date.getTime())) return String(raw).slice(0, 10);
    const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date);
    const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
    return `${values.year}.${values.month}.${values.day}`;
  }

  function coordinates(record) {
    if (!record || record.approx_lat === null || record.approx_lat === undefined || record.approx_lng === null || record.approx_lng === undefined) return null;
    const lat = Number(record.approx_lat), lng = Number(record.approx_lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
    return { lat: Math.round(lat * 1000) / 1000, lng: Math.round(lng * 1000) / 1000 };
  }

  function addTag(parent, text) {
    const tag = document.createElement('span'); tag.className = 'season-photo-tag'; tag.textContent = text; parent.appendChild(tag);
  }

  function locationName(row) {
    return PLACES ? PLACES.placeFullName(row.city, row.district) : [row.city, row.district].filter(Boolean).join(' ');
  }

  function tagsFor(row) {
    const timeNames = global.SpotData && global.SpotData.TIME_OF_DAY_KO || { sunrise: '일출', day: '낮', sunset: '일몰', night: '밤' };
    const seasonNames = global.SpotData && global.SpotData.SEASONS_KO || SEASONS;
    const weather = row.weather === 'other' ? row.weather_note || WEATHER.other : WEATHER[row.weather] || '날씨 미상';
    return [seasonNames[row.season] || '계절 미상', timeNames[row.time_of_day] || '시간 미상', weather];
  }

  function renderRecords() {
    list.replaceChildren();
    if (loadFailed) { const p = document.createElement('p'); p.className = 'free-records-message is-error'; p.textContent = '기록을 불러오지 못했어요. 잠시 후 다시 시도해 주세요'; list.appendChild(p); return; }
    if (!records) { const p = document.createElement('p'); p.className = 'free-records-message'; p.textContent = '기록을 불러오는 중이에요'; list.appendChild(p); return; }
    const filtered = records.filter(row => (place === 'all' || key(row) === place) && (season === 'all' || row.season === season));
    if (!filtered.length) { const p = document.createElement('p'); p.className = 'free-records-message'; p.textContent = '아직 올라온 기록이 없어요. 첫 기록을 남겨 주세요'; list.appendChild(p); return; }
    filtered.forEach(row => {
      const card = document.createElement('article'); card.className = 'free-record-card';
      if (row.photoUrl) {
        const image = document.createElement('img'); image.className = 'free-record-photo'; image.src = row.photoUrl;
        image.alt = row.place_name || '우리 동네 기록 사진'; image.loading = 'lazy'; image.setAttribute('role', 'button'); image.setAttribute('aria-label', '사진 크게 보기'); image.style.cursor = 'zoom-in';
        image.addEventListener('click', () => global.FreePhotoViewer && global.FreePhotoViewer.open(row.photoUrl, `${row.place_name || ''} · ${labelKey(key(row))}`));
        card.appendChild(image);
      }
      const body = document.createElement('div'); body.className = 'free-record-card-body';
      const name = document.createElement('h2'); name.className = 'free-record-place'; name.textContent = row.place_name || '';
      const cityRow = document.createElement('div'); cityRow.className = 'free-record-city-row';
      const city = document.createElement('p'); city.className = 'free-record-city'; city.textContent = locationName(row); cityRow.appendChild(city);
      if (coordinates(row) && row.id !== null && row.id !== undefined) {
        const button = document.createElement('button'); button.type = 'button'; button.className = 'free-record-location-button';
        const pinIcon = document.createElement('img'); pinIcon.src = 'icon-pin.png'; pinIcon.alt = ''; pinIcon.setAttribute('aria-hidden', 'true'); pinIcon.className = 'ui-icon ui-icon-16';
        button.append(pinIcon, document.createTextNode(' 위치 보기'));
        button.addEventListener('click', () => { lastListHash = currentListHash(); pendingPlaceNavigation = true; global.location.hash = `#/local/place/${encodeURIComponent(String(row.id))}`; });
        cityRow.appendChild(button);
      }
      const tagList = document.createElement('div'); tagList.className = 'free-record-tags'; tagsFor(row).forEach(text => addTag(tagList, text));
      const memo = document.createElement('p'); memo.className = 'free-record-memo'; memo.textContent = row.memo || ''; memo.hidden = !row.memo;
      const byline = document.createElement('p'); byline.className = 'free-record-credit'; byline.textContent = `${row.nickname || '익명'} · ${dateText(row.taken_at || row.created_at)}`;
      body.append(name, cityRow, tagList, memo, byline); card.appendChild(body); list.appendChild(card);
    });
  }

  function renderFiltersAndRecords() { renderFilters(); renderRecords(); }

  function render(params) {
    if (!screen) return;
    const query = params instanceof URLSearchParams ? params : new URLSearchParams();
    const requestedPlace = query.get('place') || 'all', requestedSeason = query.get('season') || 'all';
    place = requestedPlace === 'all' || knownKey(requestedPlace) ? requestedPlace : 'all';
    season = requestedSeason === 'all' || Object.prototype.hasOwnProperty.call(SEASONS, requestedSeason) ? requestedSeason : 'all';
    lastListHash = currentListHash(); renderFiltersAndRecords(); ensureRecords().then(renderFiltersAndRecords);
  }

  function destroyMap() { if (placeMap) { placeMap.remove(); placeMap = null; } }
  function returnToList() {
    const marker = global.history.state && global.history.state.__freeRecordsPlace;
    if (marker && String(marker) === String(global.location.hash)) global.history.back();
    else global.location.hash = lastListHash || '#/local';
  }

  function renderMissingPlace() {
    destroyMap();
    const content = placeScreen.querySelector('.free-place-content'); content.replaceChildren();
    const message = document.createElement('p'); message.className = 'free-place-missing'; message.textContent = '위치 정보가 없는 기록이에요';
    const back = document.createElement('button'); back.type = 'button'; back.className = 'btn-submit-upload free-place-return-button'; back.textContent = '기록 목록으로 돌아가기'; back.addEventListener('click', returnToList);
    content.append(message, back);
  }

  function renderPlaceRecord(row, point) {
    destroyMap();
    const content = placeScreen.querySelector('.free-place-content'); content.replaceChildren();
    if (!row || !point) { renderMissingPlace(); return; }
    if (row.photoUrl) {
      const image = document.createElement('img'); image.className = 'free-place-photo'; image.src = row.photoUrl; image.alt = row.place_name || '우리 동네 기록 사진';
      image.addEventListener('click', () => global.FreePhotoViewer && global.FreePhotoViewer.open(row.photoUrl, `${row.place_name || ''} · ${locationName(row)}`)); content.appendChild(image);
    }
    const details = document.createElement('div'); details.className = 'free-place-details';
    const title = document.createElement('h2'); title.className = 'free-place-place-name'; title.textContent = row.place_name || '이름 없는 장소';
    const city = document.createElement('p'); city.className = 'free-place-city'; city.textContent = locationName(row);
    const tagList = document.createElement('div'); tagList.className = 'free-record-tags free-place-tags'; tagsFor(row).forEach(text => addTag(tagList, text));
    const byline = document.createElement('p'); byline.className = 'free-record-credit'; byline.textContent = `${row.nickname || '익명'} · ${dateText(row.taken_at || row.created_at)}`;
    details.append(title, city, tagList, byline);
    if (row.memo) { const memo = document.createElement('p'); memo.className = 'free-record-memo'; memo.textContent = row.memo; details.appendChild(memo); }
    content.appendChild(details);
    const map = document.createElement('div'); map.id = 'free-place-map'; map.className = 'free-place-map'; map.setAttribute('role', 'application'); map.setAttribute('aria-label', '대략적인 사진 촬영 위치 지도'); content.appendChild(map);
    const note = document.createElement('p'); note.className = 'free-place-map-note'; note.textContent = '대략적인 위치예요 (약 100m 범위)'; content.appendChild(note);
    if (!global.L || typeof global.L.map !== 'function') { map.textContent = '지도를 불러오지 못했어요'; return; }
    placeMap = global.L.map(map, { center: [point.lat, point.lng], zoom: 15 });
    global.L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a>' }).addTo(placeMap);
    global.L.circle([point.lat, point.lng], { radius: 150, color: '#947658', weight: 2, fillColor: '#c6a98a', fillOpacity: 0.24 }).addTo(placeMap);
    global.requestAnimationFrame(() => { if (placeMap) placeMap.invalidateSize(); });
  }

  function prepareDirectNavigation() {
    const currentUrl = `${global.location.pathname}${global.location.search}${global.location.hash}`;
    if (pendingPlaceNavigation) {
      pendingPlaceNavigation = false;
      const state = global.history.state && typeof global.history.state === 'object' ? global.history.state : {};
      global.history.replaceState({ ...state, __freeRecordsPlace: global.location.hash }, '', currentUrl);
      return;
    }
    const listUrl = `${global.location.pathname}${global.location.search}${lastListHash || '#/local'}`;
    const state = global.history.state && typeof global.history.state === 'object' ? global.history.state : {};
    global.history.replaceState(state, '', listUrl);
    global.history.pushState({ ...state, __freeRecordsPlace: global.location.hash }, '', currentUrl);
  }

  async function renderPlace(id) {
    if (!placeScreen) return;
    const content = placeScreen.querySelector('.free-place-content'); content.replaceChildren();
    const loading = document.createElement('p'); loading.className = 'free-place-loading'; loading.textContent = '기록을 불러오는 중이에요'; content.appendChild(loading);
    await ensureRecords(); prepareDirectNavigation();
    let row = Array.isArray(records) ? records.find(item => String(item.id) === String(id)) : null;
    if (!row && !loadFailed) { await ensureRecords(true); row = Array.isArray(records) ? records.find(item => String(item.id) === String(id)) : null; }
    const point = coordinates(row);
    if (loadFailed || !row || !point) { renderMissingPlace(); return; }
    renderPlaceRecord(row, point);
  }

  createScreen();
  global.FreeRecords = Object.freeze({ render, renderPlace, refresh });
})(globalThis);
