/** 네이버 지도 길찾기 링크 */
(function (global) {
  'use strict';

  const compassButton = document.getElementById('btn-open-compass');
  if (!compassButton) return;

  const routePanel = document.createElement('section');
  routePanel.className = 'naver-route-panel';
  routePanel.setAttribute('aria-label', '네이버 지도 길찾기');
  routePanel.innerHTML = '<h2 class="naver-route-title">길찾기 · 네이버 지도</h2><div class="naver-route-buttons"><button type="button" data-route-mode="public">대중교통</button><button type="button" data-route-mode="car">자동차</button><button type="button" data-route-mode="bicycle">자전거</button><button type="button" data-route-mode="walk">걷기</button></div>';
  compassButton.insertAdjacentElement('afterend', routePanel);

  const APP_NAME = 'https://dochihs.github.io/our-season/';
  const PLAY_STORE = 'https://play.google.com/store/apps/details?id=com.nhn.android.nmap';
  const APP_STORE = 'https://apps.apple.com/app/id311867728';

  function getDestination() {
    const app = global.App;
    const state = app && app.state;
    const spot = state && state.spots.find(item => item.id === state.currentSpotId);
    if (!spot) return null;
    const point = (spot.points || []).find(item => item.id === state.currentPointId) || (spot.points || [])[0];
    if (!point || !Number.isFinite(Number(point.lat)) || !Number.isFinite(Number(point.lng))) return null;
    return { lat: Number(point.lat), lng: Number(point.lng), name: `${spot.name} ${point.name}` };
  }

  function routePath(mode, destination) {
    return `route/${mode}?dlat=${destination.lat}&dlng=${destination.lng}&dname=${encodeURIComponent(destination.name)}&appname=${APP_NAME}`;
  }

  function isMobileDevice() {
    return /Android|iPhone|iPad|iPod|Mobile/i.test(global.navigator && global.navigator.userAgent || '');
  }

  function openIosApp(path) {
    let completed = false;
    let timer = null;
    const cleanup = () => {
      if (completed) return;
      completed = true;
      if (timer !== null) global.clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
    const onVisibilityChange = () => {
      if (document.hidden) cleanup();
    };
    document.addEventListener('visibilitychange', onVisibilityChange);
    timer = global.setTimeout(() => {
      if (completed) return;
      const appDidOpen = document.hidden;
      cleanup();
      if (!appDidOpen) global.location.href = APP_STORE;
    }, 1500);
    global.location.href = `nmap://${path}`;
  }

  function openRoute(mode) {
    const destination = getDestination();
    if (!destination) return;
    const path = routePath(mode, destination);
    if (!isMobileDevice()) {
      global.open(`https://map.naver.com/p/search/${encodeURIComponent(destination.name)}`, '_blank', 'noopener,noreferrer');
      return;
    }

    if (/Android/i.test(global.navigator.userAgent)) {
      const fallback = `;S.browser_fallback_url=${encodeURIComponent(PLAY_STORE)}`;
      global.location.href = `intent://${path}#Intent;scheme=nmap;package=com.nhn.android.nmap${fallback};end`;
      return;
    }
    openIosApp(path);
  }

  routePanel.querySelectorAll('[data-route-mode]').forEach(button => {
    button.addEventListener('click', () => openRoute(button.dataset.routeMode));
  });

  function updateDestination() {
    const available = Boolean(getDestination());
    routePanel.querySelectorAll('button').forEach(button => { button.disabled = !available; });
  }

  updateDestination();
  global.addEventListener('hashchange', updateDestination);
  global.addEventListener('spotstatechange', updateDestination);
  const summary = document.getElementById('spot-summary-card');
  if (summary && global.MutationObserver) new MutationObserver(updateDestination).observe(summary, { childList: true, subtree: true });
  const pointTabs = document.getElementById('point-tabs');
  if (pointTabs) pointTabs.addEventListener('click', () => global.setTimeout(updateDestination, 0));
})(globalThis);
