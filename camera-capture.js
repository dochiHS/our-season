(function (global) {
  'use strict';

  const DIRECTIONS = ['북쪽', '북동쪽', '동쪽', '남동쪽', '남쪽', '남서쪽', '서쪽', '북서쪽'];
  const HISTORY_MARKER = '__cameraCaptureBack';
  let activeSession = null;

  function isSupported() {
    const media = global.navigator && global.navigator.mediaDevices;
    const host = global.location && global.location.hostname;
    const local = host === 'localhost' || host === '127.0.0.1' || host === '[::1]' || host === '::1';
    return !!(media && typeof media.getUserMedia === 'function' && global.location && (global.location.protocol === 'https:' || local));
  }

  function normalize(degrees) {
    return ((degrees % 360) + 360) % 360;
  }

  function directionName(degrees) {
    return DIRECTIONS[Math.round(normalize(degrees) / 45) % 8];
  }

  function makeElement(tag, className, text) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text != null) element.textContent = text;
    return element;
  }

  function requestOrientationPermission() {
    const Orientation = global.DeviceOrientationEvent;
    if (Orientation && typeof Orientation.requestPermission === 'function') {
      try {
        return Promise.resolve(Orientation.requestPermission()).then(function (result) {
          return result === 'granted';
        }, function () {
          return false;
        });
      } catch (_) {
        return Promise.resolve(false);
      }
    }
    return Promise.resolve(true);
  }

  function open() {
    if (activeSession) return activeSession.promise;

    let resolveOpen;
    const session = {
      done: false,
      promise: new Promise(function (resolve) { resolveOpen = resolve; }),
      resolve: resolveOpen,
      stream: null,
      watchId: null,
      orientationEvent: null,
      orientationHandler: null,
      orientationPermissionGranted: false,
      iosOrientation: false,
      iosAlphaOffset: null,
      headingSamples: [],
      heading: null,
      latestPosition: null,
      positionWaiter: null,
      captureWaitTimer: null,
      captureToken: 0,
      capturedFile: null,
      capturedUrl: null,
      photoResult: null,
      bodyOverflow: '',
      historyId: 'camera-' + Date.now() + '-' + Math.random().toString(36).slice(2),
      onPopState: null,
      messageTimer: null,
      overlay: null,
      video: null,
      still: null,
      directionLabel: null,
      statusLabel: null,
      shutterButton: null,
      retakeButton: null,
      useButton: null,
      saveButton: null,
      historyPushed: false
    };
    activeSession = session;

    buildOverlay(session);
    installHistory(session);
    startLocationWatch(session);

    // Call the iOS permission API synchronously from open(), while it is still a user gesture.
    const orientationPermission = requestOrientationPermission();
    let mediaRequest;
    try {
      mediaRequest = global.navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: 'environment' },
          width: { ideal: 4032 },
          height: { ideal: 3024 }
        },
        audio: false
      });
    } catch (error) {
      mediaRequest = Promise.reject(error);
    }
    const settledMediaRequest = Promise.resolve(mediaRequest).then(function (stream) {
      return { stream: stream };
    }, function (error) {
      return { error: error };
    });

    orientationPermission.then(function (granted) {
      if (session.done) return;
      session.orientationPermissionGranted = granted;
      session.iosOrientation = !!(global.DeviceOrientationEvent && typeof global.DeviceOrientationEvent.requestPermission === 'function');
      if (granted) startOrientation(session);
      updateDirectionLabel(session);
    });

    settledMediaRequest.then(function (result) {
      if (session.done) {
        if (result.stream) result.stream.getTracks().forEach(function (track) { track.stop(); });
        return;
      }
      if (result.error) {
        showCameraError(session);
        return;
      }
      session.stream = result.stream;
      session.video.srcObject = result.stream;
      const playResult = session.video.play();
      if (playResult && typeof playResult.catch === 'function') playResult.catch(function () {});
      session.video.addEventListener('loadedmetadata', function () {
        if (!session.done && session.video.videoWidth > 0) session.shutterButton.disabled = false;
      }, { once: true });
      if (session.video.readyState >= 1 && session.video.videoWidth > 0) session.shutterButton.disabled = false;
    });

    return session.promise;
  }

  function buildOverlay(session) {
    const overlay = makeElement('div', 'camera-capture-overlay');
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-label', '카메라 촬영');

    const video = makeElement('video', 'camera-capture-video');
    video.autoplay = true;
    video.muted = true;
    video.playsInline = true;
    video.setAttribute('aria-label', '카메라 미리보기');

    const still = makeElement('img', 'camera-capture-still');
    still.alt = '촬영한 사진 미리보기';
    still.hidden = true;

    const top = makeElement('div', 'camera-capture-top');
    const closeButton = makeElement('button', 'camera-capture-close', '×');
    closeButton.type = 'button';
    closeButton.setAttribute('aria-label', '닫기');
    closeButton.addEventListener('click', function () { finish(session, null, false); });
    const direction = makeElement('div', 'camera-capture-direction', '방향 센서 없음');
    const spacer = makeElement('div', 'camera-capture-top-spacer');
    top.append(closeButton, direction, spacer);

    const bottom = makeElement('div', 'camera-capture-bottom');
    const status = makeElement('div', 'camera-capture-status');
    status.setAttribute('aria-live', 'polite');
    const shutter = makeElement('button', 'camera-capture-shutter', '');
    shutter.type = 'button';
    shutter.setAttribute('aria-label', '사진 촬영');
    shutter.disabled = true;
    shutter.addEventListener('click', function () { takePhoto(session); });

    const review = makeElement('div', 'camera-capture-review');
    review.hidden = true;
    const retake = makeElement('button', 'camera-capture-action', '다시 찍기');
    const use = makeElement('button', 'camera-capture-action camera-capture-action-primary', '이 사진 쓰기');
    const save = makeElement('button', 'camera-capture-action', '폰에 저장');
    [retake, use, save].forEach(function (button) { button.type = 'button'; });
    retake.addEventListener('click', function () { retakePhoto(session); });
    use.addEventListener('click', function () {
      if (!session.photoResult || use.disabled) return;
      finish(session, session.photoResult, false);
    });
    save.addEventListener('click', function () { savePhoto(session); });
    review.append(retake, use, save);

    bottom.append(status, shutter, review);
    overlay.append(video, still, top, bottom);
    document.body.appendChild(overlay);

    session.bodyOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    session.overlay = overlay;
    session.video = video;
    session.still = still;
    session.directionLabel = direction;
    session.statusLabel = status;
    session.shutterButton = shutter;
    session.retakeButton = retake;
    session.useButton = use;
    session.saveButton = save;
  }

  function installHistory(session) {
    session.onPopState = function (event) {
      const state = event.state;
      const marker = state && typeof state === 'object' ? state[HISTORY_MARKER] : null;
      if (marker !== session.historyId) finish(session, null, true);
    };
    global.addEventListener('popstate', session.onPopState);
    try {
      const base = global.history.state && typeof global.history.state === 'object' ? global.history.state : {};
      const next = Object.assign({}, base);
      next[HISTORY_MARKER] = session.historyId;
      global.history.pushState(next, '', global.location.href);
      session.historyPushed = true;
    } catch (_) {
      session.historyPushed = false;
    }
  }

  function startLocationWatch(session) {
    const geolocation = global.navigator && global.navigator.geolocation;
    if (!geolocation || typeof geolocation.watchPosition !== 'function') return;
    try {
      session.watchId = geolocation.watchPosition(function (position) {
        if (session.done || !position || !position.coords) return;
        session.latestPosition = {
          lat: position.coords.latitude,
          lng: position.coords.longitude,
          accuracy: position.coords.accuracy
        };
        if (session.positionWaiter) {
          const waiter = session.positionWaiter;
          session.positionWaiter = null;
          waiter(session.latestPosition);
        }
      }, function () {}, { enableHighAccuracy: true });
    } catch (_) {
      session.watchId = null;
    }
  }

  function startOrientation(session) {
    if (session.done || !session.orientationPermissionGranted || !global.addEventListener) return;
    const eventName = session.iosOrientation ? 'deviceorientation' : 'deviceorientationabsolute';
    session.orientationEvent = eventName;
    session.orientationHandler = function (event) { updateHeadingFromEvent(session, event); };
    global.addEventListener(eventName, session.orientationHandler, true);
  }

  function updateHeadingFromEvent(session, event) {
    if (session.done) return;
    const alpha = Number(event.alpha);
    const beta = Number(event.beta);
    const gamma = Number(event.gamma);

    if (session.iosOrientation) {
      const webkitHeading = Number(event.webkitCompassHeading);
      const hasWebkitHeading = Number.isFinite(webkitHeading);
      if (Number.isFinite(beta) && Number.isFinite(gamma) && Math.abs(beta) < 45 && Math.abs(gamma) < 45 && hasWebkitHeading && Number.isFinite(alpha) && session.iosAlphaOffset === null) {
        session.iosAlphaOffset = (360 - webkitHeading) - alpha;
      }
      if (session.iosAlphaOffset === null && hasWebkitHeading) {
        addHeadingSample(session, normalize(webkitHeading));
        return;
      }
    }

    if (!Number.isFinite(alpha) || !Number.isFinite(beta) || !Number.isFinite(gamma)) {
      session.heading = null;
      updateDirectionLabel(session);
      return;
    }

    const adjustedAlpha = session.iosOrientation && session.iosAlphaOffset !== null ? alpha + session.iosAlphaOffset : alpha;
    const a = adjustedAlpha * Math.PI / 180;
    const b = beta * Math.PI / 180;
    const g = gamma * Math.PI / 180;
    const east = -Math.cos(a) * Math.sin(g) - Math.sin(a) * Math.sin(b) * Math.cos(g);
    const north = -Math.sin(a) * Math.sin(g) + Math.cos(a) * Math.sin(b) * Math.cos(g);
    const magnitude = Math.sqrt(east * east + north * north);
    if (magnitude < 0.3) {
      session.heading = null;
      updateDirectionLabel(session);
      return;
    }
    const heading = normalize(Math.atan2(east, north) * 180 / Math.PI);
    addHeadingSample(session, heading);
  }

  function addHeadingSample(session, heading) {
    session.headingSamples.push(heading);
    if (session.headingSamples.length > 10) session.headingSamples.shift();
    let sinTotal = 0;
    let cosTotal = 0;
    session.headingSamples.forEach(function (value) {
      const radians = value * Math.PI / 180;
      sinTotal += Math.sin(radians);
      cosTotal += Math.cos(radians);
    });
    if (Math.hypot(sinTotal, cosTotal) < 0.000001) {
      session.heading = heading;
    } else {
      session.heading = normalize(Math.atan2(sinTotal, cosTotal) * 180 / Math.PI);
    }
    updateDirectionLabel(session);
  }

  function updateDirectionLabel(session) {
    if (!session.directionLabel) return;
    if (session.heading === null || !Number.isFinite(session.heading)) {
      session.directionLabel.textContent = '방향 센서 없음';
      return;
    }
    const rounded = Math.round(normalize(session.heading)) % 360;
    session.directionLabel.textContent = directionName(rounded) + ' ' + rounded + '°';
  }

  function showCameraError(session) {
    session.statusLabel.textContent = '카메라를 쓸 수 없어요. 설정에서 카메라 권한을 허용해 주세요.';
    session.statusLabel.classList.add('camera-capture-error');
    session.shutterButton.hidden = true;
    session.messageTimer = global.setTimeout(function () { finish(session, null, false); }, 1800);
  }

  function takePhoto(session) {
    if (session.done || session.capturedFile || session.video.videoWidth <= 0 || session.video.videoHeight <= 0) return;
    session.shutterButton.disabled = true;
    session.statusLabel.textContent = '';
    const captureTime = Date.now();
    const headingAtCapture = session.heading === null || !Number.isFinite(session.heading)
      ? null
      : Math.round(normalize(session.heading)) % 360;
    const positionAtCapture = session.latestPosition;
    const width = session.video.videoWidth;
    const height = session.video.videoHeight;
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) {
      session.statusLabel.textContent = '사진을 만들지 못했어요. 다시 시도해 주세요.';
      session.shutterButton.disabled = false;
      return;
    }
    try {
      context.drawImage(session.video, 0, 0, width, height);
    } catch (_) {
      session.statusLabel.textContent = '사진을 만들지 못했어요. 다시 시도해 주세요.';
      session.shutterButton.disabled = false;
      return;
    }
    canvas.toBlob(function (blob) {
      if (session.done || !blob) {
        if (!session.done) {
          session.statusLabel.textContent = '사진을 만들지 못했어요. 다시 시도해 주세요.';
          session.shutterButton.disabled = false;
        }
        return;
      }
      const takenAt = new Date(captureTime).toISOString();
      let file;
      try {
        file = new File([blob], 'camera-' + captureTime + '.jpg', { type: 'image/jpeg', lastModified: captureTime });
      } catch (_) {
        session.statusLabel.textContent = '사진을 만들지 못했어요. 다시 시도해 주세요.';
        session.shutterButton.disabled = false;
        return;
      }
      session.capturedFile = file;
      session.photoResult = { file: file, heading: headingAtCapture, lat: null, lng: null, accuracy: null, takenAt: takenAt };
      session.capturedUrl = URL.createObjectURL(file);
      session.still.src = session.capturedUrl;
      session.still.hidden = false;
      session.video.hidden = true;
      session.shutterButton.hidden = true;
      session.overlay.classList.add('camera-capture-reviewing');
      session.retakeButton.hidden = false;
      session.useButton.disabled = true;
      session.saveButton.disabled = false;
      session.overlay.querySelector('.camera-capture-review').hidden = false;

      const token = ++session.captureToken;
      session.statusLabel.textContent = positionAtCapture ? '' : '위치를 확인하고 있어요…';
      waitForPosition(session, positionAtCapture, captureTime).then(function (position) {
        if (session.done || token !== session.captureToken || !session.photoResult) return;
        if (position) {
          session.photoResult.lat = position.lat;
          session.photoResult.lng = position.lng;
          session.photoResult.accuracy = position.accuracy;
        }
        session.statusLabel.textContent = '';
        session.useButton.disabled = false;
      });
    }, 'image/jpeg', 0.92);
  }

  function waitForPosition(session, existingPosition, captureTime) {
    if (existingPosition) return Promise.resolve(existingPosition);
    return new Promise(function (resolve) {
      let settled = false;
      function finishWait(position) {
        if (settled) return;
        settled = true;
        if (session.captureWaitTimer !== null) {
          global.clearTimeout(session.captureWaitTimer);
          session.captureWaitTimer = null;
        }
        if (session.positionWaiter === finishWait) session.positionWaiter = null;
        resolve(position || null);
      }
      session.positionWaiter = finishWait;
      const remaining = Math.max(0, 5000 - (Date.now() - captureTime));
      session.captureWaitTimer = global.setTimeout(function () { finishWait(null); }, remaining);
      if (session.latestPosition) finishWait(session.latestPosition);
    });
  }

  function retakePhoto(session) {
    if (session.done) return;
    session.captureToken += 1;
    cancelPositionWait(session);
    if (session.capturedUrl) URL.revokeObjectURL(session.capturedUrl);
    session.capturedUrl = null;
    session.capturedFile = null;
    session.photoResult = null;
    session.still.removeAttribute('src');
    session.still.hidden = true;
    session.video.hidden = false;
    session.shutterButton.hidden = false;
    session.shutterButton.disabled = false;
    session.overlay.classList.remove('camera-capture-reviewing');
    session.overlay.querySelector('.camera-capture-review').hidden = true;
    session.statusLabel.textContent = '';
    const playResult = session.video.play();
    if (playResult && typeof playResult.catch === 'function') playResult.catch(function () {});
  }

  function cancelPositionWait(session) {
    if (session.captureWaitTimer !== null) {
      global.clearTimeout(session.captureWaitTimer);
      session.captureWaitTimer = null;
    }
    if (session.positionWaiter) {
      const waiter = session.positionWaiter;
      session.positionWaiter = null;
      waiter(null);
    }
  }

  function savePhoto(session) {
    if (!session.capturedFile || !session.capturedUrl) return;
    const link = document.createElement('a');
    link.href = session.capturedUrl;
    link.download = session.capturedFile.name;
    link.hidden = true;
    document.body.appendChild(link);
    link.click();
    link.remove();
  }

  function finish(session, result, fromPopState) {
    if (session.done) return;
    session.done = true;
    if (session.messageTimer !== null) global.clearTimeout(session.messageTimer);
    cancelPositionWait(session);
    if (session.watchId !== null && global.navigator.geolocation) {
      try { global.navigator.geolocation.clearWatch(session.watchId); } catch (_) {}
      session.watchId = null;
    }
    if (session.orientationEvent && session.orientationHandler) {
      global.removeEventListener(session.orientationEvent, session.orientationHandler, true);
    }
    if (session.stream) {
      session.stream.getTracks().forEach(function (track) { track.stop(); });
      session.stream = null;
    }
    if (session.video) session.video.srcObject = null;
    if (session.capturedUrl) {
      URL.revokeObjectURL(session.capturedUrl);
      session.capturedUrl = null;
    }
    if (session.onPopState) global.removeEventListener('popstate', session.onPopState);
    if (session.overlay && session.overlay.parentNode) session.overlay.parentNode.removeChild(session.overlay);
    document.body.style.overflow = session.bodyOverflow;
    if (activeSession === session) activeSession = null;

    const shouldGoBack = !fromPopState && session.historyPushed && global.history.state && global.history.state[HISTORY_MARKER] === session.historyId;
    session.resolve(result || null);
    if (shouldGoBack) {
      try { global.history.back(); } catch (_) {}
    }
  }

  global.CameraCapture = Object.freeze({ open: open, isSupported: isSupported });
})(window);
