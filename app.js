(function (global) {
  'use strict';

  // 애플리케이션 상태
  const state = { spots: [], currentSpotId: null, currentPointId: null, userCoords: null, approvedPhotos: [], selectedTakenAt: null, cameraCapture: null, unverifiedChoice: null };
  const WEATHER_KO = { clear: '맑음', cloudy: '흐림', rain: '비', snow: '눈', fog: '안개', other: '기타' };
  let galleryTimeFilter = 'all', galleryWeatherFilter = 'all';
  let metadataRequestId = 0;
  const elements = {
    spotTabs: document.getElementById('spot-tabs'), spotSummaryCard: document.getElementById('spot-summary-card'),
    pointTabsSection: document.getElementById('point-tabs-section'), pointTabs: document.getElementById('point-tabs'), photoMatrix: document.getElementById('photo-matrix'),
    galleryTimeButtons: document.querySelectorAll('[data-gallery-time]'), galleryWeatherFilter: document.getElementById('gallery-weather-filter'),
    detailModal: document.getElementById('photo-detail-modal'), detailPhotoImg: document.getElementById('detail-photo-img'), detailPhotoTag: document.getElementById('detail-photo-tag'),
    detailPhotoNote: document.getElementById('detail-photo-note'), detailPhotoDate: document.getElementById('detail-photo-date'), detailPhotoCount: document.getElementById('detail-photo-count'),
    viewerNavigation: document.getElementById('viewer-navigation'), btnPreviousPhoto: document.getElementById('btn-previous-photo'), btnNextPhoto: document.getElementById('btn-next-photo'),
    viewerImageWrap: document.getElementById('viewer-image-wrap'), btnCloseDetail: document.getElementById('btn-close-detail'), uploadTargetName: document.getElementById('upload-target-name'),
    btnRequestLocation: document.getElementById('btn-request-location'), gpsStatusLabel: document.getElementById('gps-status-label'), appStatusNotice: document.getElementById('app-status-notice'),
    headerDateLine: document.getElementById('header-date-line'), headerArch: document.querySelector('.header-arch'), btnOpenUpload: document.getElementById('btn-open-upload'),
    btnUploadLabel: document.getElementById('btn-upload-label'), uploadDistanceNotice: document.getElementById('upload-distance-notice'), uploadModal: document.getElementById('upload-modal'),
    btnCloseUpload: document.getElementById('btn-close-upload'), uploadForm: document.getElementById('upload-form'), photoFileInput: document.getElementById('photo-file-input'),
    fileNamePreview: document.getElementById('file-name-preview'), seasonInput: document.getElementById('season-input'), seasonDisplay: document.getElementById('season-display'),
    weatherNoteGroup: document.getElementById('weather-note-group'), weatherNoteInput: document.getElementById('weather-note-input'), photoMemoInput: document.getElementById('photo-memo-input'),
    nicknameInput: document.getElementById('nickname-input'), validationFeedbackCard: document.getElementById('validation-feedback-card'), feedbackTitle: document.getElementById('feedback-title'),
    feedbackMessage: document.getElementById('feedback-message'), feedbackHint: document.getElementById('feedback-hint'), btnSubmitPhoto: document.getElementById('btn-submit-photo'),
    faceConfirmationCheckbox: null, faceConfirmationWarning: null
  };
  let isSubmitting = false, detailPhotos = [], detailPhotoIndex = 0, detailPhotoContext = null, swipeStartX = null;
  function getCurrentSpot() { return state.spots.find(spot => spot.id === state.currentSpotId) || null; }
  function getCurrentPoint(spot = getCurrentSpot()) { if (!spot || !Array.isArray(spot.points) || !spot.points.length) return null; return spot.points.find(point => point.id === state.currentPointId) || spot.points[0]; }
  function getSupabaseClient() { return global.OurAuth ? global.OurAuth.getClient() : null; }
  function isCameraFile(file) {
    const capture = state.cameraCapture;
    return Boolean(file && capture && file.name === capture.name && file.size === capture.size && file.lastModified === capture.lastModified);
  }
  function getSeasonView() {
    const requested = new URLSearchParams(global.location ? global.location.search : '').get('season');
    const isPreview = global.SpotData.SEASONS.includes(requested);
    return { season: isPreview ? requested : global.SpotData.getCurrentSeason(), isPreview };
  }
  function getValidationTarget(spot) {
    if (!spot || !Array.isArray(spot.points) || !spot.points.length) return null;
    return { id: spot.id, name: spot.name, points: spot.points.map(point => ({ id: point.id, name: point.name, latitude: point.lat, longitude: point.lng, radiusMeters: point.radiusMeters, description: point.description })) };
  }
  function getNearestPointStatus(spot) {
    if (!spot || !Array.isArray(spot.points) || !spot.points.length) return null;
    const nearest = spot.nearestPoint || spot.points[0]; if (!nearest) return null;
    const accuracy = state.userCoords && Number.isFinite(state.userCoords.accuracy) ? Math.min(Math.max(state.userCoords.accuracy, 0), 100) : 0;
    const withinAnyPoint = spot.points.some(point => global.GeoCalculator.getDistanceInMeters(state.userCoords.latitude, state.userCoords.longitude, point.lat, point.lng) <= (point.radiusMeters || 500) + accuracy);
    return { point: nearest, distanceMeters: spot.distanceMeters, radius: nearest.radiusMeters || 500, withinAnyPoint };
  }
  function updateCoverDate() {
    if (!elements.headerDateLine) return;
    const now = new Date(Date.now() + 9 * 60 * 60 * 1000); const { season, isPreview } = getSeasonView();
    elements.headerDateLine.textContent = `CHEONGJU · ${now.getUTCFullYear()} · ${season.toUpperCase()}${isPreview ? ' · PREVIEW' : ''}`;
    if (elements.headerArch) elements.headerArch.dataset.season = season;
  }
  function applyApprovedPhotos() {
    state.spots.forEach(spot => spot.points.forEach(point => {
      Object.values(point.grid).forEach(slots => Object.keys(slots).forEach(key => { slots[key] = []; }));
      state.approvedPhotos.filter(photo => photo.spotId === spot.id && (!photo.pointId || photo.pointId === point.id)).forEach(photo => { const slot = point.grid[photo.season] && point.grid[photo.season][photo.timeOfDay]; if (slot) slot.push(photo); });
      Object.values(point.grid).forEach(slots => Object.values(slots).forEach(photos => photos.sort((a, b) => String(b.uploadedAt || '').localeCompare(String(a.uploadedAt || '')))));
    }));
  }
  async function loadApprovedPhotos() {
    const client = getSupabaseClient();
    if (!client) { setAppNotice('Supabase 설정을 확인해 주세요. supabase-config.js에 URL과 공개 키를 입력해야 합니다.', 'error'); return; }
    try {
      const { data, error } = await client.from('season_photos').select('kind, spot_id, point_id, season, time_of_day, weather, weather_note, memo, nickname, photo_path, created_at, taken_at, heading, location_verified').eq('status', 'approved').order('created_at', { ascending: false });
      if (error) throw error;
      state.approvedPhotos = (data || []).flatMap(row => {
        const kind = typeof row.kind === 'string' ? row.kind.trim() : '';
        if (kind && kind !== 'spot') return [];
        if (!global.SpotData.TIME_OF_DAY.includes(row.time_of_day)) return [];
        const { data: publicData } = client.storage.from('season-photos').getPublicUrl(row.photo_path);
        return [{ dataUrl: publicData.publicUrl, memo: row.memo || '', nickname: row.nickname || '', spotId: row.spot_id, pointId: row.point_id, season: row.season, timeOfDay: row.time_of_day, weather: row.weather, weatherNote: row.weather_note || '', takenAt: row.taken_at || '', uploadedAt: row.created_at || row.taken_at || '', heading: row.heading ?? null, locationVerified: row.location_verified !== false }];
      });
      refreshSpots(); renderTabs(); renderSummaryCard(); renderPointTabs(); renderMatrix(); notifySpotStateChange();
    } catch (error) { setAppNotice(`승인된 사진을 불러오지 못했습니다. ${error.message || ''}`.trim(), 'error'); }
  }
  function notifySpotStateChange() { global.dispatchEvent(new Event('spotstatechange')); }
  function renderTabs() {
    if (!elements.spotTabs) return; elements.spotTabs.innerHTML = '';
    state.spots.forEach(spot => {
      const chip = document.createElement('button'); chip.type = 'button'; chip.className = `spot-tab-chip ${spot.id === state.currentSpotId ? 'active' : ''}`; chip.setAttribute('data-spot-id', spot.id);
      const name = document.createElement('span'); name.textContent = spot.name; chip.appendChild(name);
      if (spot.distanceText) { const badge = document.createElement('span'); badge.className = 'spot-distance-badge'; badge.textContent = spot.distanceText; chip.appendChild(badge); }
      chip.addEventListener('click', () => selectSpot(spot.id)); elements.spotTabs.appendChild(chip);
    });
  }
  function renderPointTabs() {
    if (!elements.pointTabs || !elements.pointTabsSection) return;
    const spot = getCurrentSpot(), points = spot && Array.isArray(spot.points) ? spot.points : [];
    elements.pointTabs.innerHTML = ''; elements.pointTabsSection.hidden = points.length <= 1; if (points.length <= 1) return;
    const current = getCurrentPoint(spot);
    points.forEach(point => {
      const chip = document.createElement('button'); chip.type = 'button'; chip.className = `spot-tab-chip ${point.id === current.id ? 'active' : ''}`; chip.textContent = point.name; chip.setAttribute('aria-pressed', point.id === current.id ? 'true' : 'false');
      chip.addEventListener('click', () => { state.currentPointId = point.id; renderSummaryCard(); renderPointTabs(); renderMatrix(); if (global.SpotMap) global.SpotMap.refresh(false); }); elements.pointTabs.appendChild(chip);
    });
  }
  function renderSummaryCard() {
    if (!elements.spotSummaryCard) return;
    const spot = getCurrentSpot();
    if (!spot) { elements.spotSummaryCard.innerHTML = '<p style="font-size:12px; color:var(--text-muted);">명소 정보를 불러올 수 없습니다.</p>'; return; }
    const point = getCurrentPoint(spot), sun = spot.sunTimes || { sunrise: '--:--', sunset: '--:--' }, radius = point && Number.isFinite(Number(point.radiusMeters)) ? Number(point.radiusMeters) : 500;
    elements.spotSummaryCard.innerHTML = `<div class="summary-header"><div><h2 class="spot-name">${spot.name}</h2><span class="point-name-badge"><img src="icon-pin.png" alt="" aria-hidden="true" class="ui-icon ui-icon-16"> ${point ? point.name : '대표 위치'} (반경 ${radius}m)</span></div><div class="sun-times-pill" title="오늘의 일출·일몰 시각"><span class="sun-item"><img src="icon-sunrise.png" alt="" aria-hidden="true" class="ui-icon ui-icon-18"> ${sun.sunrise}</span><span class="sun-sep">|</span><span class="sun-item"><img src="icon-sunset.png" alt="" aria-hidden="true" class="ui-icon ui-icon-18"> ${sun.sunset}</span></div></div><div class="spot-meta-list"><div class="meta-item"><span class="meta-icon">⏱️</span><span class="meta-label">운영시간</span><span class="meta-val">${spot.operatingHours || '상시 개방'}</span></div><div class="meta-item"><span class="meta-icon"><img src="icon-car.png" alt="" aria-hidden="true" class="ui-icon ui-icon-18"></span><span class="meta-label">주차안내</span><span class="meta-val">${spot.parking || '주차 가능'}</span></div><div class="meta-item"><span class="meta-icon"><img src="icon-memo.png" alt="" aria-hidden="true" class="ui-icon ui-icon-18"></span><span class="meta-label">주의메모</span><span class="meta-val">${spot.safetyNotice || '현장 확인 예정'}</span></div></div>`;
    if (elements.uploadTargetName) elements.uploadTargetName.textContent = `${spot.name} (${point ? point.name : '대표 위치'})`;
  }
  function renderMatrix() {
    if (!elements.photoMatrix) return; const spot = getCurrentSpot(); if (!spot) return;
    const point = getCurrentPoint(spot), { SEASONS, SEASONS_KO, TIME_OF_DAY_KO } = global.SpotData, view = getSeasonView();
    elements.photoMatrix.innerHTML = '';
    let hasVisibleReferencePhoto = false;
    SEASONS.forEach(season => {
      const photos = state.approvedPhotos
        .filter(photo => photo.spotId === spot.id && photo.pointId === (point && point.id) && photo.season === season
          && (galleryTimeFilter === 'all' || photo.timeOfDay === galleryTimeFilter)
          && (galleryWeatherFilter === 'all' || photo.weather === galleryWeatherFilter))
        .slice()
        .sort((a, b) => String(b.uploadedAt || '').localeCompare(String(a.uploadedAt || '')));
      const hasUserSeasonPhotos = state.approvedPhotos.some(photo => photo.spotId === spot.id && photo.pointId === (point && point.id) && photo.season === season);
      const filtersAreAll = galleryTimeFilter === 'all' && galleryWeatherFilter === 'all';
      const referencePhoto = filtersAreAll && !hasUserSeasonPhotos && global.ReferencePhotos
        ? global.ReferencePhotos.getReferencePhotos(spot.id, season)[0]
        : null;
      if (referencePhoto) hasVisibleReferencePhoto = true;
      const current = season === view.season;
      const pile = document.createElement('button'); pile.type = 'button'; pile.className = `season-pile${current ? ' is-current-season' : ''}${photos.length || referencePhoto ? ' has-photos' : ' is-empty'}`;
      pile.setAttribute('aria-label', `${SEASONS_KO[season]} 사진 ${photos.length ? `${photos.length}장` : referencePhoto ? '관광공사 참고 사진' : '0장'}${photos.length || referencePhoto ? ', 사진 보기' : ''}`);
      if (current) { pile.setAttribute('aria-current', view.isPreview ? 'true' : 'date'); pile.title = view.isPreview ? `현재 강조 계절: ${SEASONS_KO[season]} (미리보기)` : '오늘 날짜 기준 현재 계절'; }
      const stack = document.createElement('span'); stack.className = 'season-pile-stack';
      if (photos.length) {
        if (photos.length >= 2) {
          const backOne = document.createElement('span'); backOne.className = 'season-pile-back season-pile-back-one'; backOne.setAttribute('aria-hidden', 'true');
          const backOneImage = document.createElement('img'); backOneImage.className = 'season-pile-back-photo'; backOneImage.src = photos[1].dataUrl; backOneImage.alt = ''; backOneImage.loading = 'lazy'; backOne.appendChild(backOneImage);
          stack.appendChild(backOne);
          if (photos.length >= 3) {
            const backTwo = document.createElement('span'); backTwo.className = 'season-pile-back season-pile-back-two'; backTwo.setAttribute('aria-hidden', 'true');
            const backTwoImage = document.createElement('img'); backTwoImage.className = 'season-pile-back-photo'; backTwoImage.src = photos[2].dataUrl; backTwoImage.alt = ''; backTwoImage.loading = 'lazy'; backTwo.appendChild(backTwoImage);
            stack.appendChild(backTwo);
          }
        }
        const cover = document.createElement('span'); cover.className = 'season-pile-cover';
        const img = document.createElement('img'); img.src = photos[0].dataUrl; img.alt = `${spot.name} ${SEASONS_KO[season]} 최근 승인 사진`; img.loading = 'lazy'; cover.appendChild(img);
        const tags = document.createElement('span'); tags.className = 'season-pile-tags';
        const timeTag = document.createElement('span'); timeTag.textContent = TIME_OF_DAY_KO[photos[0].timeOfDay] || '시간 미상';
        const weatherTag = document.createElement('span'); weatherTag.textContent = WEATHER_KO[photos[0].weather] || '날씨 미상';
        tags.append(timeTag, weatherTag); cover.appendChild(tags); stack.appendChild(cover);
      } else if (referencePhoto) {
        const cover = document.createElement('span'); cover.className = 'season-pile-cover';
        const img = document.createElement('img'); img.src = referencePhoto.thumb; img.alt = `${spot.name} ${SEASONS_KO[season]} 참고 사진`; img.loading = 'lazy'; cover.appendChild(img);
        const badge = document.createElement('span'); badge.className = 'reference-photo-badge'; badge.textContent = '참고 사진'; cover.appendChild(badge);
        stack.appendChild(cover);
      } else {
        const empty = document.createElement('span'); empty.className = 'season-pile-empty'; empty.textContent = '아직 사진이 없어요'; stack.appendChild(empty);
      }
      const caption = document.createElement('span'); caption.className = 'season-pile-caption';
      const seasonName = document.createElement('span'); seasonName.className = 'season-pile-name'; seasonName.textContent = SEASONS_KO[season];
      const count = document.createElement('span'); count.className = 'season-pile-count'; count.textContent = referencePhoto ? '관광공사 사진' : `사진 ${photos.length}장`;
      caption.append(seasonName, count); pile.append(stack, caption);
      pile.addEventListener('click', () => { if (global.Screens && typeof global.Screens.navigateSeason === 'function') global.Screens.navigateSeason(spot.id, season); });
      elements.photoMatrix.appendChild(pile);
    });
    if (hasVisibleReferencePhoto) {
      const referenceCredit = document.createElement('p'); referenceCredit.className = 'matrix-reference-credit';
      referenceCredit.textContent = '참고 사진 출처: ⓒ한국관광콘텐츠랩 (공공누리 제1유형)';
      elements.photoMatrix.appendChild(referenceCredit);
    }
  }
  function renderDetailPhoto() {
    if (!detailPhotos.length || !detailPhotoContext) return;
    const photo = detailPhotos[detailPhotoIndex], { spotName, seasonKey, timeKey } = detailPhotoContext, { SEASONS_KO, TIME_OF_DAY_KO } = global.SpotData;
    const timeLabel = TIME_OF_DAY_KO[photo.timeOfDay || timeKey] || TIME_OF_DAY_KO[timeKey] || '시간 미상';
    const weather = photo.weather === 'other' ? (photo.weatherNote || WEATHER_KO.other) : (WEATHER_KO[photo.weather] || '날씨 미상');
    elements.detailPhotoImg.src = photo.dataUrl; elements.detailPhotoTag.textContent = `${spotName} · ${SEASONS_KO[seasonKey]} · ${timeLabel} · ${weather}`;
    const notes = []; if (photo.nickname) notes.push(photo.nickname); if (photo.memo) notes.push(`“${photo.memo}”`); elements.detailPhotoNote.textContent = notes.join(' · ');
    elements.detailPhotoDate.textContent = photo.uploadedAt ? `등록일: ${photo.uploadedAt}` : '';
    const multiple = detailPhotos.length > 1; elements.viewerNavigation.hidden = !multiple; elements.detailPhotoCount.textContent = `${detailPhotoIndex + 1} / ${detailPhotos.length}`; elements.btnPreviousPhoto.disabled = detailPhotoIndex === 0; elements.btnNextPhoto.disabled = detailPhotoIndex === detailPhotos.length - 1;
  }
  function openPhotoDetail(photos, index, spotName, seasonKey, timeKey) { if (!elements.detailModal || !Array.isArray(photos) || !photos.length) return; detailPhotos = photos; detailPhotoIndex = Math.max(0, Math.min(index, detailPhotos.length - 1)); detailPhotoContext = { spotName, seasonKey, timeKey }; renderDetailPhoto(); elements.detailModal.classList.add('open'); }
  function showPreviousPhoto() { if (detailPhotoIndex > 0) { detailPhotoIndex -= 1; renderDetailPhoto(); } }
  function showNextPhoto() { if (detailPhotoIndex < detailPhotos.length - 1) { detailPhotoIndex += 1; renderDetailPhoto(); } }
  function closePhotoDetail() { if (!elements.detailModal) return; elements.detailModal.classList.remove('open'); elements.detailPhotoImg.src = ''; detailPhotos = []; detailPhotoIndex = 0; detailPhotoContext = null; swipeStartX = null; }
  function selectSpot(id) { state.currentSpotId = id; const spot = getCurrentSpot(); state.currentPointId = spot && spot.points.length ? spot.points[0].id : null; renderTabs(); renderSummaryCard(); renderPointTabs(); renderMatrix(); updateUploadButton(); if (global.SpotMap) global.SpotMap.refresh(true); }
  function refreshSpots() {
    const oldSpot = state.currentSpotId, oldPoint = state.currentPointId, coords = state.userCoords ? { lat: state.userCoords.latitude, lng: state.userCoords.longitude } : null;
    state.spots = global.SpotData.getSpotsSortedByDistance(coords); applyApprovedPhotos(); state.currentSpotId = state.spots.some(spot => spot.id === oldSpot) ? oldSpot : state.spots.length ? state.spots[0].id : null;
    const spot = getCurrentSpot(); state.currentPointId = spot && spot.points.some(point => point.id === oldPoint) ? oldPoint : spot && spot.points.length ? spot.points[0].id : null;
  }
  async function requestUserLocation(showError) {
    try {
      state.userCoords = await global.UploadValidator.getCurrentUserPosition(); if (elements.gpsStatusLabel) elements.gpsStatusLabel.textContent = '위치 확인됨'; if (elements.btnRequestLocation) elements.btnRequestLocation.classList.add('is-active');
      setAppNotice('', ''); refreshSpots(); renderTabs(); renderSummaryCard(); renderPointTabs(); renderMatrix(); updateUploadButton(); notifySpotStateChange(); return true;
    } catch (error) { if (showError) setAppNotice(error.message || '현재 위치를 확인할 수 없습니다.', 'error'); return false; }
  }
  function setUploadDistanceNotice(message) { if (!elements.uploadDistanceNotice) return; elements.uploadDistanceNotice.textContent = message || ''; elements.uploadDistanceNotice.hidden = !message; }
  function setAppNotice(message, status) { if (!elements.appStatusNotice) return; elements.appStatusNotice.textContent = message || ''; elements.appStatusNotice.className = 'app-status-notice'; if (status) elements.appStatusNotice.classList.add(`is-${status}`); elements.appStatusNotice.hidden = !message; }
  function setupBottomBarHeightObserver() {
    const bar = document.querySelector('.floating-bottom-bar');
    if (!bar || !global.ResizeObserver) return;
    const updateHeight = () => {
      const height = bar.getBoundingClientRect().height;
      document.documentElement.style.setProperty('--bottom-bar-height', `${height}px`);
    };
    const observer = new global.ResizeObserver(updateHeight);
    observer.observe(bar);
    if (elements.uploadDistanceNotice) observer.observe(elements.uploadDistanceNotice);
    updateHeight();
  }
  function updateUploadButton() {
    const spot = getCurrentSpot(); if (!spot || !elements.btnOpenUpload || !elements.btnUploadLabel) return; elements.btnOpenUpload.classList.remove('state-ready', 'state-locked', 'state-unknown');
    // 명소 사진은 현장 밖에서도 언제든 올릴 수 있다. 위치는 사진 정보(또는 앱 카메라)로 확인한다.
    elements.btnOpenUpload.classList.add('state-ready');
    elements.btnUploadLabel.textContent = '이 명소 사진 올리기';
    const status = state.userCoords ? getNearestPointStatus(spot) : null;
    setUploadDistanceNotice(status && status.withinAnyPoint ? '지금 현장에 있어요 · 바로 찍어서 올릴 수 있어요' : '이곳에서 찍은 사진이면 언제든 올릴 수 있어요');
  }
  function setFeedback(status, title, message, hint) { if (!elements.validationFeedbackCard) return; elements.validationFeedbackCard.className = 'validation-feedback-box'; if (status) elements.validationFeedbackCard.classList.add(status); elements.feedbackTitle.textContent = title || ''; elements.feedbackMessage.textContent = message || ''; elements.feedbackMessage.style.whiteSpace = 'pre-line'; elements.feedbackHint.textContent = hint || ''; }
  function getCaptureSeason(takenAt) { const date = takenAt ? new Date(takenAt) : new Date(); return global.SpotData.getCurrentSeason(Number.isNaN(date.getTime()) ? new Date() : date); }
  function formatKstDate(date) { const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date); const values = Object.fromEntries(parts.map(part => [part.type, part.value])); return `${values.year}.${values.month}.${values.day}`; }
  function updateSeasonDisplay(takenAt) { const season = getCaptureSeason(takenAt); if (elements.seasonInput) elements.seasonInput.value = season; if (elements.seasonDisplay) elements.seasonDisplay.value = `${global.SpotData.SEASONS_KO[season]} · ${takenAt ? `촬영일 ${formatKstDate(new Date(takenAt))}` : '오늘 날짜 기준'}`; if (elements.headerArch) elements.headerArch.dataset.season = season; }
  function updateWeatherNoteVisibility() { if (!elements.weatherNoteGroup) return; const weather = elements.uploadForm && new FormData(elements.uploadForm).get('weather'); elements.weatherNoteGroup.hidden = weather !== 'other'; if (weather !== 'other' && elements.weatherNoteInput) elements.weatherNoteInput.value = ''; }
  function setupFaceConfirmation() {
    if (!elements.btnSubmitPhoto || !elements.uploadForm || !elements.btnSubmitPhoto.parentNode) return;
    const group = document.createElement('div'); group.className = 'face-confirmation-group';
    const label = document.createElement('label'); label.className = 'face-confirmation';
    const checkbox = document.createElement('input'); checkbox.type = 'checkbox'; checkbox.id = 'face-confirmation-checkbox';
    const text = document.createTextNode('다른 사람 얼굴이 알아볼 수 있게 찍히지 않았어요');
    label.append(checkbox, text);
    const warning = document.createElement('p'); warning.className = 'face-confirmation-warning'; warning.id = 'face-confirmation-warning';
    warning.setAttribute('role', 'status'); warning.textContent = '얼굴이 보이는 사진은 올릴 수 없어요'; warning.hidden = true;
    label.setAttribute('for', checkbox.id); label.setAttribute('aria-describedby', warning.id);
    group.append(label, warning); elements.btnSubmitPhoto.parentNode.insertBefore(group, elements.btnSubmitPhoto);
    elements.faceConfirmationCheckbox = checkbox; elements.faceConfirmationWarning = warning;
    checkbox.addEventListener('change', updateSubmitAvailability);
    updateSubmitAvailability();
  }
  function setupCameraCaptureButton() {
    if (!elements.photoFileInput) return;
    const photoGroup = elements.photoFileInput.closest('.form-group');
    const picker = photoGroup && photoGroup.querySelector('label[for="photo-file-input"]');
    if (!photoGroup || !picker || photoGroup.querySelector('.upload-method-bar')) return;
    const bar = document.createElement('div');
    bar.className = 'upload-method-bar';
    bar.style.cssText = 'display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin: 0 0 10px;';
    const makeMethod = (title, hint) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.style.cssText = 'display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 2px; min-height: 52px; padding: 8px 6px; border: 1px solid var(--bg-border); border-radius: var(--radius-md); background: var(--bg-primary); color: var(--color-primary-dark); font: inherit; cursor: pointer;';
      const strong = document.createElement('span'); strong.textContent = title; strong.style.cssText = 'font-size: 13px; font-weight: 700;';
      const small = document.createElement('span'); small.textContent = hint; small.style.cssText = 'font-size: 10px; color: var(--text-muted);';
      button.append(strong, small);
      return button;
    };
    const cameraSupported = global.CameraCapture && typeof global.CameraCapture.isSupported === 'function' && global.CameraCapture.isSupported();
    if (cameraSupported) {
      const cameraButton = makeMethod('지금 여기서 찍기', '방향·위치 자동 저장');
      cameraButton.className = 'upload-method-camera';
      bar.appendChild(cameraButton);
      cameraButton.addEventListener('click', async () => {
        // 이미 알고 있는 위치가 반경 밖이면 카메라를 열지 않는다. 모르면 카메라를 열고 등록할 때 찍은 위치로 확인한다.
        const spot = getCurrentSpot(), known = state.userCoords && spot ? getNearestPointStatus(spot) : null;
        if (known && !known.withinAnyPoint) { setFeedback('status-error', '현장에 도착하면 쓸 수 있어요', '앱 카메라는 촬영 지점 반경 안에서만 쓸 수 있어요. 찍어 둔 사진은 오른쪽 버튼으로 올려 주세요.'); return; }
        try {
          const result = await global.CameraCapture.open();
          if (!result) return;
          state.cameraCapture = { name: result.file.name, size: result.file.size, lastModified: result.file.lastModified, heading: result.heading, lat: result.lat, lng: result.lng, accuracy: result.accuracy, takenAt: result.takenAt };
          const transfer = new global.DataTransfer();
          transfer.items.add(result.file);
          elements.photoFileInput.files = transfer.files;
          elements.photoFileInput.dispatchEvent(new global.Event('change', { bubbles: true }));
          if (global.PhotoHeading && typeof global.PhotoHeading.setCameraHeading === 'function') global.PhotoHeading.setCameraHeading(elements.uploadForm, result.file, result.heading);
        } catch (error) {
          state.cameraCapture = null;
          setFeedback('status-error', '카메라 사진을 선택하지 못했어요.', '다시 시도해 주세요.');
        }
      });
    } else {
      bar.style.gridTemplateColumns = '1fr';
    }
    const galleryButton = makeMethod('찍어 둔 사진 올리기', '폰·카메라로 찍은 사진');
    galleryButton.className = 'upload-method-gallery';
    galleryButton.addEventListener('click', () => elements.photoFileInput.click());
    bar.appendChild(galleryButton);
    photoGroup.insertBefore(bar, picker);
  }
  function fileKey(file) { return file ? `${file.name}|${file.size}|${file.lastModified}` : ''; }
  function clearUnverifiedBox() { state.unverifiedChoice = null; const box = document.getElementById('unverified-upload-box'); if (box) box.remove(); }
  function showUnverifiedBox(spot, file) {
    clearUnverifiedBox();
    if (!elements.btnSubmitPhoto || !elements.btnSubmitPhoto.parentNode) return;
    const box = document.createElement('div');
    box.id = 'unverified-upload-box';
    box.style.cssText = 'margin: 0 0 12px; padding: 12px; border: 1px solid var(--bg-border); border-radius: var(--radius-md); background: var(--bg-primary);';
    const text = document.createElement('p');
    text.textContent = "사진에 위치 정보가 없어요. 찍은 지점을 고르면 '위치 미확인'으로 올릴 수 있어요. (하루 3장)";
    text.style.cssText = 'margin: 0 0 10px; font-size: 12px; line-height: 1.5; color: var(--text-secondary);';
    const chips = document.createElement('div');
    chips.style.cssText = 'display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 10px;';
    const confirm = document.createElement('button');
    confirm.type = 'button';
    confirm.textContent = '위치 미확인으로 올리기';
    confirm.disabled = true;
    confirm.className = 'btn-submit-upload';
    let chosen = null;
    (spot.points || []).forEach(point => {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.textContent = point.name;
      chip.style.cssText = 'min-height: 36px; padding: 6px 12px; border: 1px solid var(--bg-border); border-radius: 999px; background: var(--bg-surface); color: var(--text-primary); font: inherit; font-size: 12px; cursor: pointer;';
      chip.addEventListener('click', () => {
        chosen = point.id;
        chips.querySelectorAll('button').forEach(item => { const on = item === chip; item.style.background = on ? 'var(--color-primary)' : 'var(--bg-surface)'; item.style.color = on ? '#fff' : 'var(--text-primary)'; });
        confirm.disabled = false;
      });
      chips.appendChild(chip);
    });
    confirm.addEventListener('click', () => {
      if (!chosen || isSubmitting) return;
      state.unverifiedChoice = { key: fileKey(file), pointId: chosen };
      if (elements.uploadForm && typeof elements.uploadForm.requestSubmit === 'function') elements.uploadForm.requestSubmit();
      else if (elements.btnSubmitPhoto) elements.btnSubmitPhoto.click();
    });
    box.append(text, chips, confirm);
    elements.btnSubmitPhoto.parentNode.insertBefore(box, elements.btnSubmitPhoto);
  }
  function resetUploadForm() { if (elements.uploadForm) elements.uploadForm.reset(); state.cameraCapture = null; clearUnverifiedBox(); if (elements.faceConfirmationCheckbox) elements.faceConfirmationCheckbox.checked = false; state.selectedTakenAt = null; metadataRequestId += 1; if (elements.fileNamePreview) elements.fileNamePreview.textContent = '사진 선택하기'; updateSeasonDisplay(null); updateWeatherNoteVisibility(); setFeedback('', '', '', ''); updateSubmitAvailability(); updateSelectedChips(); }
  function updateSubmitAvailability() {
    const hasFile = Boolean(elements.photoFileInput && elements.photoFileInput.files.length);
    const faceConfirmed = Boolean(elements.faceConfirmationCheckbox && elements.faceConfirmationCheckbox.checked);
    if (elements.faceConfirmationWarning) elements.faceConfirmationWarning.hidden = faceConfirmed;
    if (elements.btnSubmitPhoto) elements.btnSubmitPhoto.disabled = isSubmitting || !hasFile || !faceConfirmed;
  }
  function updateSelectedChips() { document.querySelectorAll('#upload-form input[type="radio"]').forEach(input => { const label = input.closest('.chip-option'); if (label) label.classList.toggle('selected', input.checked); }); }
  async function readSelectedPhotoTime(file) {
    const request = ++metadataRequestId;
    state.selectedTakenAt = null;
    updateSeasonDisplay(null);
    if (isCameraFile(file)) {
      state.selectedTakenAt = state.cameraCapture.takenAt || null;
      updateSeasonDisplay(state.selectedTakenAt);
      return;
    }
    if (!file || !global.ExifGpsReader || typeof global.ExifGpsReader.extractDateTimeOriginal !== 'function') return;
    try { const takenAt = await global.ExifGpsReader.extractDateTimeOriginal(file); if (request !== metadataRequestId || !elements.photoFileInput || elements.photoFileInput.files[0] !== file) return; state.selectedTakenAt = takenAt || null; updateSeasonDisplay(state.selectedTakenAt); } catch (error) { if (request !== metadataRequestId) return; state.selectedTakenAt = null; updateSeasonDisplay(null); }
  }
  async function openUploadModal(forceLocationCheck) {
    const user = await global.OurAuth.requireLogin();
    if (!user) return false;
    const spot = getCurrentSpot(); if (!spot) return false;
    const point = getCurrentPoint(spot), radius = point && Number.isFinite(Number(point.radiusMeters)) ? Number(point.radiusMeters) : 500;
    const radiusNotice = document.querySelector('.upload-sub-text');
    if (radiusNotice) radiusNotice.textContent = `촬영 지점 반경 ${radius}m 안에서 찍은 사진 (위치 정보 필요)`;
    resetUploadForm(); if (elements.uploadModal) elements.uploadModal.classList.add('open'); return true;
  }
  function closeUploadModal() { if (elements.uploadModal) elements.uploadModal.classList.remove('open'); }
  function createRandomUuid() { if (global.crypto && typeof global.crypto.randomUUID === 'function') return global.crypto.randomUUID(); if (!global.crypto || typeof global.crypto.getRandomValues !== 'function') throw new Error('안전한 무작위 ID를 만들 수 없습니다. HTTPS 환경에서 다시 시도해 주세요.'); const bytes = new Uint8Array(16); global.crypto.getRandomValues(bytes); bytes[6] = (bytes[6] & 15) | 64; bytes[8] = (bytes[8] & 63) | 128; return Array.from(bytes, (byte, index) => { const value = byte.toString(16).padStart(2, '0'); return [4, 6, 8, 10].includes(index) ? `-${value}` : value; }).join(''); }
  function validateNickname(value) { const nickname = value.trim(), length = Array.from(nickname).length; if (length < 1 || length > 20) throw new Error('닉네임을 1~20자로 입력해 주세요.'); return nickname; }
  function validateWeatherNote(value) { const note = value.trim(); if (Array.from(note).length > 10) throw new Error('날씨 메모는 10자 이하로 입력해 주세요.'); return note; }
  async function handlePhotoSubmit(event) {
    event.preventDefault(); if (isSubmitting) return;
    if (!elements.faceConfirmationCheckbox || !elements.faceConfirmationCheckbox.checked) return;
    const file = elements.photoFileInput && elements.photoFileInput.files[0], spot = getCurrentSpot(), target = getValidationTarget(spot);
    if (!file || !target) { setFeedback('status-error', '사진과 명소 정보를 확인해 주세요.', '등록할 사진을 선택한 뒤 다시 시도해 주세요.'); return; }
    const cameraFile = isCameraFile(file);
    const form = new FormData(elements.uploadForm), timeOfDay = form.get('time_of_day'), weather = form.get('weather'), memo = elements.photoMemoInput ? elements.photoMemoInput.value.trim() : ''; let weatherNote, nickname;
    try { if (!global.SpotData.TIME_OF_DAY.includes(timeOfDay)) throw new Error('시간대 항목을 선택해 주세요.'); if (!Object.prototype.hasOwnProperty.call(WEATHER_KO, weather)) throw new Error('날씨 항목을 선택해 주세요.'); weatherNote = validateWeatherNote(elements.weatherNoteInput ? elements.weatherNoteInput.value : ''); nickname = validateNickname(elements.nicknameInput ? elements.nicknameInput.value : ''); }
    catch (error) { setFeedback('status-error', '입력 내용을 확인해 주세요.', error.message); if (error.message.includes('닉네임') && elements.nicknameInput) elements.nicknameInput.focus(); else if (error.message.includes('날씨 메모') && elements.weatherNoteInput) elements.weatherNoteInput.focus(); return; }
    const invited = global.Invite && global.Invite.isActive();
    isSubmitting = true; updateSubmitAvailability();
    setFeedback('status-checking', '위치와 사진 정보를 확인하고 있습니다.', cameraFile ? '앱 카메라로 찍은 위치와 촬영 지점을 확인합니다.' : '사진 속 위치가 촬영 지점 반경 안인지 확인합니다.');
    try {
      const client = getSupabaseClient(); if (!client) throw new Error('Supabase 설정을 확인해 주세요. supabase-config.js에 URL과 공개 키를 입력해야 합니다.');
      let validation, locationVerified = true;
      if (cameraFile) {
        const capture = state.cameraCapture;
        if (!capture || !Number.isFinite(capture.lat) || !Number.isFinite(capture.lng)) {
          setFeedback('status-error', '찍을 때 위치를 확인하지 못했어요', '위치 권한을 켜고 다시 찍어 주세요.');
          return;
        }
        const nearest = spot.points.map(point => {
          const radiusMeters = Number(point.radiusMeters) > 0 ? Number(point.radiusMeters) : 500;
          return {
            point,
            radiusMeters,
            distanceMeters: global.GeoCalculator.getDistanceInMeters(capture.lat, capture.lng, point.lat, point.lng)
          };
        }).sort((a, b) => a.distanceMeters - b.distanceMeters)[0];
        if (!nearest || nearest.distanceMeters > nearest.radiusMeters) {
          if (!nearest) {
            setFeedback('status-error', '촬영 지점 정보를 확인할 수 없어요.', '다시 시도해 주세요.');
            return;
          }
          setFeedback('status-error', '촬영 지점 반경 밖에서 찍은 사진이에요', `가장 가까운 지점(${nearest.point.name})까지 ${Math.round(nearest.distanceMeters)}m예요. 반경 ${Math.round(nearest.radiusMeters)}m 안에서 다시 찍어 주세요.`);
          return;
        }
        validation = { isValid: true, pointId: nearest.point.id, details: { photoLocation: { takenAt: capture.takenAt || null } } };
      } else if (state.unverifiedChoice && state.unverifiedChoice.key === fileKey(file)) {
        // 위치 정보가 없는 사진: 사용자가 고른 지점으로 '위치 미확인' 등록 (DB가 자격·하루 3장을 다시 확인한다)
        locationVerified = false;
        let allowed = false;
        try { const { data, error } = await client.rpc('can_upload_unverified'); allowed = !error && data === true; } catch (error) { allowed = false; }
        if (!allowed) { clearUnverifiedBox(); setFeedback('status-error', '오늘은 위치 미확인 사진을 더 올릴 수 없어요.', '위치 미확인 사진은 하루 3장까지 올릴 수 있어요.'); return; }
        validation = { isValid: true, pointId: state.unverifiedChoice.pointId, details: {} };
      } else {
        // 찍어 둔 사진: 현재 위치는 보지 않고 사진 속 위치만 확인한다.
        validation = await global.Invite.validatePhotoOnly(file, target);
        const noGps = !validation.isValid && (validation.errorItems || []).some(item => item && item.code === 'PHOTO_GPS_MISSING');
        if (noGps) {
          let allowed = false;
          try { const { data, error } = await client.rpc('can_upload_unverified'); allowed = !error && data === true; } catch (error) { allowed = false; }
          if (allowed) { setFeedback('', '', '', ''); showUnverifiedBox(spot, file); return; }
          setFeedback('status-error', '사진에 위치 정보가 없어요', "카메라 앱 위치 연동(소니 Creators' App, 캐논 Camera Connect, 니콘 SnapBridge, 후지 XApp)을 켜고 찍은 사진을 올려 주세요. 위치가 확인된 사진이 한 번 승인되면, 위치 없는 사진도 '위치 미확인'으로 올릴 수 있어요.");
          return;
        }
      }
      if (!validation.isValid) { const errors = validation.errorItems || [], message = errors.length === 1 ? errors[0].message : errors.map(item => `${item.title}: ${item.message}`).join('\n\n'); setFeedback('status-error', errors.length === 1 ? errors[0].title : `${errors.length}가지 확인이 필요합니다.`, message || (validation.reasons || []).join('\n')); return; }
      const capturedAt = (validation.details && validation.details.photoLocation && validation.details.photoLocation.takenAt) || state.selectedTakenAt || null; state.selectedTakenAt = capturedAt; const season = getCaptureSeason(capturedAt); updateSeasonDisplay(capturedAt);
      setFeedback('status-checking', '위치 검증을 통과했습니다.', '사진을 웹용 크기로 압축하고 Supabase에 저장합니다.');
      const compressed = await global.ImageCompressor.compressImage(file), photoPath = `${spot.id}/${createRandomUuid()}.jpg`;
      let user = await global.OurAuth.getUser();
      if (!user) user = await global.OurAuth.requireLogin();
      if (!user) { setFeedback('status-error', '로그인이 필요해요.', '로그인이 풀렸어요. 다시 로그인한 뒤 등록해 주세요.'); return; }
      const { error: uploadError } = await client.storage.from('season-photos').upload(photoPath, compressed.blob, { cacheControl: '3600', contentType: 'image/jpeg', upsert: false }); if (uploadError) throw uploadError;
      const { error: insertError } = await client.from('season_photos').insert({ spot_id: spot.id, point_id: validation.pointId, season, time_of_day: timeOfDay, weather, weather_note: weather === 'other' ? (weatherNote || null) : null, memo: memo || null, nickname, photo_path: photoPath, taken_at: capturedAt || new Date().toISOString(), heading: locationVerified && global.PhotoHeading ? global.PhotoHeading.headingOf(elements.uploadForm) : null, location_verified: locationVerified }); if (insertError) { if (!locationVerified) { clearUnverifiedBox(); setFeedback('status-error', '오늘은 위치 미확인 사진을 더 올릴 수 없어요.', '위치 미확인 사진은 하루 3장까지 올릴 수 있어요.'); return; } throw insertError; }
      closeUploadModal(); resetUploadForm(); setAppNotice('등록됐어요. 운영자 승인 후 공개됩니다.', 'success');
    } catch (error) { setFeedback('status-error', '사진을 등록하지 못했습니다.', error.message || '위치 확인 또는 사진 처리 중 오류가 발생했습니다.'); }
    finally { isSubmitting = false; updateSubmitAvailability(); }
  }
  function initApp() {
    if (!global.SpotData || !global.UploadValidator || !global.ImageCompressor) { console.error('필수 스크립트를 찾을 수 없습니다. 의존 스크립트를 app.js보다 먼저 불러오세요.'); return; }
    setupBottomBarHeightObserver(); setupFaceConfirmation(); setupCameraCaptureButton(); updateCoverDate(); updateSeasonDisplay(null); refreshSpots(); renderTabs(); renderSummaryCard(); renderPointTabs(); renderMatrix(); updateUploadButton(); loadApprovedPhotos();
    global.addEventListener('inviteactivated', updateUploadButton);
    elements.galleryTimeButtons.forEach(button => button.addEventListener('click', () => {
      galleryTimeFilter = button.dataset.galleryTime || 'all';
      elements.galleryTimeButtons.forEach(item => { const active = item === button; item.classList.toggle('is-active', active); item.setAttribute('aria-pressed', active ? 'true' : 'false'); });
      renderMatrix();
    }));
    if (elements.galleryWeatherFilter) elements.galleryWeatherFilter.addEventListener('change', () => { galleryWeatherFilter = elements.galleryWeatherFilter.value || 'all'; renderMatrix(); });
    if (elements.btnCloseDetail) elements.btnCloseDetail.addEventListener('click', closePhotoDetail);
    if (elements.btnPreviousPhoto) elements.btnPreviousPhoto.addEventListener('click', showPreviousPhoto); if (elements.btnNextPhoto) elements.btnNextPhoto.addEventListener('click', showNextPhoto);
    if (elements.viewerImageWrap) {
      elements.viewerImageWrap.addEventListener('touchstart', event => { if (event.touches.length === 1) swipeStartX = event.touches[0].clientX; }, { passive: true });
      elements.viewerImageWrap.addEventListener('touchend', event => { if (swipeStartX === null || !event.changedTouches.length) return; const distance = event.changedTouches[0].clientX - swipeStartX; swipeStartX = null; if (Math.abs(distance) < 45 || detailPhotos.length < 2) return; if (distance < 0) showNextPhoto(); else showPreviousPhoto(); }, { passive: true });
      elements.viewerImageWrap.addEventListener('touchcancel', () => { swipeStartX = null; }, { passive: true });
    }
    if (elements.detailModal) elements.detailModal.addEventListener('click', event => { if (event.target === elements.detailModal) closePhotoDetail(); });
    if (elements.btnRequestLocation) elements.btnRequestLocation.addEventListener('click', () => requestUserLocation(true));
    if (elements.btnOpenUpload) elements.btnOpenUpload.addEventListener('click', openUploadModal); if (elements.btnCloseUpload) elements.btnCloseUpload.addEventListener('click', closeUploadModal);
    if (elements.uploadModal) elements.uploadModal.addEventListener('click', event => { if (event.target === elements.uploadModal) closeUploadModal(); });
    if (elements.uploadForm) elements.uploadForm.addEventListener('submit', handlePhotoSubmit);
    if (elements.photoFileInput) elements.photoFileInput.addEventListener('change', () => { const file = elements.photoFileInput.files[0]; if (!isCameraFile(file)) state.cameraCapture = null; clearUnverifiedBox(); if (elements.faceConfirmationCheckbox) elements.faceConfirmationCheckbox.checked = false; if (elements.fileNamePreview) elements.fileNamePreview.textContent = file ? file.name : '사진 선택하기'; setFeedback('', '', '', ''); updateSubmitAvailability(); readSelectedPhotoTime(file); });
    if (elements.uploadForm) elements.uploadForm.addEventListener('change', event => { if (event.target && event.target.name === 'weather') updateWeatherNoteVisibility(); updateSelectedChips(); });
    updateWeatherNoteVisibility(); updateSelectedChips();
  }
  global.App = Object.freeze({ state, renderTabs, renderSummaryCard, renderPointTabs, renderMatrix, selectSpot, requestUserLocation, openUploadModal, loadApprovedPhotos, initApp });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initApp); else initApp();
})(globalThis);
