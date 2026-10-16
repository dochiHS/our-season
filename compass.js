/** 현장 촬영 지점 방향·거리 안내 */
(function (global) {
  'use strict';

  const section = document.createElement('section');
  section.id = 'compass-screen';
  section.className = 'screen compass-screen';
  section.setAttribute('aria-label', '촬영 지점 찾기');
  section.hidden = true;
  section.innerHTML = '<header class="compass-topbar"><button class="back-button compass-back" type="button" aria-label="명소 화면으로 돌아가기">‹</button><h1 class="compass-topbar-title">촬영 지점 찾기</h1><span class="compass-topbar-spacer" aria-hidden="true"></span></header><main class="compass-content"><h2 class="compass-spot-name"></h2><nav class="compass-points" aria-label="촬영 지점 선택"></nav><div class="compass-dial" role="img" aria-label="촬영 지점 방향 나침반"><div class="compass-cardinal-dial"><span class="compass-cardinal compass-north"><span class="compass-cardinal-label">N</span></span><span class="compass-cardinal compass-east"><span class="compass-cardinal-label">E</span></span><span class="compass-cardinal compass-south"><span class="compass-cardinal-label">S</span></span><span class="compass-cardinal compass-west"><span class="compass-cardinal-label">W</span></span></div><span class="compass-needle" aria-hidden="true"><span class="compass-needle-shaft"></span><span class="compass-needle-tip"></span><span class="compass-needle-tail"></span><span class="compass-needle-hub"></span></span></div><p class="compass-distance" aria-live="polite">—</p><p class="compass-bearing"></p><p class="compass-status" role="status" aria-live="polite"></p><button class="compass-enable-button" type="button">나침반 켜기</button><button class="compass-upload-button" type="button" hidden>사진 올리러 가기</button></main>';
  const appRoot = document.getElementById('app') || document.body;
  appRoot.appendChild(section);

  let active = false, spot = null, point = null, position = null, watchId = null;
  let heading = null, rawHeading = null, fallback = false, locationError = '', orientationTimer = null;
  let orientationEventName = null, orientationHandler = null;
  let needleRotation = { previous: null, accumulated: 0 };
  let dialRotation = { previous: null, accumulated: 0 };

  const $ = selector => section.querySelector(selector);
  const normalize = degrees => ((degrees % 360) + 360) % 360;
  function accumulateAngle(angle, tracker) {
    const next = normalize(angle);
    if (tracker.previous === null) {
      tracker.previous = next;
      tracker.accumulated = next;
    } else {
      const delta = ((next - tracker.previous + 540) % 360) - 180;
      tracker.accumulated += delta;
      tracker.previous = next;
    }
    return tracker.accumulated;
  }
  function resetRotation() {
    needleRotation = { previous: null, accumulated: 0 };
    dialRotation = { previous: null, accumulated: 0 };
  }
  function screenAngle() {
    const angle = global.screen && global.screen.orientation && Number(global.screen.orientation.angle);
    return Number.isFinite(angle) ? angle : 0;
  }
  function updateHeading(raw) {
    if (!Number.isFinite(raw)) return;
    rawHeading = normalize(raw);
    const corrected = normalize(rawHeading - screenAngle());
    if (heading === null) heading = corrected;
    else {
      const delta = ((corrected - heading + 540) % 360) - 180;
      heading = normalize(heading + delta * 0.2);
    }
    fallback = false;
    render();
  }
  function initialBearing(fromLat, fromLng, toLat, toLng) {
    const rad = value => value * Math.PI / 180;
    const lat1 = rad(fromLat), lat2 = rad(toLat), deltaLng = rad(toLng - fromLng);
    const y = Math.sin(deltaLng) * Math.cos(lat2);
    const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(deltaLng);
    return normalize(Math.atan2(y, x) * 180 / Math.PI);
  }
  function distanceToPoint() {
    if (!position || !point || !global.GeoCalculator) return null;
    return global.GeoCalculator.getDistanceInMeters(position.latitude, position.longitude, point.lat, point.lng);
  }
  function directionLabel(bearing) {
    const names = ['북', '북동', '동', '남동', '남', '남서', '서', '북서'];
    return `${names[Math.round(normalize(bearing) / 45) % 8]} · ${Math.round(normalize(bearing))}°`;
  }
  function render() {
    if (!active || !spot || !point) return;
    const distance = distanceToPoint();
    const distanceElement = $('.compass-distance');
    distanceElement.textContent = distance === null ? '—' : distance < 1000 ? `${Math.round(distance)}m` : `${(distance / 1000).toFixed(1)}km`;
    const bearing = position ? initialBearing(position.latitude, position.longitude, point.lat, point.lng) : 0;
    $('.compass-bearing').textContent = position ? directionLabel(bearing) : '';
    const needleAngle = accumulateAngle(bearing - (heading === null ? 0 : heading), needleRotation);
    $('.compass-needle').style.transform = `rotate(${needleAngle}deg)`;
    const hasSensorHeading = heading !== null && !fallback;
    const headingAngle = hasSensorHeading ? accumulateAngle(heading, dialRotation) : 0;
    $('.compass-cardinal-dial').style.transform = `rotate(${-headingAngle}deg)`;
    $('.compass-dial').style.setProperty('--compass-heading-counter', `${headingAngle}deg`);
    const status = $('.compass-status');
    const within = distance !== null && distance <= (Number(point.radiusMeters) || 500);
    const upload = $('.compass-upload-button');
    upload.hidden = !within;
    status.classList.toggle('is-arrived', within && !locationError);
    if (locationError) status.textContent = locationError;
    else if (!position) status.textContent = '내 위치를 확인하고 있어요…';
    else if (Number(position.accuracy) > 50) status.textContent = `위치 오차가 커요(±${Math.round(position.accuracy)}m). 하늘이 트인 곳에서 잠시 기다려 주세요.`;
    else if (within) status.textContent = '도착했어요! 여기서 찍은 사진은 올릴 수 있어요.';
    else if (fallback) status.textContent = '방향 센서가 없어 화면 위쪽을 북쪽으로 보여 드려요.';
    else status.textContent = '';
  }
  function stopOrientation() {
    if (orientationEventName && orientationHandler) global.removeEventListener(orientationEventName, orientationHandler);
    global.removeEventListener('orientationchange', onOrientationChange);
    orientationEventName = null; orientationHandler = null;
    if (orientationTimer !== null) global.clearTimeout(orientationTimer);
    orientationTimer = null;
  }
  function onOrientationChange() { if (rawHeading !== null) updateHeading(rawHeading); }
  function useFallback() { fallback = true; heading = 0; render(); }
  function receiveIosOrientation(event) {
    if (event.webkitCompassHeading === null || event.webkitCompassHeading === undefined) return;
    const value = Number(event.webkitCompassHeading);
    if (Number.isFinite(value)) updateHeading(value);
  }
  function receiveAbsoluteOrientation(event) {
    if (Number.isFinite(event.alpha)) updateHeading((360 - event.alpha) % 360);
  }
  function receiveStandardOrientation(event) {
    if (Number.isFinite(event.alpha) && event.absolute === true) updateHeading((360 - event.alpha) % 360);
  }
  async function enableCompass() {
    if (!active) return;
    const Orientation = global.DeviceOrientationEvent;
    if (!Orientation) { useFallback(); return; }
    if (typeof Orientation.requestPermission === 'function') {
      try {
        const permission = await Orientation.requestPermission();
        if (permission !== 'granted') { useFallback(); return; }
        orientationEventName = 'deviceorientation'; orientationHandler = receiveIosOrientation;
      } catch (error) { useFallback(); return; }
    } else if ('ondeviceorientationabsolute' in global) {
      orientationEventName = 'deviceorientationabsolute'; orientationHandler = receiveAbsoluteOrientation;
    } else {
      orientationEventName = 'deviceorientation'; orientationHandler = receiveStandardOrientation;
    }
    global.addEventListener(orientationEventName, orientationHandler);
    global.addEventListener('orientationchange', onOrientationChange);
    $('.compass-enable-button').textContent = '나침반 켜짐';
    orientationTimer = global.setTimeout(() => { if (heading === null) useFallback(); }, 2200);
  }
  function onPositionSuccess(result) {
    if (!active) return;
    position = result.coords; locationError = ''; render();
  }
  function onPositionError(error) {
    if (!active) return;
    locationError = error && error.code === 1
      ? '위치 권한이 필요해요. 설정에서 위치를 허용해 주세요.'
      : '현재 위치를 확인할 수 없어요. 잠시 후 다시 시도해 주세요.';
    render();
  }
  function choosePoint(pointId) {
    const selected = spot && spot.points.find(item => item.id === pointId);
    if (!selected) return;
    point = selected;
    if (global.App && global.App.state) {
      global.App.state.currentPointId = point.id;
      if (global.App.renderPointTabs) global.App.renderPointTabs();
      if (global.App.renderSummaryCard) global.App.renderSummaryCard();
      if (global.App.renderMatrix) global.App.renderMatrix();
      if (global.SpotMap) global.SpotMap.refresh(false);
    }
    const hash = `#/spot/${encodeURIComponent(spot.id)}/compass?point=${encodeURIComponent(point.id)}`;
    global.history.replaceState(global.history.state, '', `${global.location.pathname}${global.location.search}${hash}`);
    const nav = $('.compass-points');
    nav.querySelectorAll('button').forEach(button => {
      const selectedButton = button.dataset.pointId === point.id;
      button.classList.toggle('is-selected', selectedButton);
      button.setAttribute('aria-pressed', selectedButton ? 'true' : 'false');
    });
    render();
  }
  function showSpot(spotId, pointId) {
    const spots = global.App && global.App.state ? global.App.state.spots : [];
    spot = spots.find(item => item.id === spotId) || (global.SpotData && global.SpotData.getSpotById(spotId));
    if (!spot) return false;
    $('.compass-spot-name').textContent = spot.name;
    const nav = $('.compass-points'); nav.replaceChildren();
    if (spot.points.length > 1) spot.points.forEach(item => {
      const button = document.createElement('button'); button.type = 'button'; button.className = 'compass-point-button';
      button.dataset.pointId = item.id; button.textContent = item.name;
      button.addEventListener('click', () => choosePoint(item.id)); nav.appendChild(button);
    });
    point = spot.points.find(item => item.id === pointId) || spot.points.find(item => global.App && global.App.state && item.id === global.App.state.currentPointId) || spot.points[0];
    if (!point) return false;
    if (global.App && global.App.state) global.App.state.currentPointId = point.id;
    nav.querySelectorAll('button').forEach(button => {
      const selected = button.dataset.pointId === point.id;
      button.classList.toggle('is-selected', selected); button.setAttribute('aria-pressed', selected ? 'true' : 'false');
    });
    return true;
  }
  function close() {
    active = false;
    if (watchId !== null && global.navigator.geolocation) global.navigator.geolocation.clearWatch(watchId);
    watchId = null; stopOrientation(); section.hidden = true;
    position = null; locationError = ''; heading = null; rawHeading = null; fallback = false;
    resetRotation();
    $('.compass-upload-button').hidden = true;
  }
  function open(spotId, pointId) {
    if (active) close();
    if (!showSpot(spotId, pointId)) return;
    active = true; position = null; locationError = ''; heading = null; rawHeading = null; fallback = false;
    resetRotation();
    section.hidden = false; $('.compass-enable-button').textContent = '나침반 켜기';
    $('.compass-enable-button').onclick = enableCompass;
    $('.compass-back').onclick = goToSpot;
    $('.compass-upload-button').onclick = goToSpot;
    render();
    if (!global.navigator.geolocation) { onPositionError({ code: 1 }); return; }
    try {
      watchId = global.navigator.geolocation.watchPosition(onPositionSuccess, onPositionError, { enableHighAccuracy: true, maximumAge: 0 });
    } catch (error) {
      onPositionError({ code: 1 });
    }
  }
  function goToSpot() {
    if (global.Screens && typeof global.Screens.navigateSpot === 'function') global.Screens.navigateSpot(spot.id, point.id);
    else global.location.hash = `#/spot/${encodeURIComponent(spot.id)}?point=${encodeURIComponent(point.id)}`;
  }
  global.Compass = Object.freeze({ open, close });
})(globalThis);
