/** 해시 기반 첫 화면·명소 목록·명소 상세 화면 */
(function (global) {
  'use strict';

  const state = { query: '', sort: 'name', focusSearchOnShow: false, locationError: '' };
  const home = document.getElementById('home-screen');
  const listScreen = document.getElementById('spots-screen');
  const detailScreen = document.getElementById('detail-screen');
  const list = document.getElementById('spot-list');
  const searchInput = document.getElementById('spot-search-input');
  const title = document.getElementById('detail-page-title');
  const appContainer = document.getElementById('app');

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
    const match = hash.match(/^#\/spot\/(.+)$/);
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

  function renderRoute() {
    const route = routeFromHash(); const isHome = route.screen === 'home'; const isList = route.screen === 'spots';
    home.hidden = !isHome; listScreen.hidden = !isList; detailScreen.hidden = route.screen !== 'detail'; appContainer.classList.toggle('route-home', isHome);
    if (isList) {
      renderSpotList();
      if (state.focusSearchOnShow) { state.focusSearchOnShow = false; global.setTimeout(() => searchInput && searchInput.focus(), 0); }
    }
    if (route.screen === 'detail') {
      const spot = global.App && global.App.state && global.App.state.spots.find(item => item.id === route.spotId);
      if (!spot) { navigate('#/spots', false, true); return; }
      global.App.selectSpot(route.spotId); if (title) title.textContent = spot.name;
      global.setTimeout(() => { global.dispatchEvent(new Event('resize')); if (global.SpotMap) global.SpotMap.refresh(true); }, 0);
    }
  }

  function initScreens() {
    if (!home || !listScreen || !detailScreen || !list) return;
    document.getElementById('btn-open-spots').addEventListener('click', () => navigate('#/spots', true));
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
    global.addEventListener('hashchange', renderRoute);
    global.addEventListener('spotstatechange', () => { if (!listScreen.hidden) renderSpotList(); });
    if (!global.location.hash) global.history.replaceState(null, '', `${global.location.pathname}${global.location.search}#/`);
    setSort('name'); renderRoute();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initScreens, { once: true });
  else initScreens();
})(globalThis);
