(function (global) {
  'use strict';

  const SEASON_ORDER = ['spring', 'summer', 'autumn', 'winter'];
  let section = null;
  let current = null;
  let historyEntry = false;
  let closeTimer = null;
  let detailObserver = null;

  function ensureSection() {
    if (section && section.isConnected) return section;
    section = document.getElementById('point-sheet');
    if (section) return section;

    section = document.createElement('section');
    section.id = 'point-sheet';
    section.className = 'point-sheet';
    section.setAttribute('role', 'dialog');
    section.setAttribute('aria-labelledby', 'point-sheet-title');
    section.hidden = true;
    section.innerHTML = '<div class="point-sheet-handle" aria-hidden="true"></div><header class="point-sheet-header"><div class="point-sheet-heading"><h2 id="point-sheet-title"></h2><p class="point-sheet-spot-name"></p></div><button class="point-sheet-close" type="button" aria-label="닫기">×</button></header><div class="point-sheet-photos"></div><p class="point-sheet-credit" hidden></p><div class="point-sheet-actions"></div><p class="point-sheet-arrival-hint" hidden></p>';
    document.body.appendChild(section);
    section.querySelector('.point-sheet-close').addEventListener('click', () => close(true));
    return section;
  }

  function findTarget(spotId, pointId) {
    const state = global.App && global.App.state;
    if (!state || !Array.isArray(state.spots)) return null;
    const spot = state.spots.find(item => item.id === spotId);
    const point = spot && Array.isArray(spot.points) ? spot.points.find(item => item.id === pointId) : null;
    return spot && point ? { state, spot, point } : null;
  }

  function getDistance(coords, point) {
    if (!coords || !Number.isFinite(Number(coords.latitude)) || !Number.isFinite(Number(coords.longitude))) return null;
    if (!global.GeoCalculator || typeof global.GeoCalculator.getDistanceInMeters !== 'function') return null;
    const distance = global.GeoCalculator.getDistanceInMeters(Number(coords.latitude), Number(coords.longitude), Number(point.lat), Number(point.lng));
    return Number.isFinite(distance) ? distance : null;
  }

  function getPointPhotos(state, spotId, pointId) {
    const todaySeason = global.SpotData && typeof global.SpotData.getCurrentSeason === 'function'
      ? global.SpotData.getCurrentSeason()
      : 'spring';
    const seasonNames = global.SpotData && global.SpotData.SEASONS_KO
      ? global.SpotData.SEASONS_KO
      : { spring: '봄', summer: '여름', autumn: '가을', winter: '겨울' };
    const approved = (Array.isArray(state.approvedPhotos) ? state.approvedPhotos : [])
      .filter(photo => photo.spotId === spotId && photo.pointId === pointId)
      .slice()
      .sort((a, b) => {
        const todayDifference = Number(b.season === todaySeason) - Number(a.season === todaySeason);
        return todayDifference || String(b.uploadedAt || '').localeCompare(String(a.uploadedAt || ''));
      })
      .slice(0, 6)
      .map(photo => ({ season: photo.season, image: photo.dataUrl, heading: photo.heading, isReference: false }));

    if (approved.length < 6 && global.ReferencePhotos && typeof global.ReferencePhotos.getReferencePhotos === 'function') {
      const seasons = [todaySeason, ...SEASON_ORDER.filter(season => season !== todaySeason)];
      for (const season of seasons) {
        const references = global.ReferencePhotos.getReferencePhotos(spotId, season) || [];
        for (const photo of references) {
          if (approved.length >= 6) break;
          approved.push({ season, image: photo.image, isReference: true });
        }
        if (approved.length >= 6) break;
      }
    }
    return { photos: approved.filter(photo => photo.image), seasonNames };
  }

  function render(target) {
    const root = ensureSection();
    const { state, spot, point } = target;
    const title = root.querySelector('#point-sheet-title');
    title.textContent = point.name || '';
    root.querySelector('.point-sheet-spot-name').textContent = spot.name || '';

    const { photos, seasonNames } = getPointPhotos(state, spot.id, point.id);
    const photoStrip = root.querySelector('.point-sheet-photos');
    const credit = root.querySelector('.point-sheet-credit');
    photoStrip.replaceChildren();
    let hasReference = false;
    if (photos.length) {
      photos.forEach(photo => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'point-sheet-photo';
        button.setAttribute('aria-label', `${seasonNames[photo.season] || '계절'} 사진 보기`);
        const image = document.createElement('img');
        image.src = photo.image;
        image.alt = '';
        image.loading = 'lazy';
        button.appendChild(image);
        if (photo.isReference) {
          hasReference = true;
          const badge = document.createElement('span');
          badge.className = 'point-sheet-reference-badge';
          badge.textContent = '참고';
          button.appendChild(badge);
        }
        button.addEventListener('click', () => {
          goTo(`#/spot/${encodeURIComponent(spot.id)}/season/${encodeURIComponent(photo.season)}?point=${encodeURIComponent(point.id)}`);
        });
        photoStrip.appendChild(button);
      });
      photoStrip.hidden = false;
    } else {
      const empty = document.createElement('p');
      empty.className = 'point-sheet-empty';
      empty.textContent = '아직 이 지점 사진이 없어요';
      photoStrip.appendChild(empty);
      photoStrip.hidden = false;
    }
    credit.hidden = !hasReference;
    credit.textContent = hasReference ? '참고 사진 ⓒ한국관광공사 (공공누리 제1유형)' : '';

    const actions = root.querySelector('.point-sheet-actions');
    const arrivalHint = root.querySelector('.point-sheet-arrival-hint');
    actions.replaceChildren();
    const coords = state.userCoords;
    const distance = getDistance(coords, point);
    const withinTwoKm = distance !== null && distance <= 2000;
    const accuracyValue = coords && Number.isFinite(Number(coords.accuracy)) ? Math.min(100, Math.max(0, Number(coords.accuracy))) : 0;
    const radius = Number(point.radiusMeters) || 500;
    const canUseCompass = distance !== null && distance <= radius + accuracyValue;

    if (canUseCompass) {
      const compassButton = document.createElement('button');
      compassButton.type = 'button';
      compassButton.className = 'point-sheet-action point-sheet-action-primary';
      compassButton.textContent = '나침반으로 이 풍경 찾기';
      compassButton.addEventListener('click', () => {
        const firstPhoto = photos[0];
        const heading = firstPhoto && !firstPhoto.isReference ? Number(firstPhoto.heading) : NaN;
        const headingQuery = Number.isInteger(heading) && heading >= 0 && heading <= 359 ? `&heading=${heading}` : '';
        goTo(`#/spot/${encodeURIComponent(spot.id)}/compass?point=${encodeURIComponent(point.id)}${headingQuery}`);
      });
      actions.appendChild(compassButton);
    }

    const routeButton = document.createElement('button');
    routeButton.type = 'button';
    routeButton.className = 'point-sheet-action point-sheet-action-secondary';
    routeButton.textContent = withinTwoKm ? '걸어서 길찾기' : '길찾기';
    routeButton.addEventListener('click', () => {
      if (global.NaverRoute && typeof global.NaverRoute.openTo === 'function') {
        global.NaverRoute.openTo(Number(point.lat), Number(point.lng), `${spot.name} ${point.name}`, withinTwoKm ? 'walk' : 'public');
      }
    });
    actions.appendChild(routeButton);

    arrivalHint.hidden = canUseCompass;
    arrivalHint.textContent = canUseCompass ? '' : `지점 반경 ${radius}m 안에 도착하면 나침반으로 이 풍경을 찾을 수 있어요`;
  }

  function reduceMotion() {
    return global.matchMedia && global.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  function setClosed(immediate) {
    if (!section) return;
    if (closeTimer !== null) {
      global.clearTimeout(closeTimer);
      closeTimer = null;
    }
    section.classList.remove('is-open');
    if (immediate || reduceMotion()) {
      section.hidden = true;
      return;
    }
    closeTimer = global.setTimeout(() => {
      if (section && !section.classList.contains('is-open')) section.hidden = true;
      closeTimer = null;
    }, 260);
  }

  function close(removeHistory) {
    if (!section || section.hidden) {
      current = null;
      return;
    }
    const shouldGoBack = Boolean(removeHistory && historyEntry && global.history.state && global.history.state.pointSheet);
    historyEntry = false;
    current = null;
    setClosed(false);
    if (shouldGoBack) global.history.back();
  }

  function goTo(hash) {
    if (historyEntry) { historyEntry = false; current = null; setClosed(true);
      global.location.replace(global.location.pathname + global.location.search + hash); }
    else global.location.hash = hash;
  }

  function open(spotId, pointId) {
    const target = findTarget(spotId, pointId);
    if (!target) return;
    const root = ensureSection();
    const alreadyOpen = !root.hidden && root.classList.contains('is-open');
    current = { spotId, pointId };
    render(target);
    if (!alreadyOpen) {
      if (!historyEntry) {
        global.history.pushState({ ...(global.history.state || {}), pointSheet: true }, '');
        historyEntry = true;
      }
      if (closeTimer !== null) {
        global.clearTimeout(closeTimer);
        closeTimer = null;
      }
      root.hidden = false;
      root.classList.remove('is-open');
      if (reduceMotion()) root.classList.add('is-open');
      else global.requestAnimationFrame(() => { if (current && section) section.classList.add('is-open'); });
    }
  }

  function onPopState() {
    if (!historyEntry) return;
    historyEntry = false;
    current = null;
    setClosed(false);
  }

  function onKeyDown(event) {
    if (event.key === 'Escape' && section && !section.hidden) close(true);
  }

  function onHashChange() {
    if (!current) return;
    const match = (global.location.hash || '').match(/^#\/spot\/([^/?]+)/);
    let nextSpotId = null;
    if (match) {
      try { nextSpotId = decodeURIComponent(match[1]); } catch (error) { nextSpotId = match[1]; }
    }
    if (nextSpotId !== current.spotId) close(false);
  }

  function onSpotStateChange() {
    if (!current) return;
    const state = global.App && global.App.state;
    if (!state || state.currentSpotId !== current.spotId) {
      close(false);
      return;
    }
    const target = findTarget(current.spotId, current.pointId);
    if (target) render(target);
    else close(false);
  }

  function observeDetailScreen() {
    const detailScreen = document.getElementById('detail-screen');
    if (!detailScreen || !global.MutationObserver) return;
    detailObserver = new global.MutationObserver(() => {
      if (!detailScreen.hidden && detailScreen.getAttribute('hidden') === null) return;
      if (current) close(false);
    });
    detailObserver.observe(detailScreen, { attributes: true, attributeFilter: ['hidden'] });
  }

  global.addEventListener('popstate', onPopState);
  global.addEventListener('hashchange', onHashChange);
  global.addEventListener('spotstatechange', onSpotStateChange);
  document.addEventListener('keydown', onKeyDown);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', observeDetailScreen, { once: true });
  else observeDetailScreen();

  global.PointSheet = { open, close: () => close(true) };
})(globalThis);
