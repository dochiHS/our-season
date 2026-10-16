/** 해시 기반 첫 화면·명소 목록·명소 상세·계절 펼침 화면 */
(function (global) {
  'use strict';

  const state = { query: '', sort: 'name', focusSearchOnShow: false, locationError: '', activeScreen: null, lastSeasonContext: null };
  const home = document.getElementById('home-screen');
  const listScreen = document.getElementById('spots-screen');
  const detailScreen = document.getElementById('detail-screen');
  const list = document.getElementById('spot-list');
  const searchInput = document.getElementById('spot-search-input');
  const title = document.getElementById('detail-page-title');
  const appContainer = document.getElementById('app');
  const seasonScreen = createSeasonScreen();
  let seasonTouchStartX = null;
  let pileObserver = null;

  function createSeasonScreen() {
    if (!appContainer) return null;
    const section = document.createElement('section');
    section.id = 'season-screen'; section.className = 'screen season-screen'; section.setAttribute('aria-label', '계절 펼침 화면'); section.hidden = true;
    section.innerHTML = '<header class="season-topbar"><button class="back-button season-back-button" type="button" aria-label="명소 화면으로 돌아가기">‹</button><div class="season-heading"><h1 class="season-heading-title"></h1><p class="season-heading-point"></p></div><span class="season-topbar-spacer" aria-hidden="true"></span></header><nav class="season-tabs" role="tablist" aria-label="계절 선택"></nav><main class="season-view-content"><div class="season-photo-area"><div class="season-photo-stack"></div><div class="season-photo-meta"><p class="season-photo-tags"></p><p class="season-photo-memo"></p><p class="season-photo-credit"></p><p class="season-reference-notice" hidden></p></div></div><div class="season-photo-navigation" aria-label="사진 탐색"><button class="season-nav-button season-previous" type="button" aria-label="이전 사진">‹</button><span class="season-photo-count" aria-live="polite"></span><button class="season-nav-button season-next" type="button" aria-label="다음 사진">›</button></div><section class="other-seasons-section"><h2>같은 자리, 다른 계절</h2><div class="other-seasons-grid"></div></section></main>';
    appContainer.appendChild(section);
    section.querySelector('.season-back-button').addEventListener('click', () => {
      const route = routeFromHash(); if (route.spotId) navigate(`#/spot/${encodeURIComponent(route.spotId)}`);
    });
    section.querySelector('.season-previous').addEventListener('click', () => showSeasonPhoto(-1));
    section.querySelector('.season-next').addEventListener('click', () => showSeasonPhoto(1));
    const stack = section.querySelector('.season-photo-stack');
    stack.addEventListener('touchstart', event => { if (event.touches.length === 1) seasonTouchStartX = event.touches[0].clientX; }, { passive: true });
    stack.addEventListener('touchend', event => {
      if (seasonTouchStartX === null || !event.changedTouches.length) return;
      const dx = event.changedTouches[0].clientX - seasonTouchStartX; seasonTouchStartX = null;
      if (Math.abs(dx) >= 45) showSeasonPhoto(dx < 0 ? 1 : -1);
    }, { passive: true });
    stack.addEventListener('touchcancel', () => { seasonTouchStartX = null; }, { passive: true });
    return section;
  }

  function navigate(hash, focusSearch, replace) {
    state.focusSearchOnShow = Boolean(focusSearch);
    if (global.location.hash === hash) renderRoute();
    else if (replace) global.history.replaceState(null, '', `${global.location.pathname}${global.location.search}${hash}`);
    else global.location.hash = hash;
    if (replace) renderRoute();
  }

  function routeFromHash() {
    const hash = global.location.hash || '#/';
    if (hash === '#/' || hash === '#') return { screen: 'home' };
    if (hash === '#/spots') return { screen: 'spots' };
    let match = hash.match(/^#\/local(?:\?(.+))?$/);
    if (match) return { screen: 'local', params: new URLSearchParams(match[1] || '') };
    match = hash.match(/^#\/spot\/([^/?]+)\/season\/(spring|summer|autumn|winter)(?:\?(.+))?$/);
    if (match) {
      try { return { screen: 'season', spotId: decodeURIComponent(match[1]), season: match[2], params: new URLSearchParams(match[3] || '') }; }
      catch (error) { return { screen: 'home' }; }
    }
    match = hash.match(/^#\/spot\/([^/?]+)(?:\?.*)?$/);
    if (match) {
      try { return { screen: 'detail', spotId: decodeURIComponent(match[1]) }; }
      catch (error) { return { screen: 'home' }; }
    }
    return { screen: 'home' };
  }

  function renderSpotList() {
    if (!list || !global.App || !global.App.state) return;
    const appState = global.App.state;
    const needle = state.query.trim().toLocaleLowerCase('ko-KR');
    let spots = (appState.spots || []).filter(spot => spot.name.toLocaleLowerCase('ko-KR').includes(needle));
    if (state.sort === 'name') spots = spots.slice().sort((a, b) => a.name.localeCompare(b.name, 'ko'));
    else if (appState.userCoords) spots = spots.slice().sort((a, b) => (Number.isFinite(a.distanceMeters) ? a.distanceMeters : Infinity) - (Number.isFinite(b.distanceMeters) ? b.distanceMeters : Infinity));

    list.replaceChildren();
    if (state.locationError) {
      const notice = document.createElement('p'); notice.className = 'spot-list-location-notice'; notice.textContent = state.locationError; list.appendChild(notice);
    }
    if (!spots.length) {
      const empty = document.createElement('p'); empty.className = 'spot-list-empty'; empty.textContent = '찾는 명소가 없어요'; list.appendChild(empty); return;
    }
    const photos = appState.approvedPhotos || [];
    const season = global.SpotData && global.SpotData.getCurrentSeason ? global.SpotData.getCurrentSeason() : 'spring';
    spots.forEach(spot => {
      const spotPhotos = photos.filter(photo => photo.spotId === spot.id).slice().sort((a, b) => String(b.uploadedAt || '').localeCompare(String(a.uploadedAt || '')));
      const card = document.createElement('button'); card.type = 'button'; card.className = 'spot-list-card'; card.setAttribute('aria-label', `${spot.name} 명소 화면 보기`);
      const thumb = document.createElement('span'); thumb.className = `spot-list-thumbnail${spotPhotos.length ? '' : ' is-empty'}`; thumb.dataset.season = season;
      if (spotPhotos.length) { const image = document.createElement('img'); image.src = spotPhotos[0].dataUrl; image.alt = `${spot.name} 최근 승인 사진`; image.loading = 'lazy'; thumb.appendChild(image); }
      else thumb.setAttribute('aria-label', '아직 승인된 사진이 없습니다');
      const body = document.createElement('span'); body.className = 'spot-list-card-body';
      const name = document.createElement('span'); name.className = 'spot-list-card-name'; name.textContent = spot.name; body.appendChild(name);
      const meta = document.createElement('span'); meta.className = 'spot-list-card-meta';
      if (appState.userCoords && spot.distanceText) { const distance = document.createElement('span'); distance.textContent = spot.distanceText; meta.appendChild(distance); }
      const count = document.createElement('span'); count.textContent = `승인 사진 ${spotPhotos.length}장`; meta.appendChild(count); body.appendChild(meta);
      const arrow = document.createElement('span'); arrow.className = 'spot-list-card-arrow'; arrow.setAttribute('aria-hidden', 'true'); arrow.textContent = '›';
      card.append(thumb, body, arrow); card.addEventListener('click', () => navigate(`#/spot/${encodeURIComponent(spot.id)}`)); list.appendChild(card);
    });
  }

  function setSort(sort) {
    state.sort = sort;
    document.querySelectorAll('[data-spot-sort]').forEach(button => {
      const active = button.dataset.spotSort === sort; button.classList.toggle('is-active', active); button.setAttribute('aria-pressed', active ? 'true' : 'false');
    });
    renderSpotList();
  }

  function getFilterValues() {
    const activeTime = document.querySelector('[data-gallery-time].is-active');
    const weather = document.getElementById('gallery-weather-filter');
    return { time: activeTime ? activeTime.dataset.galleryTime || 'all' : 'all', weather: weather ? weather.value || 'all' : 'all' };
  }

  function seasonHash(spotId, season, context) {
    const params = new URLSearchParams();
    if (context.pointId) params.set('point', context.pointId);
    if (context.time && context.time !== 'all') params.set('time', context.time);
    if (context.weather && context.weather !== 'all') params.set('weather', context.weather);
    const query = params.toString();
    return `#/spot/${encodeURIComponent(spotId)}/season/${season}${query ? `?${query}` : ''}`;
  }

  function getSeasonPhotos(spotId, pointId, season, filters) {
    const photos = global.App && global.App.state ? global.App.state.approvedPhotos || [] : [];
    return photos.filter(photo => photo.spotId === spotId && photo.pointId === pointId && photo.season === season
      && (!filters || ((filters.time === 'all' || photo.timeOfDay === filters.time) && (filters.weather === 'all' || photo.weather === filters.weather))))
      .slice().sort((a, b) => String(b.uploadedAt || '').localeCompare(String(a.uploadedAt || '')));
  }

  function getSeasonDisplayPhotos(spotId, pointId, season, filters) {
    const userPhotos = getSeasonPhotos(spotId, pointId, season, filters);
    if (userPhotos.length) return { photos: userPhotos, isReference: false };
    const hasAnyUserPhoto = getSeasonPhotos(spotId, pointId, season, null).length > 0;
    const filtersAreAll = filters && filters.time === 'all' && filters.weather === 'all';
    const references = !hasAnyUserPhoto && filtersAreAll && global.ReferencePhotos
      ? global.ReferencePhotos.getReferencePhotos(spotId, season)
      : [];
    return { photos: references, isReference: references.length > 0 };
  }

  function formatPhotoDate(photo) {
    const raw = photo.takenAt || photo.uploadedAt;
    if (!raw) return '촬영 날짜 미상';
    const date = new Date(raw);
    if (Number.isNaN(date.getTime())) return String(raw).slice(0, 10);
    return new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
  }

  function labelWeather(photo) {
    const labels = { clear: '맑음', cloudy: '흐림', rain: '비', snow: '눈', fog: '안개', other: '기타' };
    return photo.weather === 'other' ? (photo.weatherNote || '기타') : (labels[photo.weather] || '날씨 미상');
  }

  function renderSeasonScreen(route) {
    if (!seasonScreen || !global.App || !global.SpotData) return;
    const appState = global.App.state, spot = appState.spots.find(item => item.id === route.spotId);
    if (!spot) { navigate('#/spots', false, true); return; }
    const point = (spot.points || []).find(item => item.id === appState.currentPointId) || (spot.points || [])[0];
    const filters = getFilterValues();
    const userPhotos = getSeasonPhotos(spot.id, point && point.id, route.season, filters);
    const display = getSeasonDisplayPhotos(spot.id, point && point.id, route.season, filters);
    const photos = display.photos;
    const isReference = display.isReference;
    const seasons = global.SpotData.SEASONS || ['spring', 'summer', 'autumn', 'winter'];
    const seasonNames = global.SpotData.SEASONS_KO || { spring: '봄', summer: '여름', autumn: '가을', winter: '겨울' };
    const timeNames = global.SpotData.TIME_OF_DAY_KO || { sunrise: '일출', day: '낮', sunset: '일몰', night: '밤' };
    seasonScreen.querySelector('.season-heading-title').textContent = spot.name;
    seasonScreen.querySelector('.season-heading-point').textContent = point ? point.name : '대표 지점';
    const tabs = seasonScreen.querySelector('.season-tabs'); tabs.replaceChildren();
    seasons.forEach(season => {
      const tab = document.createElement('button'); tab.type = 'button'; tab.setAttribute('role', 'tab'); tab.setAttribute('aria-selected', season === route.season ? 'true' : 'false');
      tab.className = `season-tab${season === route.season ? ' is-active' : ''}`; tab.textContent = seasonNames[season];
      tab.addEventListener('click', () => navigate(seasonHash(spot.id, season, { pointId: point && point.id, ...filters })));
      tabs.appendChild(tab);
    });

    const stack = seasonScreen.querySelector('.season-photo-stack'); stack.replaceChildren();
    const metaTags = seasonScreen.querySelector('.season-photo-tags'), memo = seasonScreen.querySelector('.season-photo-memo'), credit = seasonScreen.querySelector('.season-photo-credit');
    const referenceNotice = seasonScreen.querySelector('.season-reference-notice');
    const count = seasonScreen.querySelector('.season-photo-count'), previous = seasonScreen.querySelector('.season-previous'), next = seasonScreen.querySelector('.season-next');
    if (!photos.length) {
      const empty = document.createElement('div'); empty.className = 'season-photo-empty'; empty.textContent = '이 계절 사진이 아직 없어요. 첫 사진을 올려 주세요'; stack.appendChild(empty);
      metaTags.textContent = ''; memo.textContent = ''; memo.hidden = true; credit.textContent = ''; referenceNotice.textContent = ''; referenceNotice.hidden = true;
      count.textContent = '0 / 0'; previous.disabled = true; next.disabled = true;
    } else {
      const currentIndex = Math.min(Math.max(state.photoIndex || 0, 0), photos.length - 1); state.photoIndex = currentIndex;
      const backCount = Math.min(2, photos.length - 1);
      for (let offset = backCount; offset >= 1; offset -= 1) {
        const backIndex = (currentIndex + offset) % photos.length;
        const back = document.createElement('span');
        back.className = `season-photo-back season-photo-back-${offset === 1 ? 'one' : 'two'}`;
        back.setAttribute('aria-hidden', 'true');
        const backImage = document.createElement('img'); backImage.className = 'season-photo-back-image'; backImage.src = isReference ? photos[backIndex].image : photos[backIndex].dataUrl; backImage.alt = ''; backImage.loading = 'lazy';
        back.appendChild(backImage); stack.appendChild(back);
      }
      const photoCard = document.createElement('div'); photoCard.className = 'season-photo-card';
      const image = document.createElement('img'); image.src = isReference ? photos[currentIndex].image : photos[currentIndex].dataUrl; image.alt = `${spot.name} ${seasonNames[route.season]} 사진 ${currentIndex + 1}`; image.loading = 'lazy'; photoCard.appendChild(image); stack.appendChild(photoCard);
      const photo = photos[currentIndex];
      metaTags.replaceChildren();
      if (isReference) {
        const tag = document.createElement('span'); tag.className = 'season-photo-tag season-reference-tag'; tag.textContent = '참고 사진'; metaTags.appendChild(tag);
        memo.textContent = ''; memo.hidden = true;
        credit.textContent = `${global.ReferencePhotos.creditOf(photo)} · ${photo.month} 촬영`;
        referenceNotice.textContent = '이 계절 사진이 아직 없어 관광공사 사진을 보여 드려요. 직접 찍은 사진을 올려 주세요.'; referenceNotice.hidden = false;
      } else {
        const timeLabel = timeNames[photo.timeOfDay] || '시간 미상';
        [timeLabel, labelWeather(photo)].forEach(text => { const tag = document.createElement('span'); tag.className = 'season-photo-tag'; tag.textContent = text; metaTags.appendChild(tag); });
        memo.textContent = photo.memo || ''; memo.hidden = !photo.memo;
        credit.textContent = `${photo.nickname || '익명'} · ${formatPhotoDate(photo)}`;
        referenceNotice.textContent = ''; referenceNotice.hidden = true;
      }
      count.textContent = `${currentIndex + 1} / ${photos.length}`; previous.disabled = currentIndex === 0; next.disabled = currentIndex === photos.length - 1;
    }

    const tiles = seasonScreen.querySelector('.other-seasons-grid'); tiles.replaceChildren();
    seasons.forEach(season => {
      const recent = getSeasonPhotos(spot.id, point && point.id, season, null)[0];
      const reference = !recent && filters.time === 'all' && filters.weather === 'all' && global.ReferencePhotos
        ? global.ReferencePhotos.getReferencePhotos(spot.id, season)[0]
        : null;
      const tile = document.createElement('button'); tile.type = 'button'; tile.className = `other-season-tile${season === route.season ? ' is-current' : ''}`;
      tile.setAttribute('aria-label', `${seasonNames[season]} 계절 펼쳐 보기${reference ? ', 참고 사진' : ''}`); tile.addEventListener('click', () => navigate(seasonHash(spot.id, season, { pointId: point && point.id, ...filters })));
      const thumb = document.createElement('span'); thumb.className = `other-season-thumb${recent || reference ? '' : ' is-empty'}`;
      if (recent) { const image = document.createElement('img'); image.src = recent.dataUrl; image.alt = `${seasonNames[season]} 최근 승인 사진`; image.loading = 'lazy'; thumb.appendChild(image); }
      else if (reference) {
        const image = document.createElement('img'); image.src = reference.thumb; image.alt = `${seasonNames[season]} 참고 사진`; image.loading = 'lazy'; thumb.appendChild(image);
        const badge = document.createElement('span'); badge.className = 'other-season-reference-badge'; badge.textContent = '참고'; thumb.appendChild(badge);
      } else { const empty = document.createElement('span'); empty.textContent = '아직 없어요'; thumb.appendChild(empty); }
      const label = document.createElement('span'); label.className = 'other-season-label'; label.textContent = seasonNames[season]; tile.append(thumb, label); tiles.appendChild(tile);
    });
  }

  function showSeasonPhoto(delta) {
    if (!seasonScreen) return;
    const route = routeFromHash(); if (route.screen !== 'season') return;
    const spot = global.App.state.spots.find(item => item.id === route.spotId); if (!spot) return;
    const point = (spot.points || []).find(item => item.id === global.App.state.currentPointId) || (spot.points || [])[0];
    const display = getSeasonDisplayPhotos(spot.id, point && point.id, route.season, getFilterValues());
    const photos = display.photos;
    if (!photos.length) return;
    state.photoIndex = Math.min(Math.max((state.photoIndex || 0) + delta, 0), photos.length - 1);
    renderSeasonScreen(route);
  }

  function restoreSeasonContext(route) {
    const params = route.params || new URLSearchParams();
    const spot = global.App.state.spots.find(item => item.id === route.spotId); if (!spot) return;
    const requestedPoint = params.get('point');
    if (requestedPoint && spot.points.some(point => point.id === requestedPoint)) global.App.state.currentPointId = requestedPoint;
    else if (!global.App.state.currentPointId || !spot.points.some(point => point.id === global.App.state.currentPointId)) global.App.state.currentPointId = spot.points[0] && spot.points[0].id;
    const time = params.get('time'), weather = params.get('weather');
    if (time && document.querySelector(`[data-gallery-time="${CSS.escape(time)}"]`)) document.querySelector(`[data-gallery-time="${CSS.escape(time)}"]`).click();
    if (weather) {
      const select = document.getElementById('gallery-weather-filter');
      if (select && Array.from(select.options).some(option => option.value === weather)) { select.value = weather; select.dispatchEvent(new Event('change', { bubbles: true })); }
    }
    if (global.App.renderPointTabs) global.App.renderPointTabs();
    if (global.App.renderSummaryCard) global.App.renderSummaryCard();
    if (global.App.renderMatrix) global.App.renderMatrix();
    if (global.SpotMap) global.SpotMap.refresh(false);
    state.lastSeasonContext = { spotId: spot.id, pointId: global.App.state.currentPointId, time: getFilterValues().time, weather: getFilterValues().weather };
  }

  function renderRoute() {
    const route = routeFromHash(), cameFromSeason = state.activeScreen === 'season';
    const isHome = route.screen === 'home', isList = route.screen === 'spots', isSeason = route.screen === 'season', isLocal = route.screen === 'local';
    home.hidden = !isHome; listScreen.hidden = !isList; detailScreen.hidden = route.screen !== 'detail';
    const localScreen = document.getElementById('free-records-screen');
    if (localScreen) localScreen.hidden = !isLocal;
    if (seasonScreen) seasonScreen.hidden = !isSeason;
    appContainer.classList.toggle('route-home', isHome);
    if (isList) {
      renderSpotList();
      if (state.focusSearchOnShow) { state.focusSearchOnShow = false; global.setTimeout(() => searchInput && searchInput.focus(), 0); }
    }
    if (isLocal && global.FreeRecords) global.FreeRecords.render(route.params);
    if (route.screen === 'detail') {
      const spot = global.App && global.App.state && global.App.state.spots.find(item => item.id === route.spotId);
      if (!spot) { navigate('#/spots', false, true); return; }
      global.App.selectSpot(route.spotId);
      if (cameFromSeason && state.lastSeasonContext && state.lastSeasonContext.spotId === spot.id) {
        global.App.state.currentPointId = state.lastSeasonContext.pointId;
        const timeButton = document.querySelector(`[data-gallery-time="${CSS.escape(state.lastSeasonContext.time)}"]`); if (timeButton) timeButton.click();
        const weather = document.getElementById('gallery-weather-filter'); if (weather) { weather.value = state.lastSeasonContext.weather; weather.dispatchEvent(new Event('change', { bubbles: true })); }
        if (global.App.renderPointTabs) global.App.renderPointTabs(); if (global.App.renderSummaryCard) global.App.renderSummaryCard(); if (global.App.renderMatrix) global.App.renderMatrix();
      } else if (!cameFromSeason) state.lastSeasonContext = null;
      if (title) title.textContent = spot.name;
      global.setTimeout(() => { global.dispatchEvent(new Event('resize')); if (global.SpotMap) global.SpotMap.refresh(true); }, 0);
    }
    if (isSeason) {
      const spot = global.App && global.App.state && global.App.state.spots.find(item => item.id === route.spotId);
      if (!spot) { navigate('#/spots', false, true); return; }
      global.App.selectSpot(route.spotId);
      restoreSeasonContext(route);
      state.photoIndex = 0; renderSeasonScreen(route);
    }
    if (isHome || isList || isLocal) state.lastSeasonContext = null;
    state.activeScreen = route.screen;
  }

  function enableEmptySeasonPiles() {
    if (!detailScreen) return;
    detailScreen.querySelectorAll('.season-pile:disabled').forEach(button => button.disabled = false);
  }

  function navigatePile(event) {
    const pile = event.target.closest && event.target.closest('.season-pile');
    if (!pile || !detailScreen.contains(pile)) return;
    event.preventDefault(); event.stopPropagation(); event.stopImmediatePropagation();
    const route = routeFromHash(); if (route.screen !== 'detail') return;
    const season = (global.SpotData.SEASONS || []).find(key => pile.querySelector('.season-pile-name')?.textContent === global.SpotData.SEASONS_KO[key]);
    if (!season) return;
    const filters = getFilterValues(), spot = global.App.state.spots.find(item => item.id === route.spotId);
    const point = spot && spot.points.find(item => item.id === global.App.state.currentPointId);
    state.lastSeasonContext = { spotId: route.spotId, pointId: point && point.id, ...filters };
    state.photoIndex = 0;
    navigate(seasonHash(route.spotId, season, { pointId: point && point.id, ...filters }));
  }

  function initScreens() {
    if (!home || !listScreen || !detailScreen || !list || !seasonScreen) return;
    document.getElementById('btn-open-spots').addEventListener('click', () => navigate('#/spots', true));
    document.getElementById('btn-open-local-records').addEventListener('click', () => navigate('#/local'));
    document.getElementById('btn-list-back').addEventListener('click', () => navigate('#/', false, true));
    document.getElementById('btn-detail-back').addEventListener('click', () => navigate('#/spots', false, true));
    document.querySelectorAll('[data-spot-sort]').forEach(button => button.addEventListener('click', async () => {
      if (button.dataset.spotSort !== 'nearest') { state.locationError = ''; setSort('name'); return; }
      state.locationError = ''; setSort('nearest');
      if (global.App && global.App.requestUserLocation) {
        const located = await global.App.requestUserLocation(true);
        state.locationError = located ? '' : '위치를 확인할 수 없어 가까운 순으로 정렬할 수 없어요.';
        renderSpotList();
      }
    }));
    if (searchInput) searchInput.addEventListener('input', () => { state.query = searchInput.value; renderSpotList(); });
    document.addEventListener('click', navigatePile, true);
    if (global.MutationObserver) {
      pileObserver = new MutationObserver(enableEmptySeasonPiles);
      const matrix = document.getElementById('photo-matrix'); if (matrix) pileObserver.observe(matrix, { childList: true, subtree: true });
      enableEmptySeasonPiles();
    }
    global.addEventListener('hashchange', renderRoute);
    global.addEventListener('spotstatechange', () => { if (!listScreen.hidden) renderSpotList(); enableEmptySeasonPiles(); const route = routeFromHash(); if (route.screen === 'season' && !seasonScreen.hidden) renderSeasonScreen(route); });
    if (!global.location.hash) global.history.replaceState(null, '', `${global.location.pathname}${global.location.search}#/`);
    setSort('name'); renderRoute();
  }

  global.Screens = Object.freeze({ navigateSeason: (spotId, season) => {
    const filters = getFilterValues(), spot = global.App.state.spots.find(item => item.id === spotId), point = spot && spot.points.find(item => item.id === global.App.state.currentPointId);
    navigate(seasonHash(spotId, season, { pointId: point && point.id, ...filters }));
  } });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initScreens, { once: true });
  else initScreens();
})(globalThis);
