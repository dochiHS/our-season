/** 명소 근처 네이버 지도 걷기 길찾기 */
(function (global) {
  'use strict';

  const mapSection = document.querySelector('.spot-map-section');
  if (!mapSection) return;

  const routePanel = document.createElement('section');
  routePanel.className = 'naver-route-panel';
  routePanel.setAttribute('aria-label', '네이버 지도 걷기 길찾기');
  routePanel.hidden = true;
  routePanel.innerHTML = '<button type="button" class="naver-route-walk-button">걸어서 가는 길 · 네이버 지도</button>';
  mapSection.insertAdjacentElement('afterend', routePanel);

  const APP_NAME = 'https://dochihs.github.io/our-season/';
  const PLAY_STORE = 'https://play.google.com/store/apps/details?id=com.nhn.android.nmap';
  const APP_STORE = 'https://apps.apple.com/app/id311867728';
  const MAX_DISTANCE_METERS = 2000;

  function distanceInMeters(fromLat, fromLng, toLat, toLng) {
    if (global.GeoCalculator && typeof global.GeoCalculator.getDistanceInMeters === 'function') {
      return global.GeoCalculator.getDistanceInMeters(fromLat, fromLng, toLat, toLng);
    }
    const radians = value => value * Math.PI / 180;
    const lat1 = radians(fromLat), lat2 = radians(toLat);
    const deltaLat = lat2 - lat1, deltaLng = radians(toLng - fromLng);
    const a = Math.sin(deltaLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(deltaLng / 2) ** 2;
    return 6371000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  function getCurrentSpot() {
    const state = global.App && global.App.state;
    if (!state || !Array.isArray(state.spots)) return null;
    return state.spots.find(item => item.id === state.currentSpotId) || null;
  }

  function getDestination() {
    const spot = getCurrentSpot();
    if (!spot) return null;
    const points = Array.isArray(spot.points) ? spot.points : [];
    const state = global.App.state;
    const point = points.find(item => item.id === state.currentPointId) || points[0];
    if (!point || !Number.isFinite(Number(point.lat)) || !Number.isFinite(Number(point.lng))) return null;
    return { lat: Number(point.lat), lng: Number(point.lng), name: `${spot.name} ${point.name}` };
  }

  function isWithinRange() {
    const state = global.App && global.App.state;
    const coords = state && state.userCoords;
    const spot = getCurrentSpot();
    if (!coords || !Number.isFinite(Number(coords.latitude)) || !Number.isFinite(Number(coords.longitude)) || !spot) return false;
    const points = Array.isArray(spot.points) ? spot.points : [];
    return points.some(point => {
      const lat = Number(point.lat), lng = Number(point.lng);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false;
      const distance = distanceInMeters(Number(coords.latitude), Number(coords.longitude), lat, lng);
      return Number.isFinite(distance) && distance <= MAX_DISTANCE_METERS;
    });
  }

  function routePath(destination) {
    return `route/walk?dlat=${destination.lat}&dlng=${destination.lng}&dname=${encodeURIComponent(destination.name)}&appname=${APP_NAME}`;
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

  function openRoute() {
    const destination = getDestination();
    if (!destination || !isWithinRange()) return;
    const path = routePath(destination);
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

  routePanel.querySelector('button').addEventListener('click', openRoute);

  function updateDestination() {
    routePanel.hidden = !isWithinRange() || !getDestination();
  }

  function scheduleUpdate() { global.setTimeout(updateDestination, 0); }
  updateDestination();
  global.addEventListener('hashchange', scheduleUpdate);
  global.addEventListener('spotstatechange', scheduleUpdate);
  const pointTabs = document.getElementById('point-tabs');
  if (pointTabs) pointTabs.addEventListener('click', scheduleUpdate);
})(globalThis);
