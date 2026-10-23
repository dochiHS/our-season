(function (global) {
  'use strict';

  let section = null;
  let current = null;
  let historyEntry = false;
  let closeTimer = null;
  let detailObserver = null;
  let interactionReady = false;
  let activePointer = null;
  let restoreTarget = null;

  function ensureSection() {
    if (section && section.isConnected) {
      setupInteractions(section);
      return section;
    }
    section = document.getElementById('point-sheet');
    if (section) {
      setupInteractions(section);
      return section;
    }

    section = document.createElement('section');
    section.id = 'point-sheet';
    section.className = 'point-sheet';
    section.setAttribute('role', 'dialog');
    section.setAttribute('aria-labelledby', 'point-sheet-title');
    section.hidden = true;
    section.innerHTML = '<div class="point-sheet-handle" role="button" tabindex="0" aria-label="카드 펼치기" aria-expanded="false"></div><header class="point-sheet-header"><div class="point-sheet-heading"><h2 id="point-sheet-title"></h2><p class="point-sheet-spot-name"></p></div><button class="point-sheet-close" type="button" aria-label="닫기">×</button></header><p class="point-sheet-photo-count"></p><div class="point-sheet-photos"></div><div class="point-sheet-empty-state" hidden></div><p class="point-sheet-credit" hidden></p><div class="point-sheet-actions"></div><p class="point-sheet-arrival-hint" hidden></p>';
    document.body.appendChild(section);
    setupInteractions(section);
    return section;
  }

  function updateHandleState(root) {
    const handle = root && root.querySelector('.point-sheet-handle');
    if (!handle) return;
    const expanded = root.classList.contains('is-expanded');
    handle.setAttribute('aria-label', expanded ? '카드 접기' : '카드 펼치기');
    handle.setAttribute('aria-expanded', expanded ? 'true' : 'false');
  }

  function setExpanded(expanded) {
    if (!section) return;
    section.classList.toggle('is-expanded', Boolean(expanded));
    updateHandleState(section);
  }

  function toggleExpanded() {
    if (!section) return;
    setExpanded(!section.classList.contains('is-expanded'));
  }

  function pointerTime() {
    return global.performance && typeof global.performance.now === 'function' ? global.performance.now() : Date.now();
  }

  function onDragStart(event) {
    if (!section || section.hidden || !section.classList.contains('is-open')) return;
    if (event.button !== undefined && event.button !== 0) return;
    if (event.target && event.target.closest && event.target.closest('.point-sheet-close')) return;
    activePointer = {
      pointerId: event.pointerId,
      startY: event.clientY,
      startTime: pointerTime(),
      maxDistance: 0,
      root: section,
      source: event.currentTarget
    };
    try { event.currentTarget.setPointerCapture(event.pointerId); } catch (error) {}
    section.style.transition = 'none';
    event.preventDefault();
  }

  function onDragMove(event) {
    if (!activePointer || event.pointerId !== activePointer.pointerId) return;
    const dy = event.clientY - activePointer.startY;
    activePointer.maxDistance = Math.max(activePointer.maxDistance, Math.abs(dy));
    const visualDy = !activePointer.root.classList.contains('is-expanded') ? Math.max(-40, dy) : dy;
    activePointer.root.style.transform = `translateY(${visualDy}px)`;
    event.preventDefault();
  }

  function onDragEnd(event) {
    if (!activePointer || event.pointerId !== activePointer.pointerId) return;
    const drag = activePointer;
    activePointer = null;
    const dy = event.clientY - drag.startY;
    const elapsed = Math.max(1, pointerTime() - drag.startTime);
    const velocity = dy / elapsed;
    const expanded = drag.root.classList.contains('is-expanded');
    const isHandleTap = drag.source.classList.contains('point-sheet-handle') && drag.maxDistance < 5;

    drag.root.style.removeProperty('transition');
    drag.root.style.removeProperty('transform');

    if (drag.maxDistance < 5) {
      if (isHandleTap) toggleExpanded();
      return;
    }
    if (dy < -80 || velocity <= -0.5) {
      setExpanded(true);
    } else if (dy > 80 || velocity >= 0.5) {
      if (expanded) setExpanded(false);
      else close(true);
    }
  }

  function setupInteractions(root) {
    if (interactionReady || !root) return;
    interactionReady = true;
    const handle = root.querySelector('.point-sheet-handle');
    const header = root.querySelector('.point-sheet-header');
    const closeButton = root.querySelector('.point-sheet-close');
    if (handle) {
      handle.setAttribute('role', 'button');
      handle.setAttribute('tabindex', '0');
      handle.addEventListener('pointerdown', onDragStart);
      handle.addEventListener('keydown', event => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          toggleExpanded();
        }
      });
    }
    if (header) header.addEventListener('pointerdown', onDragStart);
    root.addEventListener('pointermove', onDragMove);
    root.addEventListener('pointerup', onDragEnd);
    root.addEventListener('pointercancel', onDragEnd);
    if (closeButton) closeButton.addEventListener('click', () => close(true));
    updateHandleState(root);
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
    const matching = (Array.isArray(state.approvedPhotos) ? state.approvedPhotos : [])
      .filter(photo => photo.spotId === spotId && photo.pointId === pointId)
      .slice()
      .sort((a, b) => {
        const todayDifference = Number(b.season === todaySeason) - Number(a.season === todaySeason);
        return todayDifference || String(b.uploadedAt || '').localeCompare(String(a.uploadedAt || ''));
      });
    const photos = matching
      .filter(photo => photo.dataUrl)
      .slice(0, 6)
      .map(photo => ({ season: photo.season, image: photo.dataUrl, heading: photo.heading, isReference: false }));
    return { photos, count: matching.length, seasonNames };
  }

  function render(target) {
    const root = ensureSection();
    const { state, spot, point } = target;
    const title = root.querySelector('#point-sheet-title');
    title.textContent = point.name || '';
    root.querySelector('.point-sheet-spot-name').textContent = spot.name || '';

    const { photos, count, seasonNames } = getPointPhotos(state, spot.id, point.id);
    root.querySelector('.point-sheet-photo-count').textContent = `이 자리에서 찍은 사진 ${count}장`;
    const photoStrip = root.querySelector('.point-sheet-photos');
    const emptyState = root.querySelector('.point-sheet-empty-state');
    const credit = root.querySelector('.point-sheet-credit');
    photoStrip.replaceChildren();
    emptyState.replaceChildren();
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
        button.addEventListener('click', () => {
          goTo(`#/spot/${encodeURIComponent(spot.id)}/season/${encodeURIComponent(photo.season)}?point=${encodeURIComponent(point.id)}`);
        });
        photoStrip.appendChild(button);
      });
      photoStrip.hidden = false;
      emptyState.hidden = true;
    } else {
      photoStrip.hidden = true;
      const empty = document.createElement('p');
      empty.className = 'point-sheet-empty';
      empty.textContent = '아직 이 자리에서 찍은 사진이 없어요';
      emptyState.appendChild(empty);
      const app = global.App;
      if (app && typeof app.openUploadModal === 'function') {
        const uploadButton = document.createElement('button');
        uploadButton.type = 'button';
        uploadButton.className = 'point-sheet-action point-sheet-action-secondary point-sheet-upload-button';
        uploadButton.textContent = '이 자리 사진 올리기';
        uploadButton.addEventListener('click', () => {
          const currentApp = global.App;
          if (!currentApp || typeof currentApp.openUploadModal !== 'function') return;
          const willRestoreAfterPop = Boolean(historyEntry && global.history.state && global.history.state.pointSheet);
          close(true);
          if (willRestoreAfterPop && restoreTarget) {
            restoreTarget.after = () => currentApp.openUploadModal();
          } else {
            restorePoint({ spotId: spot.id, pointId: point.id, after: null });
            currentApp.openUploadModal();
          }
        });
        emptyState.appendChild(uploadButton);
      }
      emptyState.hidden = false;
    }
    credit.hidden = true;
    credit.textContent = '';

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

  function restorePoint(target) {
    const app = global.App;
    if (app && app.state && app.state.currentSpotId === target.spotId) {
      app.state.currentPointId = target.pointId;
      if (typeof app.renderPointTabs === 'function') app.renderPointTabs();
      if (typeof app.renderSummaryCard === 'function') app.renderSummaryCard();
      if (typeof app.renderMatrix === 'function') app.renderMatrix();
      if (global.SpotMap && typeof global.SpotMap.refresh === 'function') global.SpotMap.refresh(false);
    }
    if (typeof target.after === 'function') target.after();
  }

  function runRestoreTarget() {
    if (!restoreTarget) return;
    const target = restoreTarget;
    global.setTimeout(() => {
      restorePoint(target);
      if (restoreTarget === target) restoreTarget = null;
    }, 0);
  }

  function close(removeHistory) {
    if (!section || section.hidden) {
      current = null;
      return;
    }
    const closing = current;
    const shouldGoBack = Boolean(removeHistory && historyEntry && global.history.state && global.history.state.pointSheet);
    historyEntry = false;
    current = null;
    setClosed(false);
    if (shouldGoBack) {
      if (closing) restoreTarget = { spotId: closing.spotId, pointId: closing.pointId, after: null };
      global.history.back();
    }
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
    setExpanded(false);
    root.style.removeProperty('transform');
    root.style.removeProperty('transition');
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
    if (historyEntry) {
      const closing = current;
      historyEntry = false;
      current = null;
      setClosed(false);
      if (closing) restoreTarget = { spotId: closing.spotId, pointId: closing.pointId, after: null };
    }
    runRestoreTarget();
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
