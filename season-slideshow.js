(function (global) {
  'use strict';

  const INTERVAL_MS = 2500;
  const SEASONS = ['spring', 'summer', 'autumn', 'winter'];
  const section = document.getElementById('season-slideshow');
  const detailScreen = document.getElementById('detail-screen');
  const matrix = document.getElementById('photo-matrix');
  const reducedMotion = global.matchMedia ? global.matchMedia('(prefers-reduced-motion: reduce)') : { matches: false };
  let slides = [];
  let selectedSeason = null;
  let timerId = null;
  let pointerDown = false;
  let swipeStart = null;
  let swipeLayer = null;
  let swipeActive = false;
  let swipeCancelled = false;
  let suppressNextClick = false;
  let initialized = false;

  function appState() {
    return global.App && global.App.state ? global.App.state : null;
  }

  function imageOf(slide) {
    return slide && (slide.image || slide.dataUrl) || '';
  }

  function newestPhoto(photos) {
    return photos.slice().sort((a, b) => {
      const timeA = Date.parse(a.uploadedAt || '') || 0;
      const timeB = Date.parse(b.uploadedAt || '') || 0;
      return timeB - timeA;
    })[0] || null;
  }

  function collectSlides() {
    const state = appState();
    const spotId = state && state.currentSpotId;
    const pointId = state && state.currentPointId;
    const spotData = global.SpotData;
    if (!section || !state || !spotId || !spotData) return [];

    const seasons = Array.isArray(spotData.SEASONS) ? spotData.SEASONS : SEASONS;
    const seasonNames = spotData.SEASONS_KO || {};
    return seasons.map(season => {
      const photo = newestPhoto((state.approvedPhotos || []).filter(item =>
        item.spotId === spotId && item.pointId === pointId && item.season === season
      ));
      if (photo && photo.dataUrl) {
        return { season, seasonName: seasonNames[season] || season, image: photo.dataUrl, isReference: false, credit: '' };
      }

      const references = global.ReferencePhotos && typeof global.ReferencePhotos.getReferencePhotos === 'function'
        ? global.ReferencePhotos.getReferencePhotos(spotId, season)
        : [];
      const reference = references && references[0];
      if (reference && reference.image) {
        return {
          season,
          seasonName: seasonNames[season] || season,
          image: reference.image,
          isReference: true,
          credit: global.ReferencePhotos.creditOf(reference)
        };
      }
      return null;
    }).filter(Boolean);
  }

  function currentIndex() {
    return slides.findIndex(slide => slide.season === selectedSeason);
  }

  function preloadNext() {
    if (slides.length < 2) return;
    const index = currentIndex();
    const next = slides[(index < 0 ? 0 : index + 1) % slides.length];
    const image = imageOf(next);
    if (image) {
      const preload = new global.Image();
      preload.src = image;
    }
  }

  function updateActiveSlide() {
    if (!section) return;
    const layers = section.querySelectorAll('.season-slideshow-photo');
    layers.forEach(layer => {
      const active = layer.dataset.season === selectedSeason;
      layer.classList.toggle('is-active', active);
      layer.setAttribute('aria-hidden', active ? 'false' : 'true');
      layer.tabIndex = active ? 0 : -1;
    });
    section.querySelectorAll('.season-slideshow-dot').forEach(dot => {
      const active = dot.dataset.season === selectedSeason;
      dot.classList.toggle('is-active', active);
      dot.setAttribute('aria-pressed', active ? 'true' : 'false');
    });
  }

  function stopTimer() {
    if (timerId !== null) global.clearTimeout(timerId);
    timerId = null;
  }

  function canAdvance() {
    return slides.length > 1
      && !reducedMotion.matches
      && !pointerDown
      && !document.hidden
      && detailScreen
      && !detailScreen.hidden
      && section
      && !section.hidden;
  }

  function scheduleTick() {
    stopTimer();
    if (!canAdvance()) return;
    timerId = global.setTimeout(() => {
      timerId = null;
      if (!canAdvance()) return;
      const index = currentIndex();
      const next = slides[(index < 0 ? 0 : index + 1) % slides.length];
      selectedSeason = next.season;
      updateActiveSlide();
      preloadNext();
      scheduleTick();
    }, INTERVAL_MS);
  }

  function syncTimer() {
    if (!canAdvance()) stopTimer();
    else if (timerId === null) scheduleTick();
  }

  function selectSeason(season, restartTimer) {
    if (!slides.some(slide => slide.season === season)) return;
    selectedSeason = season;
    updateActiveSlide();
    preloadNext();
    if (restartTimer) scheduleTick();
  }

  function render() {
    if (!section) return;
    slides = collectSlides();
    section.replaceChildren();
    if (!slides.length) {
      selectedSeason = null;
      section.hidden = true;
      stopTimer();
      return;
    }

    const today = global.SpotData && typeof global.SpotData.getCurrentSeason === 'function'
      ? global.SpotData.getCurrentSeason()
      : SEASONS[0];
    if (reducedMotion.matches) {
      selectedSeason = slides.some(slide => slide.season === today) ? today : slides[0].season;
    } else if (!slides.some(slide => slide.season === selectedSeason)) {
      selectedSeason = slides.some(slide => slide.season === today) ? today : slides[0].season;
    }
    section.hidden = false;

    const frame = document.createElement('div');
    frame.className = 'season-slideshow-frame';
    slides.forEach(slide => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'season-slideshow-photo';
      button.dataset.season = slide.season;
      button.setAttribute('aria-label', `${slide.seasonName} 사진 크게 보기`);
      button.addEventListener('click', () => {
        const state = appState();
        if (!state || !state.currentSpotId || !state.currentPointId) return;
        global.location.hash = '#/spot/' + encodeURIComponent(state.currentSpotId)
          + '/season/' + slide.season
          + '?point=' + encodeURIComponent(state.currentPointId);
      });

      const image = document.createElement('img');
      image.src = slide.image;
      image.alt = '';
      image.setAttribute('aria-hidden', 'true');
      button.appendChild(image);

      const seasonBadge = document.createElement('span');
      seasonBadge.className = 'season-slideshow-season-badge';
      seasonBadge.textContent = slide.seasonName;
      button.appendChild(seasonBadge);

      if (slide.isReference) {
        const referenceBadge = document.createElement('span');
        referenceBadge.className = 'season-slideshow-reference-badge';
        referenceBadge.textContent = '참고 사진';
        button.appendChild(referenceBadge);

        const credit = document.createElement('span');
        credit.className = 'season-slideshow-credit';
        credit.textContent = slide.credit;
        button.appendChild(credit);
      }
      frame.appendChild(button);
    });

    if (slides.length > 1) {
      const previous = document.createElement('button');
      previous.type = 'button';
      previous.className = 'season-slideshow-prev';
      previous.textContent = '‹';
      previous.setAttribute('aria-label', '이전 계절 사진');
      previous.addEventListener('click', () => {
        const index = currentIndex();
        selectSeason(slides[(index <= 0 ? slides.length : index) - 1].season, true);
      });
      frame.appendChild(previous);

      const next = document.createElement('button');
      next.type = 'button';
      next.className = 'season-slideshow-next';
      next.textContent = '›';
      next.setAttribute('aria-label', '다음 계절 사진');
      next.addEventListener('click', () => {
        const index = currentIndex();
        selectSeason(slides[(index < 0 ? 0 : index + 1) % slides.length].season, true);
      });
      frame.appendChild(next);
    }

    frame.addEventListener('pointerdown', onFramePointerDown);
    frame.addEventListener('pointermove', onFramePointerMove);
    frame.addEventListener('pointerup', onFramePointerEnd);
    frame.addEventListener('pointercancel', onFramePointerEnd);
    frame.addEventListener('click', onFrameClickCapture, true);
    section.appendChild(frame);

    const dots = document.createElement('nav');
    dots.className = 'season-slideshow-dots';
    dots.setAttribute('aria-label', '계절별 사진 선택');
    const seasonNames = global.SpotData && global.SpotData.SEASONS_KO || {};
    SEASONS.forEach(season => {
      const slide = slides.find(item => item.season === season);
      const dot = document.createElement('button');
      dot.type = 'button';
      dot.className = 'season-slideshow-dot';
      dot.dataset.season = season;
      dot.disabled = !slide;
      dot.setAttribute('aria-label', `${seasonNames[season] || season} 사진 보기`);
      dot.setAttribute('aria-pressed', 'false');
      dot.addEventListener('click', () => selectSeason(season, true));
      const mark = document.createElement('span');
      mark.setAttribute('aria-hidden', 'true');
      dot.appendChild(mark);
      dots.appendChild(dot);
    });
    section.appendChild(dots);

    updateActiveSlide();
    preloadNext();
    syncTimer();
  }

  function onFramePointerDown(event) {
    if (event.target.closest('.season-slideshow-prev, .season-slideshow-next, .season-slideshow-dot')) return;
    swipeStart = { x: event.clientX, y: event.clientY, time: Date.now(), pointerId: event.pointerId };
    swipeLayer = event.currentTarget.querySelector('.season-slideshow-photo.is-active');
    swipeActive = false;
    swipeCancelled = false;
  }

  function onFramePointerMove(event) {
    if (!swipeStart || event.pointerId !== swipeStart.pointerId || swipeCancelled) return;
    const dx = event.clientX - swipeStart.x;
    const dy = event.clientY - swipeStart.y;
    if (!swipeActive) {
      if (Math.abs(dy) > 10 && Math.abs(dy) >= Math.abs(dx)) {
        swipeCancelled = true;
        return;
      }
      if (Math.abs(dx) <= 10 || Math.abs(dx) <= Math.abs(dy)) return;
      swipeActive = true;
      if (event.currentTarget.setPointerCapture) {
        try { event.currentTarget.setPointerCapture(event.pointerId); } catch (_) {}
      }
    }
    if (swipeLayer) {
      swipeLayer.style.transition = 'none';
      swipeLayer.style.transform = `translateX(${dx * 0.6}px)`;
    }
  }

  function onFramePointerEnd(event) {
    if (!swipeStart || event.pointerId !== swipeStart.pointerId) return;
    const dx = event.clientX - swipeStart.x;
    const elapsed = Math.max(1, Date.now() - swipeStart.time);
    const wasSwipe = swipeActive;
    if (swipeLayer) {
      swipeLayer.style.removeProperty('transition');
      swipeLayer.style.removeProperty('transform');
    }
    if (wasSwipe) {
      suppressNextClick = true;
      global.setTimeout(() => { suppressNextClick = false; }, 400);
      if (Math.abs(dx) > 40 || Math.abs(dx) / elapsed > 0.4) {
        const index = currentIndex();
        const targetIndex = dx < 0
          ? (index < 0 ? 0 : index + 1) % slides.length
          : (index <= 0 ? slides.length - 1 : index - 1);
        selectSeason(slides[targetIndex].season, true);
      }
    }
    swipeStart = null;
    swipeLayer = null;
    swipeActive = false;
    swipeCancelled = false;
  }

  function onFrameClickCapture(event) {
    if (!suppressNextClick) return;
    suppressNextClick = false;
    event.preventDefault();
    event.stopPropagation();
  }

  function onPointerDown() {
    pointerDown = true;
    stopTimer();
  }

  function onPointerUp() {
    if (!pointerDown) return;
    pointerDown = false;
    syncTimer();
  }

  function onReducedMotionChange() {
    if (reducedMotion.matches && slides.length) {
      const today = global.SpotData && global.SpotData.getCurrentSeason ? global.SpotData.getCurrentSeason() : SEASONS[0];
      selectSeason(slides.some(slide => slide.season === today) ? today : slides[0].season, false);
      stopTimer();
    } else syncTimer();
  }

  function init() {
    if (initialized || !section || !matrix) return;
    initialized = true;
    const observer = new global.MutationObserver(render);
    observer.observe(matrix, { childList: true });
    section.addEventListener('pointerdown', onPointerDown);
    global.addEventListener('pointerup', onPointerUp);
    global.addEventListener('pointercancel', onPointerUp);
    document.addEventListener('visibilitychange', syncTimer);
    if (detailScreen && global.MutationObserver) {
      const detailObserver = new global.MutationObserver(syncTimer);
      detailObserver.observe(detailScreen, { attributes: true, attributeFilter: ['hidden'] });
    }
    if (typeof reducedMotion.addEventListener === 'function') reducedMotion.addEventListener('change', onReducedMotionChange);
    else if (typeof reducedMotion.addListener === 'function') reducedMotion.addListener(onReducedMotionChange);
    render();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})(globalThis);
