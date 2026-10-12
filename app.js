(function (global) {
  'use strict';

  // 애플리케이션 상태
  const state = { spots: [], currentSpotId: null, currentPointId: null, userCoords: null, approvedPhotos: [], selectedTakenAt: null };
  const WEATHER_KO = { clear: '맑음', cloudy: '흐림', rain: '비', snow: '눈', fog: '안개', other: '기타' };
  let galleryTimeFilter = 'all', galleryWeatherFilter = 'all';
  let supabaseClient = null;
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
    feedbackMessage: document.getElementById('feedback-message'), feedbackHint: document.getElementById('feedback-hint'), btnSubmitPhoto: document.getElementById('btn-submit-photo')
  };
  let isSubmitting = false, detailPhotos = [], detailPhotoIndex = 0, detailPhotoContext = null, swipeStartX = null;
  function getCurrentSpot() { return state.spots.find(spot => spot.id === state.currentSpotId) || null; }
  function getCurrentPoint(spot = getCurrentSpot()) { if (!spot || !Array.isArray(spot.points) || !spot.points.length) return null; return spot.points.find(point => point.id === state.currentPointId) || spot.points[0]; }
  function getSupabaseClient() {
    if (supabaseClient) return supabaseClient;
    const config = global.SUPABASE_CONFIG;
    if (!config || !config.SUPABASE_URL || !config.SUPABASE_ANON_KEY || !global.supabase || typeof global.supabase.createClient !== 'function') return null;
    supabaseClient = global.supabase.createClient(config.SUPABASE_URL, config.SUPABASE_ANON_KEY); return supabaseClient;
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
      const { data, error } = await client.from('season_photos').select('spot_id, point_id, season, time_of_day, weather, weather_note, memo, nickname, photo_path, created_at, taken_at').eq('status', 'approved').order('created_at', { ascending: false });
      if (error) throw error;
      state.approvedPhotos = (data || []).flatMap(row => {
        if (!global.SpotData.TIME_OF_DAY.includes(row.time_of_day)) return [];
        const { data: publicData } = client.storage.from('season-photos').getPublicUrl(row.photo_path);
        return [{ dataUrl: publicData.publicUrl, memo: row.memo || '', nickname: row.nickname || '', spotId: row.spot_id, pointId: row.point_id, season: row.season, timeOfDay: row.time_of_day, weather: row.weather, weatherNote: row.weather_note || '', takenAt: row.taken_at || '', uploadedAt: row.created_at || row.taken_at || '' }];
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
    elements.spotSummaryCard.innerHTML = `<div class="summary-header"><div><h2 class="spot-name">${spot.name}</h2><span class="point-name-badge">📍 ${point ? point.name : '대표 위치'} (반경 ${radius}m)</span></div><div class="sun-times-pill" title="오늘의 일출·일몰 시각"><span class="sun-item">🌅 ${sun.sunrise}</span><span class="sun-sep">|</span><span class="sun-item">🌇 ${sun.sunset}</span></div></div><div class="spot-meta-list"><div class="meta-item"><span class="meta-icon">⏱️</span><span class="meta-label">운영시간</span><span class="meta-val">${spot.operatingHours || '상시 개방'}</span></div><div class="meta-item"><span class="meta-icon">🚗</span><span class="meta-label">주차안내</span><span class="meta-val">${spot.parking || '주차 가능'}</span></div><div class="meta-item"><span class="meta-icon">📌</span><span class="meta-label">주의메모</span><span class="meta-val">${spot.safetyNotice || '현장 확인 예정'}</span></div></div>`;
    if (elements.uploadTargetName) elements.uploadTargetName.textContent = `${spot.name} (${point ? point.name : '대표 위치'})`;
  }
  function renderMatrix() {
    if (!elements.photoMatrix) return; const spot = getCurrentSpot(); if (!spot) return;
    const point = getCurrentPoint(spot), { SEASONS, SEASONS_KO, TIME_OF_DAY_KO } = global.SpotData, view = getSeasonView();
    elements.photoMatrix.innerHTML = '';
    SEASONS.forEach(season => {
      const photos = state.approvedPhotos
        .filter(photo => photo.spotId === spot.id && photo.pointId === (point && point.id) && photo.season === season
          && (galleryTimeFilter === 'all' || photo.timeOfDay === galleryTimeFilter)
          && (galleryWeatherFilter === 'all' || photo.weather === galleryWeatherFilter))
        .slice()
        .sort((a, b) => String(b.uploadedAt || '').localeCompare(String(a.uploadedAt || '')));
      const current = season === view.season;
      const pile = document.createElement('button'); pile.type = 'button'; pile.className = `season-pile${current ? ' is-current-season' : ''}${photos.length ? ' has-photos' : ' is-empty'}`;
      pile.setAttribute('aria-label', `${SEASONS_KO[season]} 사진 ${photos.length}장${photos.length ? ', 사진 보기' : ''}`);
      if (current) { pile.setAttribute('aria-current', view.isPreview ? 'true' : 'date'); pile.title = view.isPreview ? `현재 강조 계절: ${SEASONS_KO[season]} (미리보기)` : '오늘 날짜 기준 현재 계절'; }
      const stack = document.createElement('span'); stack.className = 'season-pile-stack';
      if (photos.length) {
        const backOne = document.createElement('span'); backOne.className = 'season-pile-back season-pile-back-one'; backOne.setAttribute('aria-hidden', 'true');
        const backTwo = document.createElement('span'); backTwo.className = 'season-pile-back season-pile-back-two'; backTwo.setAttribute('aria-hidden', 'true');
        const cover = document.createElement('span'); cover.className = 'season-pile-cover';
        const img = document.createElement('img'); img.src = photos[0].dataUrl; img.alt = `${spot.name} ${SEASONS_KO[season]} 최근 승인 사진`; img.loading = 'lazy'; cover.appendChild(img);
        const tags = document.createElement('span'); tags.className = 'season-pile-tags';
        const timeTag = document.createElement('span'); timeTag.textContent = TIME_OF_DAY_KO[photos[0].timeOfDay] || '시간 미상';
        const weatherTag = document.createElement('span'); weatherTag.textContent = WEATHER_KO[photos[0].weather] || '날씨 미상';
        tags.append(timeTag, weatherTag); cover.appendChild(tags); stack.append(backOne, backTwo, cover);
      } else {
        const empty = document.createElement('span'); empty.className = 'season-pile-empty'; empty.textContent = '아직 사진이 없어요'; stack.appendChild(empty);
      }
      const caption = document.createElement('span'); caption.className = 'season-pile-caption';
      const seasonName = document.createElement('span'); seasonName.className = 'season-pile-name'; seasonName.textContent = SEASONS_KO[season];
      const count = document.createElement('span'); count.className = 'season-pile-count'; count.textContent = `사진 ${photos.length}장`;
      caption.append(seasonName, count); pile.append(stack, caption);
      pile.addEventListener('click', () => { if (global.Screens && typeof global.Screens.navigateSeason === 'function') global.Screens.navigateSeason(spot.id, season); });
      elements.photoMatrix.appendChild(pile);
    });
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
  function updateUploadButton() {
    const spot = getCurrentSpot(); if (!elements.btnOpenUpload || !elements.btnUploadLabel) return; elements.btnOpenUpload.classList.remove('state-ready', 'state-locked', 'state-unknown');
    if (!spot || !state.userCoords) { elements.btnOpenUpload.classList.add('state-unknown'); elements.btnUploadLabel.textContent = '내 위치 확인 후 현장 등록하기'; setUploadDistanceNotice('내 위치를 확인하면 명소까지의 거리와 등록 가능 여부를 안내해 드립니다.'); return; }
    const status = getNearestPointStatus(spot), distance = status ? status.distanceMeters : null, pointName = status && status.point ? status.point.name : '가장 가까운 촬영 지점', radius = status ? status.radius : 500;
    if (status && status.withinAnyPoint) { elements.btnOpenUpload.classList.add('state-ready'); elements.btnUploadLabel.textContent = '현장 사진 등록하기'; setUploadDistanceNotice(`가장 가까운 지점(${pointName})까지 ${global.UploadValidator.formatDistance(distance)}입니다. 촬영 지점 반경 안에 있습니다.`); }
    else { const text = distance === null ? '거리 확인 불가' : global.UploadValidator.formatDistance(distance); elements.btnOpenUpload.classList.add('state-locked'); elements.btnUploadLabel.textContent = `🔒 ${spot.name}의 ${pointName}까지 ${text}, 도착하면 올릴 수 있어요`; setUploadDistanceNotice(distance === null ? `현재 위치와 ${spot.name}의 촬영 지점 사이의 거리를 확인할 수 없습니다. 위치를 다시 확인해 주세요.` : `현재 가장 가까운 지점(${pointName})에서 ${text} 떨어져 있어요. 반경 ${radius}m 이내에 도착하면 사진을 등록할 수 있습니다.`); }
  }
  function setFeedback(status, title, message, hint) { if (!elements.validationFeedbackCard) return; elements.validationFeedbackCard.className = 'validation-feedback-box'; if (status) elements.validationFeedbackCard.classList.add(status); elements.feedbackTitle.textContent = title || ''; elements.feedbackMessage.textContent = message || ''; elements.feedbackMessage.style.whiteSpace = 'pre-line'; elements.feedbackHint.textContent = hint || ''; }
  function getCaptureSeason(takenAt) { const date = takenAt ? new Date(takenAt) : new Date(); return global.SpotData.getCurrentSeason(Number.isNaN(date.getTime()) ? new Date() : date); }
  function formatKstDate(date) { const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date); const values = Object.fromEntries(parts.map(part => [part.type, part.value])); return `${values.year}.${values.month}.${values.day}`; }
  function updateSeasonDisplay(takenAt) { const season = getCaptureSeason(takenAt); if (elements.seasonInput) elements.seasonInput.value = season; if (elements.seasonDisplay) elements.seasonDisplay.value = `${global.SpotData.SEASONS_KO[season]} · ${takenAt ? `촬영일 ${formatKstDate(new Date(takenAt))}` : '오늘 날짜 기준'}`; if (elements.headerArch) elements.headerArch.dataset.season = season; }
  function updateWeatherNoteVisibility() { if (!elements.weatherNoteGroup) return; const weather = elements.uploadForm && new FormData(elements.uploadForm).get('weather'); elements.weatherNoteGroup.hidden = weather !== 'other'; if (weather !== 'other' && elements.weatherNoteInput) elements.weatherNoteInput.value = ''; }
  function resetUploadForm() { if (elements.uploadForm) elements.uploadForm.reset(); state.selectedTakenAt = null; metadataRequestId += 1; if (elements.fileNamePreview) elements.fileNamePreview.textContent = '사진 선택하기'; updateSeasonDisplay(null); updateWeatherNoteVisibility(); setFeedback('', '', '', ''); updateSubmitAvailability(); updateSelectedChips(); }
  function updateSubmitAvailability() { if (elements.btnSubmitPhoto) elements.btnSubmitPhoto.disabled = isSubmitting || !elements.photoFileInput || !elements.photoFileInput.files.length; }
  function updateSelectedChips() { document.querySelectorAll('#upload-form input[type="radio"]').forEach(input => { const label = input.closest('.chip-option'); if (label) label.classList.toggle('selected', input.checked); }); }
  async function readSelectedPhotoTime(file) { const request = ++metadataRequestId; state.selectedTakenAt = null; updateSeasonDisplay(null); if (!file || !global.ExifGpsReader || typeof global.ExifGpsReader.extractDateTimeOriginal !== 'function') return; try { const takenAt = await global.ExifGpsReader.extractDateTimeOriginal(file); if (request !== metadataRequestId || !elements.photoFileInput || elements.photoFileInput.files[0] !== file) return; state.selectedTakenAt = takenAt || null; updateSeasonDisplay(state.selectedTakenAt); } catch (error) { if (request !== metadataRequestId) return; state.selectedTakenAt = null; updateSeasonDisplay(null); } }
  async function openUploadModal() { if (!state.userCoords && !(await requestUserLocation(true))) return; const spot = getCurrentSpot(); if (!spot) return; const status = getNearestPointStatus(spot); if (!status || !status.withinAnyPoint) { updateUploadButton(); return; } resetUploadForm(); if (elements.uploadModal) elements.uploadModal.classList.add('open'); }
  function closeUploadModal() { if (elements.uploadModal) elements.uploadModal.classList.remove('open'); }
  function createRandomUuid() { if (global.crypto && typeof global.crypto.randomUUID === 'function') return global.crypto.randomUUID(); if (!global.crypto || typeof global.crypto.getRandomValues !== 'function') throw new Error('안전한 무작위 ID를 만들 수 없습니다. HTTPS 환경에서 다시 시도해 주세요.'); const bytes = new Uint8Array(16); global.crypto.getRandomValues(bytes); bytes[6] = (bytes[6] & 15) | 64; bytes[8] = (bytes[8] & 63) | 128; return Array.from(bytes, (byte, index) => { const value = byte.toString(16).padStart(2, '0'); return [4, 6, 8, 10].includes(index) ? `-${value}` : value; }).join(''); }
  function validateNickname(value) { const nickname = value.trim(), length = Array.from(nickname).length; if (length < 1 || length > 20) throw new Error('닉네임을 1~20자로 입력해 주세요.'); return nickname; }
  function validateWeatherNote(value) { const note = value.trim(); if (Array.from(note).length > 10) throw new Error('날씨 메모는 10자 이하로 입력해 주세요.'); return note; }
  async function handlePhotoSubmit(event) {
    event.preventDefault(); if (isSubmitting) return; const file = elements.photoFileInput && elements.photoFileInput.files[0], spot = getCurrentSpot(), target = getValidationTarget(spot);
    if (!file || !target) { setFeedback('status-error', '사진과 명소 정보를 확인해 주세요.', '등록할 사진을 선택한 뒤 다시 시도해 주세요.'); return; }
    const form = new FormData(elements.uploadForm), timeOfDay = form.get('time_of_day'), weather = form.get('weather'), memo = elements.photoMemoInput ? elements.photoMemoInput.value.trim() : ''; let weatherNote, nickname;
    try { if (!global.SpotData.TIME_OF_DAY.includes(timeOfDay)) throw new Error('시간대 항목을 선택해 주세요.'); if (!Object.prototype.hasOwnProperty.call(WEATHER_KO, weather)) throw new Error('날씨 항목을 선택해 주세요.'); weatherNote = validateWeatherNote(elements.weatherNoteInput ? elements.weatherNoteInput.value : ''); nickname = validateNickname(elements.nicknameInput ? elements.nicknameInput.value : ''); }
    catch (error) { setFeedback('status-error', '입력 내용을 확인해 주세요.', error.message); if (error.message.includes('닉네임') && elements.nicknameInput) elements.nicknameInput.focus(); else if (error.message.includes('날씨 메모') && elements.weatherNoteInput) elements.weatherNoteInput.focus(); return; }
    isSubmitting = true; updateSubmitAvailability(); setFeedback('status-checking', '위치와 사진 정보를 확인하고 있습니다.', '원본 사진의 EXIF GPS와 현재 위치를 확인합니다.');
    try {
      const client = getSupabaseClient(); if (!client) throw new Error('Supabase 설정을 확인해 주세요. supabase-config.js에 URL과 공개 키를 입력해야 합니다.');
      if (!state.userCoords && !(await requestUserLocation(false))) throw new Error('현재 위치를 확인할 수 없습니다. 위치 권한을 허용한 뒤 다시 시도해 주세요.');
      const validation = await global.UploadValidator.validateUpload(file, target);
      if (validation.details && validation.details.userLocation) { state.userCoords = validation.details.userLocation; refreshSpots(); renderTabs(); updateUploadButton(); notifySpotStateChange(); }
      if (!validation.isValid) { const errors = validation.errorItems || [], message = errors.length === 1 ? errors[0].message : errors.map(item => `${item.title}: ${item.message}`).join('\n\n'); setFeedback('status-error', errors.length === 1 ? errors[0].title : `${errors.length}가지 확인이 필요합니다.`, message || (validation.reasons || []).join('\n')); return; }
      const capturedAt = validation.details && validation.details.photoLocation ? validation.details.photoLocation.takenAt || null : state.selectedTakenAt; state.selectedTakenAt = capturedAt; const season = getCaptureSeason(capturedAt); updateSeasonDisplay(capturedAt);
      setFeedback('status-checking', '위치 검증을 통과했습니다.', '사진을 웹용 크기로 압축하고 Supabase에 저장합니다.');
      const compressed = await global.ImageCompressor.compressImage(file), photoPath = `${spot.id}/${createRandomUuid()}.jpg`;
      const { error: uploadError } = await client.storage.from('season-photos').upload(photoPath, compressed.blob, { cacheControl: '3600', contentType: 'image/jpeg', upsert: false }); if (uploadError) throw uploadError;
      const { error: insertError } = await client.from('season_photos').insert({ spot_id: spot.id, point_id: validation.pointId, season, time_of_day: timeOfDay, weather, weather_note: weather === 'other' ? (weatherNote || null) : null, memo: memo || null, nickname, photo_path: photoPath, taken_at: capturedAt || new Date().toISOString() }); if (insertError) throw insertError;
      closeUploadModal(); resetUploadForm(); setAppNotice('등록됐어요. 운영자 승인 후 공개됩니다.', 'success');
    } catch (error) { setFeedback('status-error', '사진을 등록하지 못했습니다.', error.message || '위치 확인 또는 사진 처리 중 오류가 발생했습니다.'); }
    finally { isSubmitting = false; updateSubmitAvailability(); }
  }
  function initApp() {
    if (!global.SpotData || !global.UploadValidator || !global.ImageCompressor) { console.error('필수 스크립트를 찾을 수 없습니다. 의존 스크립트를 app.js보다 먼저 불러오세요.'); return; }
    updateCoverDate(); updateSeasonDisplay(null); refreshSpots(); renderTabs(); renderSummaryCard(); renderPointTabs(); renderMatrix(); updateUploadButton(); loadApprovedPhotos();
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
    if (elements.photoFileInput) elements.photoFileInput.addEventListener('change', () => { const file = elements.photoFileInput.files[0]; if (elements.fileNamePreview) elements.fileNamePreview.textContent = file ? file.name : '사진 선택하기'; setFeedback('', '', '', ''); updateSubmitAvailability(); readSelectedPhotoTime(file); });
    if (elements.uploadForm) elements.uploadForm.addEventListener('change', event => { if (event.target && event.target.name === 'weather') updateWeatherNoteVisibility(); updateSelectedChips(); });
    updateWeatherNoteVisibility(); updateSelectedChips();
  }
  global.App = Object.freeze({ state, renderTabs, renderSummaryCard, renderPointTabs, renderMatrix, selectSpot, requestUserLocation, initApp });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initApp); else initApp();
})(globalThis);
