/* 전체 화면 사진 확대 보기: global.FreePhotoViewer.open(photoUrl, caption) */
(function (global) {
  'use strict';

  let overlay = null;
  let stage = null;
  let image = null;
  let captionNode = null;
  let isOpen = false;
  let scale = 1;
  let translateX = 0;
  let translateY = 0;
  let gesture = null;
  let lastTap = null;
  let suppressClickUntil = 0;
  let historyId = null;
  let bodyOverflow = '';
  let htmlOverflow = '';

  function ensureOverlay() {
    if (overlay) return;
    overlay = document.createElement('div');
    overlay.className = 'free-photo-viewer-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-label', '사진 크게 보기');
    overlay.hidden = true;
    overlay.innerHTML = '<button class="free-photo-viewer-close" type="button" aria-label="닫기"></button><div class="free-photo-viewer-stage"><img class="free-photo-viewer-image" alt="" draggable="false"><p class="free-photo-viewer-caption"></p></div>';
    document.body.appendChild(overlay);
    stage = overlay.querySelector('.free-photo-viewer-stage');
    image = overlay.querySelector('.free-photo-viewer-image');
    captionNode = overlay.querySelector('.free-photo-viewer-caption');
    overlay.querySelector('.free-photo-viewer-close').addEventListener('click', () => close(true));
    overlay.addEventListener('click', event => {
      if (Date.now() < suppressClickUntil) return;
      if ((event.target === overlay || event.target === stage) && scale <= 1) close(true);
    });
    image.addEventListener('dblclick', event => {
      event.preventDefault();
      toggleZoom(event.clientX, event.clientY);
    });
    overlay.addEventListener('touchstart', onTouchStart, { passive: false });
    overlay.addEventListener('touchmove', onTouchMove, { passive: false });
    overlay.addEventListener('touchend', onTouchEnd, { passive: false });
    overlay.addEventListener('touchcancel', () => { gesture = null; lastTap = null; }, { passive: true });
    global.addEventListener('keydown', onKeyDown);
    global.addEventListener('popstate', onPopState);
  }

  function onKeyDown(event) {
    if (isOpen && event.key === 'Escape') {
      event.preventDefault();
      close(true);
    }
  }

  function stateMarker(state) {
    return state && typeof state === 'object' ? state.__freePhotoViewer : null;
  }

  function onPopState(event) {
    const marker = stateMarker(event.state);
    if (marker && marker.id === historyId) {
      if (!isOpen) activate(marker.photoUrl, marker.caption, false, marker.id);
      return;
    }
    if (isOpen) deactivate();
  }

  function activate(photoUrl, caption, pushEntry, id) {
    ensureOverlay();
    historyId = id || historyId || `free-photo-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    image.src = photoUrl || '';
    image.alt = caption || '우리 동네 기록 사진';
    captionNode.textContent = caption || '';
    scale = 1;
    translateX = 0;
    translateY = 0;
    gesture = null;
    lastTap = null;
    updateTransform();
    bodyOverflow = document.body.style.overflow;
    htmlOverflow = document.documentElement.style.overflow;
    document.body.style.overflow = 'hidden';
    document.documentElement.style.overflow = 'hidden';
    overlay.hidden = false;
    isOpen = true;
    if (pushEntry) {
      const oldState = global.history.state;
      const nextState = oldState && typeof oldState === 'object' ? { ...oldState } : {};
      nextState.__freePhotoViewer = { id: historyId, photoUrl: photoUrl || '', caption: caption || '' };
      global.history.pushState(nextState, '', global.location.href);
    }
  }

  function deactivate() {
    if (!isOpen) return;
    isOpen = false;
    gesture = null;
    lastTap = null;
    overlay.hidden = true;
    image.removeAttribute('src');
    document.body.style.overflow = bodyOverflow;
    document.documentElement.style.overflow = htmlOverflow;
  }

  function close(goBack) {
    if (!isOpen) return;
    const shouldGoBack = Boolean(goBack && stateMarker(global.history.state) && stateMarker(global.history.state).id === historyId);
    deactivate();
    if (shouldGoBack) global.history.back();
  }

  function stagePoint(clientX, clientY) {
    const rect = stage.getBoundingClientRect();
    return { x: clientX - rect.left - rect.width / 2, y: clientY - rect.top - rect.height / 2 };
  }

  function getBaseSize() {
    if (!image.naturalWidth || !image.naturalHeight || !stage) return { width: 0, height: 0 };
    const rect = stage.getBoundingClientRect();
    const fit = Math.min(rect.width / image.naturalWidth, rect.height / image.naturalHeight, 1);
    return { width: image.naturalWidth * fit, height: image.naturalHeight * fit };
  }

  function constrainTranslation(x, y, nextScale) {
    const base = getBaseSize();
    const rect = stage.getBoundingClientRect();
    const maxX = Math.max(0, (base.width * nextScale - rect.width) / 2);
    const maxY = Math.max(0, (base.height * nextScale - rect.height) / 2);
    return { x: Math.max(-maxX, Math.min(maxX, x)), y: Math.max(-maxY, Math.min(maxY, y)) };
  }

  function updateTransform() {
    if (!image) return;
    if (scale <= 1) {
      scale = 1;
      translateX = 0;
      translateY = 0;
    } else {
      const bounded = constrainTranslation(translateX, translateY, scale);
      translateX = bounded.x;
      translateY = bounded.y;
    }
    image.style.transform = `translate3d(${translateX}px, ${translateY}px, 0) scale(${scale})`;
  }

  function zoomAt(nextScale, clientX, clientY) {
    const point = stagePoint(clientX, clientY);
    const imageX = (point.x - translateX) / scale;
    const imageY = (point.y - translateY) / scale;
    scale = Math.max(1, Math.min(4, nextScale));
    if (scale <= 1) {
      translateX = 0;
      translateY = 0;
    } else {
      translateX = point.x - imageX * scale;
      translateY = point.y - imageY * scale;
    }
    updateTransform();
  }

  function toggleZoom(clientX, clientY) {
    if (scale > 1) zoomAt(1, clientX, clientY);
    else zoomAt(2.5, clientX, clientY);
  }

  function touchDistance(a, b) {
    return Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
  }

  function touchMidpoint(a, b) {
    return { x: (a.clientX + b.clientX) / 2, y: (a.clientY + b.clientY) / 2 };
  }

  function onTouchStart(event) {
    if (!isOpen) return;
    // 닫기 버튼 터치는 가로채지 않아야 확대 중에도 버튼이 눌린다.
    if (event.target && event.target.closest && event.target.closest('.free-photo-viewer-close')) {
      gesture = null;
      return;
    }
    event.preventDefault();
    suppressClickUntil = Date.now() + 500;
    if (event.touches.length >= 2) {
      const a = event.touches[0], b = event.touches[1];
      const midpoint = touchMidpoint(a, b);
      const point = stagePoint(midpoint.x, midpoint.y);
      gesture = {
        type: 'pinch', distance: Math.max(1, touchDistance(a, b)), scale,
        tx: translateX, ty: translateY,
        imageX: (point.x - translateX) / scale,
        imageY: (point.y - translateY) / scale
      };
      lastTap = null;
    } else if (event.touches.length === 1) {
      const touch = event.touches[0];
      gesture = { type: 'single', x: touch.clientX, y: touch.clientY, tx: translateX, ty: translateY, time: Date.now(), moved: false, onImage: event.target === image };
    }
  }

  function onTouchMove(event) {
    if (!isOpen || !gesture) return;
    event.preventDefault();
    if (event.touches.length >= 2) {
      if (gesture.type !== 'pinch') {
        const a = event.touches[0], b = event.touches[1];
        const midpoint = touchMidpoint(a, b);
        const point = stagePoint(midpoint.x, midpoint.y);
        gesture = { type: 'pinch', distance: Math.max(1, touchDistance(a, b)), scale, tx: translateX, ty: translateY, imageX: (point.x - translateX) / scale, imageY: (point.y - translateY) / scale };
      }
      const a = event.touches[0], b = event.touches[1];
      const midpoint = touchMidpoint(a, b);
      const point = stagePoint(midpoint.x, midpoint.y);
      scale = Math.max(1, Math.min(4, gesture.scale * touchDistance(a, b) / gesture.distance));
      translateX = point.x - gesture.imageX * scale;
      translateY = point.y - gesture.imageY * scale;
      updateTransform();
      return;
    }
    if (event.touches.length === 1 && gesture.type === 'single') {
      const touch = event.touches[0];
      const dx = touch.clientX - gesture.x;
      const dy = touch.clientY - gesture.y;
      if (Math.abs(dx) + Math.abs(dy) > 6) gesture.moved = true;
      if (scale > 1 && gesture.moved) {
        translateX = gesture.tx + dx;
        translateY = gesture.ty + dy;
        updateTransform();
      }
    }
  }

  function onTouchEnd(event) {
    if (!isOpen || !gesture) return;
    event.preventDefault();
    const current = gesture;
    if (current.type === 'single' && !current.moved && Date.now() - current.time < 350 && event.changedTouches.length) {
      const touch = event.changedTouches[0];
      const now = Date.now();
      const isDoubleTap = current.onImage && lastTap && now - lastTap.time < 330 && Math.hypot(touch.clientX - lastTap.x, touch.clientY - lastTap.y) < 36;
      if (isDoubleTap) {
        lastTap = null;
        toggleZoom(touch.clientX, touch.clientY);
      } else if (current.onImage) {
        lastTap = { x: touch.clientX, y: touch.clientY, time: now };
      } else {
        lastTap = null;
        if (scale <= 1) close(true);
      }
    }
    gesture = event.touches.length ? { type: 'multitouch-ended' } : null;
  }

  function open(photoUrl, caption) {
    if (isOpen) {
      image.src = photoUrl || '';
      image.alt = caption || '우리 동네 기록 사진';
      captionNode.textContent = caption || '';
      scale = 1;
      translateX = 0;
      translateY = 0;
      updateTransform();
      const marker = stateMarker(global.history.state);
      if (marker && marker.id === historyId) {
        const state = { ...global.history.state, __freePhotoViewer: { id: historyId, photoUrl: photoUrl || '', caption: caption || '' } };
        global.history.replaceState(state, '', global.location.href);
      }
      return;
    }
    const id = `free-photo-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    historyId = id;
    const oldState = global.history.state;
    const nextState = oldState && typeof oldState === 'object' ? { ...oldState } : {};
    nextState.__freePhotoViewer = { id, photoUrl: photoUrl || '', caption: caption || '' };
    global.history.pushState(nextState, '', global.location.href);
    activate(photoUrl, caption, false, id);
  }

  global.FreePhotoViewer = Object.freeze({ open });
})(globalThis);
