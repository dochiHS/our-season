/**
 * app.js - 명소 탐색 및 현장 사진 등록 애플리케이션
 * 일반 스크립트 방식이며 공개 API는 globalThis.App에서 사용할 수 있습니다.
 * 의존 API: globalThis.SpotData, globalThis.UploadValidator, globalThis.ImageCompressor
 */
(function (global) {
  'use strict';

  // 애플리케이션 상태
  const state = {
    spots: [],
    currentSpotId: null,
    userCoords: null
  };

  // DOM 요소 캐시
  const elements = {
    spotTabs: document.getElementById('spot-tabs'),
    spotSummaryCard: document.getElementById('spot-summary-card'),
    photoMatrix: document.getElementById('photo-matrix'),
    detailModal: document.getElementById('photo-detail-modal'),
    detailPhotoImg: document.getElementById('detail-photo-img'),
    detailPhotoTag: document.getElementById('detail-photo-tag'),
    detailPhotoNote: document.getElementById('detail-photo-note'),
    detailPhotoDate: document.getElementById('detail-photo-date'),
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
    validationFeedbackCard: document.getElementById('validation-feedback-card'),
    feedbackTitle: document.getElementById('feedback-title'),
    feedbackMessage: document.getElementById('feedback-message'),
    feedbackHint: document.getElementById('feedback-hint'),
    btnSubmitPhoto: document.getElementById('btn-submit-photo')
  };

  let isSubmitting = false;

  function getCurrentSpot() {
    return state.spots.find(spot => spot.id === state.currentSpotId) || null;
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
    const point = getRepresentativePoint(spot);
    if (!spot || !point) return null;
    return {
      name: spot.name,
      latitude: point.lat,
      longitude: point.lng,
      radiusMeters: point.radiusMeters || 500
    };
  }

  function updateCoverDate() {
    if (!elements.headerDateLine) return;

    const now = new Date(Date.now() + 9 * 60 * 60 * 1000);
    const { season, isPreview } = getSeasonView();

    elements.headerDateLine.textContent = `CHEONGJU · ${now.getUTCFullYear()} · ${season.toUpperCase()}${isPreview ? ' · PREVIEW' : ''}`;
    if (elements.headerArch) elements.headerArch.dataset.season = season;
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

    const repPoint = getRepresentativePoint(currentSpot);
    const grid = repPoint ? repPoint.grid : null;
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

          slot.addEventListener('click', () => openPhotoDetail(latestPhoto, currentSpot.name, seasonKey, lightKey));
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

  function openPhotoDetail(photo, spotName, seasonKey, lightKey) {
    if (!elements.detailModal) return;

    const { SEASONS_KO, LIGHT_CONDITIONS_KO } = global.SpotData;
    elements.detailPhotoImg.src = photo.dataUrl;
    elements.detailPhotoTag.textContent = `${spotName} · ${SEASONS_KO[seasonKey]} · ${LIGHT_CONDITIONS_KO[lightKey]}`;
    elements.detailPhotoNote.textContent = photo.memo ? `“${photo.memo}”` : '';
    elements.detailPhotoDate.textContent = photo.uploadedAt ? `등록일: ${photo.uploadedAt}` : '';
    elements.detailModal.classList.add('open');
  }

  function closePhotoDetail() {
    if (!elements.detailModal) return;
    elements.detailModal.classList.remove('open');
    elements.detailPhotoImg.src = '';
  }

  function selectSpot(spotId) {
    state.currentSpotId = spotId;
    renderTabs();
    renderSummaryCard();
    renderMatrix();
    updateUploadButton();
  }

  function refreshSpots() {
    const previousSpotId = state.currentSpotId;
    const userCoords = state.userCoords
      ? { lat: state.userCoords.latitude, lng: state.userCoords.longitude }
      : null;
    state.spots = global.SpotData.getSpotsSortedByDistance(userCoords);

    if (state.spots.some(spot => spot.id === previousSpotId)) {
      state.currentSpotId = previousSpotId;
    } else {
      state.currentSpotId = state.spots.length ? state.spots[0].id : null;
    }
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

    const distance = typeof spot.distanceMeters === 'number' ? spot.distanceMeters : null;
    const point = getRepresentativePoint(spot);
    const radius = point && point.radiusMeters ? point.radiusMeters : 500;
    if (distance !== null && distance <= radius) {
      elements.btnOpenUpload.classList.add('state-ready');
      elements.btnUploadLabel.textContent = '현장 사진 등록하기';
      setUploadDistanceNotice('현장 반경 안에 있습니다. 이 명소의 사진을 등록할 수 있어요.');
    } else {
      const distanceText = distance === null
        ? '거리 확인 불가'
        : global.UploadValidator.formatDistance(distance);
      elements.btnOpenUpload.classList.add('state-locked');
      elements.btnUploadLabel.textContent = `🔒 ${spot.name}까지 ${distanceText}, 도착하면 올릴 수 있어요`;
      setUploadDistanceNotice(distance === null
        ? `현재 위치와 ${spot.name} 사이의 거리를 확인할 수 없습니다. 위치를 다시 확인해 주세요.`
        : `현재 ${spot.name}에서 ${distanceText} 떨어져 있어요. 반경 ${radius}m 이내에 도착하면 사진을 등록할 수 있습니다.`);
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
    const distance = typeof spot.distanceMeters === 'number' ? spot.distanceMeters : null;
    const point = getRepresentativePoint(spot);
    const radius = point && point.radiusMeters ? point.radiusMeters : 500;

    if (distance === null || distance > radius) {
      updateUploadButton();
      return;
    }

    resetUploadForm();
    if (elements.uploadModal) elements.uploadModal.classList.add('open');
  }

  function closeUploadModal() {
    if (elements.uploadModal) elements.uploadModal.classList.remove('open');
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

    isSubmitting = true;
    updateSubmitAvailability();
    setFeedback('status-checking', '위치와 사진 정보를 확인하고 있습니다.', '원본 사진의 EXIF GPS와 현재 위치를 확인합니다.');

    try {
      if (!state.userCoords) {
        const located = await requestUserLocation(false);
        if (!located) throw new Error('현재 위치를 확인할 수 없습니다. 위치 권한을 허용한 뒤 다시 시도해 주세요.');
      }

      const validation = await global.UploadValidator.validateUpload(file, target, state.userCoords);
      if (!validation.isValid) {
        const errors = validation.errorItems || [];
        const message = errors.map(item => `${item.title}: ${item.message}`).join('\n\n');
        setFeedback(
          'status-error',
          errors.length === 1 ? errors[0].title : `${errors.length}가지 확인이 필요합니다.`,
          message || (validation.reasons || []).join('\n')
        );
        return;
      }

      setFeedback('status-checking', '위치 검증을 통과했습니다.', '사진을 웹용 크기로 압축하고 저장합니다.');
      const compressed = await global.ImageCompressor.compressImage(file);
      global.SpotData.addPhotoToSpot(spot.id, targetPointId(spot), {
        dataUrl: compressed.dataUrl,
        memo,
        season,
        lightCondition
      });

      refreshSpots();
      renderTabs();
      renderSummaryCard();
      renderMatrix();
      updateUploadButton();
      closeUploadModal();
      resetUploadForm();
      setAppNotice('현장 사진이 등록되었습니다.', 'success');
    } catch (error) {
      setFeedback('status-error', '사진을 등록하지 못했습니다.', error.message || '위치 확인 또는 사진 처리 중 오류가 발생했습니다.');
    } finally {
      isSubmitting = false;
      updateSubmitAvailability();
    }
  }

  function targetPointId(spot) {
    const point = getRepresentativePoint(spot);
    return point ? point.id : null;
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
    renderMatrix();
    updateUploadButton();

    if (elements.btnCloseDetail) elements.btnCloseDetail.addEventListener('click', closePhotoDetail);
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
