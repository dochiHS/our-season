/**
 * app.js - 명소 탐색 및 현장 사진 등록 애플리케이션
 * 일반 스크립트 방식이며 공개 API는 globalThis.App에서 사용할 수 있습니다.
 * 의존 API: globalThis.SpotData, globalThis.UploadValidator, globalThis.ImageCompressor, globalThis.supabase
 */
(function (global) {
  'use strict';

  // 애플리케이션 상태
  const state = {
    spots: [],
    currentSpotId: null,
    currentPointId: null,
    userCoords: null,
    approvedPhotos: []
  };

  const LIGHT_TO_DATABASE = {
    sunrise: { time_of_day: 'sunrise', weather: 'clear' },
    clear: { time_of_day: 'day', weather: 'clear' },
    sunset: { time_of_day: 'sunset', weather: 'clear' },
    rain: { time_of_day: 'day', weather: 'rain' }
  };
  const DATABASE_TO_LIGHT = {
    'sunrise:clear': 'sunrise',
    'day:clear': 'clear',
    'sunset:clear': 'sunset',
    'day:rain': 'rain'
  };

  let supabaseClient = null;

  // DOM 요소 캐시
  const elements = {
    spotTabs: document.getElementById('spot-tabs'),
    spotSummaryCard: document.getElementById('spot-summary-card'),
    pointTabsSection: document.getElementById('point-tabs-section'),
    pointTabs: document.getElementById('point-tabs'),
    photoMatrix: document.getElementById('photo-matrix'),
    detailModal: document.getElementById('photo-detail-modal'),
    detailPhotoImg: document.getElementById('detail-photo-img'),
    detailPhotoTag: document.getElementById('detail-photo-tag'),
    detailPhotoNote: document.getElementById('detail-photo-note'),
    detailPhotoDate: document.getElementById('detail-photo-date'),
    detailPhotoCount: document.getElementById('detail-photo-count'),
    viewerNavigation: document.getElementById('viewer-navigation'),
    btnPreviousPhoto: document.getElementById('btn-previous-photo'),
    btnNextPhoto: document.getElementById('btn-next-photo'),
    viewerImageWrap: document.getElementById('viewer-image-wrap'),
    btnCloseDetail: document.getElementById('btn-close-detail'),
    uploadTargetName: document.getElementById('upload-target-name'),
    btnRequestLocation: document.getElementById('btn-request-location'),
    gpsStatusLabel: document.getElementById('gps-status-label'),
    appStatusNotice: document.getElementById('app-status-notice'),
    headerDateLine: document.getElementById('header-date-line'),
    headerArch: document.querySelector('.header-arch'),
    btnOpenUpload: document.getElementById('btn-open-upload'),
    btnUploadLabel: document.getElementById('btn-upload-label'),
    uploadDistanceNotice: document.getElementById('upload-distance-notice'),
    uploadModal: document.getElementById('upload-modal'),
    btnCloseUpload: document.getElementById('btn-close-upload'),
    uploadForm: document.getElementById('upload-form'),
    photoFileInput: document.getElementById('photo-file-input'),
    fileNamePreview: document.getElementById('file-name-preview'),
    photoMemoInput: document.getElementById('photo-memo-input'),
    nicknameInput: document.getElementById('nickname-input'),
    validationFeedbackCard: document.getElementById('validation-feedback-card'),
    feedbackTitle: document.getElementById('feedback-title'),
    feedbackMessage: document.getElementById('feedback-message'),
    feedbackHint: document.getElementById('feedback-hint'),
    btnSubmitPhoto: document.getElementById('btn-submit-photo')
  };

  let isSubmitting = false;
  let detailPhotos = [];
  let detailPhotoIndex = 0;
  let detailPhotoContext = null;
  let swipeStartX = null;

  function getCurrentSpot() {
    return state.spots.find(spot => spot.id === state.currentSpotId) || null;
  }

  function getCurrentPoint(spot = getCurrentSpot()) {
    if (!spot || !Array.isArray(spot.points) || !spot.points.length) return null;
    return spot.points.find(point => point.id === state.currentPointId) || spot.points[0];
  }

  function getSupabaseClient() {
    if (supabaseClient) return supabaseClient;
    const config = global.SUPABASE_CONFIG;
    if (!config || !config.SUPABASE_URL || !config.SUPABASE_ANON_KEY) return null;
    if (!global.supabase || typeof global.supabase.createClient !== 'function') return null;
    supabaseClient = global.supabase.createClient(config.SUPABASE_URL, config.SUPABASE_ANON_KEY);
    return supabaseClient;
  }

  /** URL의 유효한 season 값이 있으면 미리보기 계절로, 없으면 오늘의 KST 계절로 설정합니다. */
  function getSeasonView() {
    const search = global.location ? global.location.search : '';
    const requestedSeason = new URLSearchParams(search).get('season');
    const isPreview = global.SpotData.SEASONS.includes(requestedSeason);
    return {
      season: isPreview ? requestedSeason : global.SpotData.getCurrentSeason(),
      isPreview
    };
  }

  function getRepresentativePoint(spot) {
    return spot && spot.points ? spot.points[0] || null : null;
  }

  function getValidationTarget(spot) {
    if (!spot || !Array.isArray(spot.points) || !spot.points.length) return null;
    return {
      id: spot.id,
      name: spot.name,
      points: spot.points.map(point => ({
        id: point.id,
        name: point.name,
        latitude: point.lat,
        longitude: point.lng,
        radiusMeters: point.radiusMeters,
        description: point.description
      }))
    };
  }

  function getNearestPointStatus(spot) {
    if (!spot || !Array.isArray(spot.points) || !spot.points.length) return null;
    const nearestPoint = spot.nearestPoint || getRepresentativePoint(spot);
    if (!nearestPoint) return null;
    const accuracy = state.userCoords && Number.isFinite(state.userCoords.accuracy)
      ? Math.min(Math.max(state.userCoords.accuracy, 0), 100)
      : 0;
    const withinAnyPoint = spot.points.some(point => {
      const distance = global.GeoCalculator.getDistanceInMeters(
        state.userCoords.latitude,
        state.userCoords.longitude,
        point.lat,
        point.lng
      );
      return distance <= (point.radiusMeters || 500) + accuracy;
    });
    return {
      point: nearestPoint,
      distanceMeters: spot.distanceMeters,
      radius: nearestPoint.radiusMeters || 500,
      withinAnyPoint
    };
  }

  function updateCoverDate() {
    if (!elements.headerDateLine) return;

    const now = new Date(Date.now() + 9 * 60 * 60 * 1000);
    const { season, isPreview } = getSeasonView();

    elements.headerDateLine.textContent = `CHEONGJU · ${now.getUTCFullYear()} · ${season.toUpperCase()}${isPreview ? ' · PREVIEW' : ''}`;
    if (elements.headerArch) elements.headerArch.dataset.season = season;
  }

  function applyApprovedPhotos() {
    state.spots.forEach(spot => {
      spot.points.forEach(point => {
        Object.values(point.grid).forEach(lightSlots => {
          Object.keys(lightSlots).forEach(lightKey => { lightSlots[lightKey] = []; });
        });

        state.approvedPhotos
          .filter(photo => photo.spotId === spot.id && (!photo.pointId || photo.pointId === point.id))
          .forEach(photo => {
            const slot = point.grid[photo.season] && point.grid[photo.season][photo.lightCondition];
            if (slot) slot.push(photo);
          });

        Object.values(point.grid).forEach(lightSlots => {
          Object.values(lightSlots).forEach(photos => {
            photos.sort((a, b) => String(b.uploadedAt || '').localeCompare(String(a.uploadedAt || '')));
          });
        });
      });
    });
  }

  async function loadApprovedPhotos() {
    const client = getSupabaseClient();
    if (!client) {
      setAppNotice('Supabase 설정을 확인해 주세요. supabase-config.js에 URL과 공개 키를 입력해야 합니다.', 'error');
      return;
    }

    try {
      const { data, error } = await client
        .from('season_photos')
        .select('spot_id, point_id, season, time_of_day, weather, memo, nickname, photo_path, created_at, taken_at')
        .eq('status', 'approved')
        .order('created_at', { ascending: false });
      if (error) throw error;

      state.approvedPhotos = (data || []).flatMap(row => {
        const lightCondition = DATABASE_TO_LIGHT[`${row.time_of_day}:${row.weather}`];
        if (!lightCondition) return [];
        const { data: publicData } = client.storage.from('season-photos').getPublicUrl(row.photo_path);
        return [{
          dataUrl: publicData.publicUrl,
          memo: row.memo || '',
          nickname: row.nickname || '',
          spotId: row.spot_id,
          pointId: row.point_id,
          season: row.season,
          lightCondition,
          uploadedAt: row.created_at || row.taken_at || ''
        }];
      });
      refreshSpots();
      renderTabs();
      renderSummaryCard();
      renderPointTabs();
      renderMatrix();
    } catch (error) {
      setAppNotice(`승인된 사진을 불러오지 못했습니다. ${error.message || ''}`.trim(), 'error');
    }
  }

  function renderTabs() {
    if (!elements.spotTabs) return;

    elements.spotTabs.innerHTML = '';
    state.spots.forEach(spot => {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = `spot-tab-chip ${spot.id === state.currentSpotId ? 'active' : ''}`;
      chip.setAttribute('data-spot-id', spot.id);

      const nameSpan = document.createElement('span');
      nameSpan.textContent = spot.name;
      chip.appendChild(nameSpan);

      if (spot.distanceText) {
        const badge = document.createElement('span');
        badge.className = 'spot-distance-badge';
        badge.textContent = spot.distanceText;
        chip.appendChild(badge);
      }

      chip.addEventListener('click', () => selectSpot(spot.id));
      elements.spotTabs.appendChild(chip);
    });
  }

  function renderPointTabs() {
    if (!elements.pointTabs || !elements.pointTabsSection) return;

    const currentSpot = getCurrentSpot();
    const points = currentSpot && Array.isArray(currentSpot.points) ? currentSpot.points : [];
    elements.pointTabs.innerHTML = '';
    elements.pointTabsSection.hidden = points.length <= 1;
    if (points.length <= 1) return;

    const currentPoint = getCurrentPoint(currentSpot);
    points.forEach(point => {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = `spot-tab-chip ${point.id === currentPoint.id ? 'active' : ''}`;
      chip.textContent = point.name;
      chip.setAttribute('aria-pressed', point.id === currentPoint.id ? 'true' : 'false');
      chip.addEventListener('click', () => {
        state.currentPointId = point.id;
        renderPointTabs();
        renderMatrix();
      });
      elements.pointTabs.appendChild(chip);
    });
  }

  function renderSummaryCard() {
    if (!elements.spotSummaryCard) return;

    const currentSpot = getCurrentSpot();
    if (!currentSpot) {
      elements.spotSummaryCard.innerHTML = '<p style="font-size:12px; color:var(--text-muted);">명소 정보를 불러올 수 없습니다.</p>';
      return;
    }

    const repPoint = getRepresentativePoint(currentSpot);
    const sunTimes = currentSpot.sunTimes || { sunrise: '--:--', sunset: '--:--' };
    elements.spotSummaryCard.innerHTML = `
      <div class="summary-header">
        <div>
          <h2 class="spot-name">${currentSpot.name}</h2>
          <span class="point-name-badge">📍 ${repPoint ? repPoint.name : '대표 위치'} (반경 500m)</span>
        </div>
        <div class="sun-times-pill" title="오늘의 일출·일몰 시각">
          <span class="sun-item">🌅 ${sunTimes.sunrise}</span>
          <span class="sun-sep">|</span>
          <span class="sun-item">🌇 ${sunTimes.sunset}</span>
        </div>
      </div>
      <div class="spot-meta-list">
        <div class="meta-item">
          <span class="meta-icon">⏱️</span>
          <span class="meta-label">운영시간</span>
          <span class="meta-val">${currentSpot.operatingHours || '상시 개방'}</span>
        </div>
        <div class="meta-item">
          <span class="meta-icon">🚗</span>
          <span class="meta-label">주차안내</span>
          <span class="meta-val">${currentSpot.parking || '주차 가능'}</span>
        </div>
        <div class="meta-item">
          <span class="meta-icon">📌</span>
          <span class="meta-label">주의메모</span>
          <span class="meta-val">${currentSpot.safetyNotice || '현장 확인 예정'}</span>
        </div>
      </div>
    `;

    if (elements.uploadTargetName) {
      elements.uploadTargetName.textContent = `${currentSpot.name} (${repPoint ? repPoint.name : '대표 위치'})`;
    }
  }

  function renderMatrix() {
    if (!elements.photoMatrix) return;

    const currentSpot = getCurrentSpot();
    if (!currentSpot) return;

    const selectedPoint = getCurrentPoint(currentSpot);
    const grid = selectedPoint ? selectedPoint.grid : null;
    const { SEASONS, SEASONS_KO, LIGHT_CONDITIONS, LIGHT_CONDITIONS_KO } = global.SpotData;
    const seasonView = getSeasonView();
    const focusedSeason = seasonView.season;
    elements.photoMatrix.innerHTML = '';

    const cornerCell = document.createElement('div');
    cornerCell.className = 'grid-col-header';
    elements.photoMatrix.appendChild(cornerCell);

    LIGHT_CONDITIONS.forEach(lightKey => {
      const colHeader = document.createElement('div');
      colHeader.className = 'grid-col-header';
      colHeader.textContent = LIGHT_CONDITIONS_KO[lightKey];
      elements.photoMatrix.appendChild(colHeader);
    });

    SEASONS.forEach(seasonKey => {
      const isFocusedSeason = seasonKey === focusedSeason;
      const rowHeader = document.createElement('div');
      rowHeader.className = `grid-row-header${isFocusedSeason ? ' is-current-season' : ''}`;
      rowHeader.textContent = SEASONS_KO[seasonKey];
      if (isFocusedSeason) {
        rowHeader.setAttribute('aria-current', seasonView.isPreview ? 'true' : 'date');
        rowHeader.title = seasonView.isPreview
          ? `URL 계절 미리보기 (?season=${focusedSeason})`
          : '오늘 날짜 기준 현재 계절';
      }
      elements.photoMatrix.appendChild(rowHeader);

      LIGHT_CONDITIONS.forEach(lightKey => {
        const photos = (grid && grid[seasonKey] && grid[seasonKey][lightKey]) || [];
        const hasPhoto = photos.length > 0;
        const slot = document.createElement('div');
        slot.className = `matrix-slot ${hasPhoto ? 'is-filled' : ''}${isFocusedSeason ? ' is-current-season' : ''}`;
        slot.setAttribute('data-season', seasonKey);
        slot.setAttribute('data-light', lightKey);
        if (isFocusedSeason) slot.setAttribute('aria-current', seasonView.isPreview ? 'true' : 'date');

        if (hasPhoto) {
          const latestPhoto = photos[0];
          const img = document.createElement('img');
          img.src = latestPhoto.dataUrl;
          img.alt = `${currentSpot.name} ${SEASONS_KO[seasonKey]} ${LIGHT_CONDITIONS_KO[lightKey]}`;
          img.loading = 'lazy';
          slot.appendChild(img);

          if (photos.length > 1) {
            const badge = document.createElement('span');
            badge.className = 'slot-badge-count';
            badge.textContent = photos.length;
            slot.appendChild(badge);
          }

          slot.addEventListener('click', () => openPhotoDetail(photos, 0, currentSpot.name, seasonKey, lightKey));
        } else {
          const emptyIcon = document.createElement('span');
          emptyIcon.className = 'slot-empty-icon';
          emptyIcon.textContent = '+';
          slot.appendChild(emptyIcon);
          slot.title = `${SEASONS_KO[seasonKey]}의 ${LIGHT_CONDITIONS_KO[lightKey]} 사진이 아직 없습니다.`;
          slot.addEventListener('click', () => {
            setAppNotice(`${currentSpot.name}의 [${SEASONS_KO[seasonKey]} · ${LIGHT_CONDITIONS_KO[lightKey]}] 사진이 아직 없습니다. 현장에 도착하시면 첫 번째 사진을 남겨보세요!`, 'info');
          });
        }

        elements.photoMatrix.appendChild(slot);
      });
    });
  }

  function renderDetailPhoto() {
    if (!detailPhotos.length || !detailPhotoContext) return;

    const photo = detailPhotos[detailPhotoIndex];
    const { spotName, seasonKey, lightKey } = detailPhotoContext;
    const { SEASONS_KO, LIGHT_CONDITIONS_KO } = global.SpotData;
    elements.detailPhotoImg.src = photo.dataUrl;
    elements.detailPhotoTag.textContent = `${spotName} · ${SEASONS_KO[seasonKey]} · ${LIGHT_CONDITIONS_KO[lightKey]}`;
    const noteParts = [];
    if (photo.nickname) noteParts.push(photo.nickname);
    if (photo.memo) noteParts.push(`“${photo.memo}”`);
    elements.detailPhotoNote.textContent = noteParts.join(' · ');
    elements.detailPhotoDate.textContent = photo.uploadedAt ? `등록일: ${photo.uploadedAt}` : '';

    const hasMultiplePhotos = detailPhotos.length > 1;
    elements.viewerNavigation.hidden = !hasMultiplePhotos;
    elements.detailPhotoCount.textContent = `${detailPhotoIndex + 1} / ${detailPhotos.length}`;
    elements.btnPreviousPhoto.disabled = detailPhotoIndex === 0;
    elements.btnNextPhoto.disabled = detailPhotoIndex === detailPhotos.length - 1;
  }

  function openPhotoDetail(photos, currentIndex, spotName, seasonKey, lightKey) {
    if (!elements.detailModal || !Array.isArray(photos) || !photos.length) return;

    detailPhotos = photos;
    detailPhotoIndex = Math.max(0, Math.min(currentIndex, detailPhotos.length - 1));
    detailPhotoContext = { spotName, seasonKey, lightKey };
    renderDetailPhoto();
    elements.detailModal.classList.add('open');
  }

  function showPreviousPhoto() {
    if (detailPhotoIndex <= 0) return;
    detailPhotoIndex -= 1;
    renderDetailPhoto();
  }

  function showNextPhoto() {
    if (detailPhotoIndex >= detailPhotos.length - 1) return;
    detailPhotoIndex += 1;
    renderDetailPhoto();
  }

  function closePhotoDetail() {
    if (!elements.detailModal) return;
    elements.detailModal.classList.remove('open');
    elements.detailPhotoImg.src = '';
    detailPhotos = [];
    detailPhotoIndex = 0;
    detailPhotoContext = null;
    swipeStartX = null;
  }

  function selectSpot(spotId) {
    state.currentSpotId = spotId;
    const selectedSpot = getCurrentSpot();
    state.currentPointId = selectedSpot && selectedSpot.points.length ? selectedSpot.points[0].id : null;
    renderTabs();
    renderSummaryCard();
    renderPointTabs();
    renderMatrix();
    updateUploadButton();
  }

  function refreshSpots() {
    const previousSpotId = state.currentSpotId;
    const previousPointId = state.currentPointId;
    const userCoords = state.userCoords
      ? { lat: state.userCoords.latitude, lng: state.userCoords.longitude }
      : null;
    state.spots = global.SpotData.getSpotsSortedByDistance(userCoords);
    applyApprovedPhotos();

    if (state.spots.some(spot => spot.id === previousSpotId)) {
      state.currentSpotId = previousSpotId;
    } else {
      state.currentSpotId = state.spots.length ? state.spots[0].id : null;
    }
    const currentSpot = getCurrentSpot();
    state.currentPointId = currentSpot && currentSpot.points.some(point => point.id === previousPointId)
      ? previousPointId
      : currentSpot && currentSpot.points.length
        ? currentSpot.points[0].id
        : null;
  }

  async function requestUserLocation(showError) {
    try {
      state.userCoords = await global.UploadValidator.getCurrentUserPosition();
      if (elements.gpsStatusLabel) elements.gpsStatusLabel.textContent = '위치 확인됨';
      if (elements.btnRequestLocation) elements.btnRequestLocation.classList.add('is-active');
      setAppNotice('', '');
      refreshSpots();
      renderTabs();
      renderSummaryCard();
      renderPointTabs();
      renderMatrix();
      updateUploadButton();
      return true;
    } catch (error) {
      if (showError) setAppNotice(error.message || '현재 위치를 확인할 수 없습니다.', 'error');
      return false;
    }
  }

  function setUploadDistanceNotice(message) {
    if (!elements.uploadDistanceNotice) return;
    elements.uploadDistanceNotice.textContent = message || '';
    elements.uploadDistanceNotice.hidden = !message;
  }

  function setAppNotice(message, status) {
    if (!elements.appStatusNotice) return;
    elements.appStatusNotice.textContent = message || '';
    elements.appStatusNotice.className = 'app-status-notice';
    if (status) elements.appStatusNotice.classList.add(`is-${status}`);
    elements.appStatusNotice.hidden = !message;
  }

  function updateUploadButton() {
    const spot = getCurrentSpot();
    if (!elements.btnOpenUpload || !elements.btnUploadLabel) return;

    elements.btnOpenUpload.classList.remove('state-ready', 'state-locked', 'state-unknown');
    if (!spot || !state.userCoords) {
      elements.btnOpenUpload.classList.add('state-unknown');
      elements.btnUploadLabel.textContent = '내 위치 확인 후 현장 등록하기';
      setUploadDistanceNotice('내 위치를 확인하면 명소까지의 거리와 등록 가능 여부를 안내해 드립니다.');
      return;
    }

    const pointStatus = getNearestPointStatus(spot);
    const distance = pointStatus ? pointStatus.distanceMeters : null;
    const pointName = pointStatus && pointStatus.point ? pointStatus.point.name : '가장 가까운 촬영 지점';
    const radius = pointStatus ? pointStatus.radius : 500;
    if (pointStatus && pointStatus.withinAnyPoint) {
      elements.btnOpenUpload.classList.add('state-ready');
      elements.btnUploadLabel.textContent = '현장 사진 등록하기';
      setUploadDistanceNotice(`가장 가까운 지점(${pointName})까지 ${global.UploadValidator.formatDistance(distance)}입니다. 촬영 지점 반경 안에 있습니다.`);
    } else {
      const distanceText = distance === null
        ? '거리 확인 불가'
        : global.UploadValidator.formatDistance(distance);
      elements.btnOpenUpload.classList.add('state-locked');
      elements.btnUploadLabel.textContent = `🔒 ${spot.name}의 ${pointName}까지 ${distanceText}, 도착하면 올릴 수 있어요`;
      setUploadDistanceNotice(distance === null
        ? `현재 위치와 ${spot.name}의 촬영 지점 사이의 거리를 확인할 수 없습니다. 위치를 다시 확인해 주세요.`
        : `현재 가장 가까운 지점(${pointName})에서 ${distanceText} 떨어져 있어요. 반경 ${radius}m 이내에 도착하면 사진을 등록할 수 있습니다.`);
    }
  }

  function setFeedback(status, title, message, hint) {
    if (!elements.validationFeedbackCard) return;
    elements.validationFeedbackCard.className = 'validation-feedback-box';
    if (status) elements.validationFeedbackCard.classList.add(status);
    elements.feedbackTitle.textContent = title || '';
    elements.feedbackMessage.textContent = message || '';
    elements.feedbackMessage.style.whiteSpace = 'pre-line';
    elements.feedbackHint.textContent = hint || '';
  }

  function resetUploadForm() {
    if (elements.uploadForm) elements.uploadForm.reset();
    if (elements.fileNamePreview) elements.fileNamePreview.textContent = '사진 선택하기';
    setFeedback('', '', '', '');
    updateSubmitAvailability();
    updateSelectedChips();
  }

  function updateSubmitAvailability() {
    if (!elements.btnSubmitPhoto) return;
    elements.btnSubmitPhoto.disabled = isSubmitting || !elements.photoFileInput || !elements.photoFileInput.files.length;
  }

  function updateSelectedChips() {
    document.querySelectorAll('#upload-form input[type="radio"]').forEach(input => {
      const label = input.closest('.chip-option');
      if (label) label.classList.toggle('selected', input.checked);
    });
  }

  async function openUploadModal() {
    if (!state.userCoords) {
      const located = await requestUserLocation(true);
      if (!located) return;
    }

    const spot = getCurrentSpot();
    if (!spot) return;
    const pointStatus = getNearestPointStatus(spot);

    if (!pointStatus || !pointStatus.withinAnyPoint) {
      updateUploadButton();
      return;
    }

    resetUploadForm();
    if (elements.uploadModal) elements.uploadModal.classList.add('open');
  }

  function closeUploadModal() {
    if (elements.uploadModal) elements.uploadModal.classList.remove('open');
  }

  function createRandomUuid() {
    if (global.crypto && typeof global.crypto.randomUUID === 'function') return global.crypto.randomUUID();
    if (!global.crypto || typeof global.crypto.getRandomValues !== 'function') {
      throw new Error('안전한 무작위 ID를 만들 수 없습니다. HTTPS 환경에서 다시 시도해 주세요.');
    }
    const bytes = new Uint8Array(16);
    global.crypto.getRandomValues(bytes);
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    return Array.from(bytes, (byte, index) => {
      const value = byte.toString(16).padStart(2, '0');
      return [4, 6, 8, 10].includes(index) ? `-${value}` : value;
    }).join('');
  }

  function validateNickname(value) {
    const nickname = value.trim();
    const length = Array.from(nickname).length;
    if (length < 1 || length > 20) throw new Error('닉네임을 1~20자로 입력해 주세요.');
    return nickname;
  }

  async function handlePhotoSubmit(event) {
    event.preventDefault();
    if (isSubmitting) return;

    const file = elements.photoFileInput && elements.photoFileInput.files[0];
    const spot = getCurrentSpot();
    const target = getValidationTarget(spot);
    if (!file || !target) {
      setFeedback('status-error', '사진과 명소 정보를 확인해 주세요.', '등록할 사진을 선택한 뒤 다시 시도해 주세요.');
      return;
    }

    const formData = new FormData(elements.uploadForm);
    const season = formData.get('season');
    const lightCondition = formData.get('lightCondition');
    const memo = elements.photoMemoInput ? elements.photoMemoInput.value.trim() : '';
    let nickname;
    try {
      nickname = validateNickname(elements.nicknameInput ? elements.nicknameInput.value : '');
    } catch (error) {
      setFeedback('status-error', '닉네임을 확인해 주세요.', error.message);
      if (elements.nicknameInput) elements.nicknameInput.focus();
      return;
    }

    isSubmitting = true;
    updateSubmitAvailability();
    setFeedback('status-checking', '위치와 사진 정보를 확인하고 있습니다.', '원본 사진의 EXIF GPS와 현재 위치를 확인합니다.');

    try {
      const client = getSupabaseClient();
      if (!client) throw new Error('Supabase 설정을 확인해 주세요. supabase-config.js에 URL과 공개 키를 입력해야 합니다.');

      if (!state.userCoords) {
        const located = await requestUserLocation(false);
        if (!located) throw new Error('현재 위치를 확인할 수 없습니다. 위치 권한을 허용한 뒤 다시 시도해 주세요.');
      }

      const validation = await global.UploadValidator.validateUpload(file, target);
      if (validation.details && validation.details.userLocation) {
        state.userCoords = validation.details.userLocation;
        refreshSpots();
        renderTabs();
        updateUploadButton();
      }

      if (!validation.isValid) {
        const errors = validation.errorItems || [];
        const message = errors.length === 1
          ? errors[0].message
          : errors.map(item => `${item.title}: ${item.message}`).join('\n\n');
        setFeedback(
          'status-error',
          errors.length === 1 ? errors[0].title : `${errors.length}가지 확인이 필요합니다.`,
          message || (validation.reasons || []).join('\n')
        );
        return;
      }

      setFeedback('status-checking', '위치 검증을 통과했습니다.', '사진을 웹용 크기로 압축하고 Supabase에 저장합니다.');
      const compressed = await global.ImageCompressor.compressImage(file);
      const photoPath = `${spot.id}/${createRandomUuid()}.jpg`;
      const { error: uploadError } = await client.storage
        .from('season-photos')
        .upload(photoPath, compressed.blob, {
          cacheControl: '3600',
          contentType: 'image/jpeg',
          upsert: false
        });
      if (uploadError) throw uploadError;

      const mapping = LIGHT_TO_DATABASE[lightCondition];
      if (!mapping) throw new Error('빛·날씨 항목을 확인해 주세요.');
      const { error: insertError } = await client
        .from('season_photos')
        .insert({
          spot_id: spot.id,
          point_id: validation.pointId,
          season,
          time_of_day: mapping.time_of_day,
          weather: mapping.weather,
          weather_note: null,
          memo: memo || null,
          nickname,
          photo_path: photoPath,
          taken_at: new Date().toISOString()
        });
      if (insertError) throw insertError;

      closeUploadModal();
      resetUploadForm();
      setAppNotice('등록됐어요. 운영자 승인 후 공개됩니다.', 'success');
    } catch (error) {
      setFeedback('status-error', '사진을 등록하지 못했습니다.', error.message || '위치 확인 또는 사진 처리 중 오류가 발생했습니다.');
    } finally {
      isSubmitting = false;
      updateSubmitAvailability();
    }
  }

  function initApp() {
    if (!global.SpotData || !global.UploadValidator || !global.ImageCompressor) {
      console.error('필수 스크립트를 찾을 수 없습니다. 의존 스크립트를 app.js보다 먼저 불러오세요.');
      return;
    }

    updateCoverDate();
    refreshSpots();
    renderTabs();
    renderSummaryCard();
    renderPointTabs();
    renderMatrix();
    updateUploadButton();
    loadApprovedPhotos();

    if (elements.btnCloseDetail) elements.btnCloseDetail.addEventListener('click', closePhotoDetail);
    if (elements.btnPreviousPhoto) elements.btnPreviousPhoto.addEventListener('click', showPreviousPhoto);
    if (elements.btnNextPhoto) elements.btnNextPhoto.addEventListener('click', showNextPhoto);
    if (elements.viewerImageWrap) {
      elements.viewerImageWrap.addEventListener('touchstart', event => {
        if (event.touches.length === 1) swipeStartX = event.touches[0].clientX;
      }, { passive: true });
      elements.viewerImageWrap.addEventListener('touchend', event => {
        if (swipeStartX === null || !event.changedTouches.length) return;
        const swipeDistance = event.changedTouches[0].clientX - swipeStartX;
        swipeStartX = null;
        if (Math.abs(swipeDistance) < 45 || detailPhotos.length < 2) return;
        if (swipeDistance < 0) showNextPhoto();
        else showPreviousPhoto();
      }, { passive: true });
      elements.viewerImageWrap.addEventListener('touchcancel', () => {
        swipeStartX = null;
      }, { passive: true });
    }
    if (elements.detailModal) {
      elements.detailModal.addEventListener('click', event => {
        if (event.target === elements.detailModal) closePhotoDetail();
      });
    }
    if (elements.btnRequestLocation) {
      elements.btnRequestLocation.addEventListener('click', () => requestUserLocation(true));
    }
    if (elements.btnOpenUpload) elements.btnOpenUpload.addEventListener('click', openUploadModal);
    if (elements.btnCloseUpload) elements.btnCloseUpload.addEventListener('click', closeUploadModal);
    if (elements.uploadModal) {
      elements.uploadModal.addEventListener('click', event => {
        if (event.target === elements.uploadModal) closeUploadModal();
      });
    }
    if (elements.uploadForm) elements.uploadForm.addEventListener('submit', handlePhotoSubmit);
    if (elements.photoFileInput) {
      elements.photoFileInput.addEventListener('change', () => {
        const file = elements.photoFileInput.files[0];
        if (elements.fileNamePreview) elements.fileNamePreview.textContent = file ? file.name : '사진 선택하기';
        setFeedback('', '', '', '');
        updateSubmitAvailability();
      });
    }
    if (elements.uploadForm) elements.uploadForm.addEventListener('change', updateSelectedChips);
    updateSelectedChips();
  }

  global.App = Object.freeze({
    state,
    renderTabs,
    renderSummaryCard,
    renderMatrix,
    selectSpot,
    initApp
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initApp);
  } else {
    initApp();
  }
})(globalThis);
