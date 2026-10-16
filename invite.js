/**
 * 초대 링크 처리 및 사진 EXIF 위치만을 이용한 업로드 검증
 * 공개 API: globalThis.Invite
 */
(function (global) {
  'use strict';

  const INVITE_HASH = '300f78f7832575e9662b101b4a0f80df0a566ccfaec1270655525cae55ffcbc8';
  const STORAGE_KEY = 'our-season-invite';
  let pageOnlyInvite = null;

  function isUsableRecord(value) {
    return Boolean(value && value.hash === INVITE_HASH && Number.isFinite(value.expiresAt) && value.expiresAt > Date.now());
  }

  function readStoredInvite() {
    for (const storageName of ['localStorage', 'sessionStorage']) {
      try {
        const storage = global[storageName];
        if (!storage) continue;
        const raw = storage.getItem(STORAGE_KEY);
        if (!raw) continue;
        const value = JSON.parse(raw);
        if (isUsableRecord(value)) return value;
      } catch (error) {
        // 저장소 접근이 막힌 환경에서는 다른 저장소 또는 페이지 메모리를 사용합니다.
      }
    }
    return null;
  }

  function isActive() {
    if (isUsableRecord(pageOnlyInvite)) return true;
    pageOnlyInvite = null;
    return Boolean(readStoredInvite());
  }

  function toHex(buffer) {
    return Array.from(new Uint8Array(buffer), byte => byte.toString(16).padStart(2, '0')).join('');
  }

  function removeInviteParameter() {
    try {
      const url = new URL(global.location.href);
      if (!url.searchParams.has('invite')) return null;
      const inviteValue = url.searchParams.get('invite');
      url.searchParams.delete('invite');
      global.history.replaceState(global.history.state, '', `${url.pathname}${url.search}${url.hash}`);
      return inviteValue;
    } catch (error) {
      return null;
    }
  }

  function showAppliedNotice() {
    const notice = document.createElement('div');
    notice.setAttribute('role', 'status');
    notice.setAttribute('aria-live', 'polite');
    notice.textContent = '초대 링크가 적용됐어요. 현장이 아니어도 위치 정보가 있는 사진을 올릴 수 있어요.';
    Object.assign(notice.style, {
      position: 'fixed',
      left: '16px',
      right: '16px',
      bottom: 'calc(16px + env(safe-area-inset-bottom, 0px))',
      zIndex: '10000',
      padding: '12px 16px',
      borderRadius: '12px',
      background: '#24352d',
      color: '#fff',
      fontSize: '13px',
      lineHeight: '1.5',
      textAlign: 'center',
      boxShadow: '0 4px 18px rgba(0,0,0,.22)'
    });
    (document.body || document.documentElement).appendChild(notice);
    global.setTimeout(() => notice.remove(), 3000);
  }

  function saveInvite() {
    const record = { hash: INVITE_HASH, expiresAt: Date.now() + 30 * 24 * 60 * 60 * 1000 };
    pageOnlyInvite = record;
    const serialized = JSON.stringify(record);
    try {
      global.localStorage.setItem(STORAGE_KEY, serialized);
      return;
    } catch (error) {
      // localStorage 불가 시 sessionStorage를 시도합니다.
    }
    try {
      global.sessionStorage.setItem(STORAGE_KEY, serialized);
    } catch (error) {
      // 둘 다 불가하면 pageOnlyInvite가 현재 페이지에서만 초대 상태를 유지합니다.
    }
  }

  async function applyInviteFromUrl() {
    const inviteValue = removeInviteParameter();
    if (inviteValue === null) return;
    try {
      if (!global.crypto || !global.crypto.subtle || typeof global.crypto.subtle.digest !== 'function' || typeof global.TextEncoder !== 'function') return;
      const digest = await global.crypto.subtle.digest('SHA-256', new global.TextEncoder().encode(inviteValue));
      if (toHex(digest) !== INVITE_HASH) return;
      saveInvite();
      showAppliedNotice();
      global.dispatchEvent(new CustomEvent('inviteactivated'));
    } catch (error) {
      // 해시를 계산할 수 없는 환경에서는 URL을 정리한 뒤 초대 권한을 적용하지 않습니다.
    }
  }

  function getPhotoPoints(spot) {
    if (!spot || !Array.isArray(spot.points)) return [];
    return spot.points.filter(point => point && Number.isFinite(Number(point.latitude)) && Number.isFinite(Number(point.longitude)))
      .map(point => ({
        id: point.id || null,
        name: point.name || '촬영 지점',
        latitude: Number(point.latitude),
        longitude: Number(point.longitude),
        radiusMeters: Number(point.radiusMeters) > 0 ? Number(point.radiusMeters) : 500
      }));
  }

  function addError(errorItems, reasons, error) {
    errorItems.push(error);
    reasons.push(`[${error.title}] ${error.message}`);
  }

  async function validatePhotoOnly(file, spot) {
    const errorItems = [];
    const reasons = [];
    const details = { photoLocation: null, matchedPoint: null };
    const points = getPhotoPoints(spot);
    const spotName = spot && spot.name || '해당 명소';

    if (!points.length) {
      const error = {
        code: 'SPOT_POINTS_MISSING',
        type: 'spot_configuration_error',
        title: '촬영 지점 정보를 확인할 수 없습니다',
        message: `${spotName}의 촬영 지점 좌표가 등록되어 있지 않습니다.`
      };
      addError(errorItems, reasons, error);
      return { isValid: false, pointId: null, errorItems, reasons, details };
    }

    let photoLocation;
    try {
      photoLocation = await global.ExifGpsReader.extractGpsCoordinates(file);
    } catch (error) {
      const parseError = {
        code: 'PHOTO_PARSE_ERROR',
        type: 'photo_parse_error',
        title: '사진 파일 분석 오류',
        message: `사진 메타데이터를 분석하는 중 오류가 발생했습니다: ${error.message || '알 수 없는 오류'}`
      };
      addError(errorItems, reasons, parseError);
      return { isValid: false, pointId: null, errorItems, reasons, details };
    }

    if (!photoLocation || !Number.isFinite(Number(photoLocation.latitude)) || !Number.isFinite(Number(photoLocation.longitude))) {
      addError(errorItems, reasons, global.UploadValidator.ERROR_MESSAGES.PHOTO_NO_GPS());
      return { isValid: false, pointId: null, errorItems, reasons, details };
    }

    details.photoLocation = photoLocation;
    const distances = points.map(point => ({
      point,
      distanceMeters: global.GeoCalculator.getDistanceInMeters(
        Number(photoLocation.latitude),
        Number(photoLocation.longitude),
        point.latitude,
        point.longitude
      )
    })).sort((a, b) => a.distanceMeters - b.distanceMeters);
    const matched = distances.find(item => item.distanceMeters <= item.point.radiusMeters);

    if (!matched) {
      const closest = distances[0];
      const error = global.UploadValidator.ERROR_MESSAGES.PHOTO_FAR(
        `${spotName} · ${closest.point.name}`,
        closest.distanceMeters,
        closest.point.radiusMeters,
        false
      );
      addError(errorItems, reasons, error);
      return { isValid: false, pointId: null, errorItems, reasons, details };
    }

    details.matchedPoint = matched.point;
    return { isValid: true, pointId: matched.point.id, errorItems, reasons, details };
  }

  // URL의 초대 코드는 주소창에서 즉시 지우고, 비동기로 해시를 확인합니다.
  applyInviteFromUrl();

  global.Invite = Object.freeze({ isActive, validatePhotoOnly });
})(globalThis);
