(function (global) {
  'use strict';

  const form = document.getElementById('upload-form');
  const fileInput = document.getElementById('photo-file-input');
  const uploadModal = document.getElementById('upload-modal');
  const openButton = document.getElementById('btn-open-upload');
  const storage = global.DraftStorage;
  if (!form || !fileInput || !uploadModal || !openButton || !storage || !global.App) return;

  const state = { pending: null, pendingPhoto: null, active: false, applying: false, attempting: false, generation: 0, expiryTimer: null };
  const banner = document.createElement('section');
  banner.className = 'upload-draft-resume';
  banner.hidden = true;
  banner.setAttribute('aria-live', 'polite');
  const bannerMessage = document.createElement('p');
  bannerMessage.className = 'upload-draft-resume-message';
  bannerMessage.textContent = '이어서 작성 중이에요';
  const missingPhoto = document.createElement('p');
  missingPhoto.className = 'upload-draft-photo-missing';
  missingPhoto.textContent = '사진은 다시 골라 주세요';
  missingPhoto.hidden = true;
  const restartButton = document.createElement('button');
  restartButton.type = 'button';
  restartButton.textContent = '처음부터 다시';
  banner.append(bannerMessage, missingPhoto, restartButton);
  const uploadSheet = uploadModal.querySelector('.modal-sheet');
  if (uploadSheet) uploadSheet.insertBefore(banner, uploadSheet.firstChild);

  function formValue(name) {
    const value = new FormData(form).get(name);
    return typeof value === 'string' ? value : '';
  }

  function snapshot() {
    const appState = global.App.state || {};
    return {
      spotId: appState.currentSpotId || '',
      pointId: appState.currentPointId || '',
      timeOfDay: formValue('time_of_day'),
      weather: formValue('weather'),
      weatherNote: document.getElementById('weather-note-input')?.value || '',
      memo: document.getElementById('photo-memo-input')?.value || '',
      nickname: document.getElementById('nickname-input')?.value || '',
      savedAt: Date.now()
    };
  }

  function scheduleExpiry(savedAt) {
    global.clearTimeout(state.expiryTimer);
    const remaining = storage.maxAgeMs - (Date.now() - Number(savedAt));
    if (remaining <= 0) { expireIfCurrent(savedAt); return; }
    state.expiryTimer = global.setTimeout(() => expireIfCurrent(savedAt), remaining + 25);
  }

  function expireIfCurrent(savedAt) {
    const current = storage.readText();
    if (current && Number(current.savedAt) === Number(savedAt)) {
      storage.clear();
      if (state.pending && Number(state.pending.savedAt) === Number(savedAt)) state.pending = null;
      state.pendingPhoto = null;
      state.active = false;
      banner.hidden = true;
    }
  }

  function saveTextDraft() {
    if (state.applying || (!state.active && !fileInput.files.length)) return;
    const value = snapshot();
    if (!value.spotId) return;
    if (storage.saveText(value)) {
      state.active = true;
      scheduleExpiry(value.savedAt);
    }
  }

  function isFaceCheckbox(target) {
    return target && target.id === 'face-confirmation-checkbox';
  }

  form.addEventListener('input', event => {
    if (!isFaceCheckbox(event.target) && event.target !== fileInput) saveTextDraft();
  });
  form.addEventListener('change', event => {
    if (state.applying || isFaceCheckbox(event.target)) return;
    if (event.target === fileInput) {
      const file = fileInput.files && fileInput.files[0];
      if (file) {
        saveTextDraft();
        storage.savePhoto(file).catch(() => { /* 원본 저장 실패 시 글자 정보 복원은 계속 지원 */ });
      } else if (state.active) storage.clearPhoto();
    } else global.setTimeout(saveTextDraft, 0);
  });

  document.addEventListener('click', event => {
    const pointTab = event.target.closest && event.target.closest('.point-tab-scroll .spot-tab-chip');
    if (pointTab && state.active) global.setTimeout(saveTextDraft, 0);
  }, true);

  function updateChipPresentation() {
    form.querySelectorAll('.chip-option').forEach(label => {
      const input = label.querySelector('input[type="radio"]');
      label.classList.toggle('selected', Boolean(input && input.checked));
    });
    const weather = formValue('weather');
    const group = document.getElementById('weather-note-group');
    if (group) group.hidden = weather !== 'other';
  }

  function setRadio(name, value) {
    const input = Array.from(form.querySelectorAll(`input[type="radio"][name="${name}"]`)).find(item => item.value === value);
    if (input) input.checked = true;
  }

  function createRestoredFile(record) {
    if (!record || !record.blob || typeof global.File !== 'function') return null;
    try {
      return new global.File([record.blob], record.name || 'photo', {
        type: record.type || record.blob.type || 'application/octet-stream',
        lastModified: Number(record.lastModified) || Date.now()
      });
    } catch (error) { return null; }
  }

  function attachFile(file) {
    if (!file || typeof global.DataTransfer !== 'function') return false;
    try {
      const transfer = new global.DataTransfer();
      transfer.items.add(file);
      fileInput.files = transfer.files;
      if (!fileInput.files || fileInput.files.length !== 1) return false;
      const preview = document.getElementById('file-name-preview');
      if (preview) preview.textContent = file.name;
      state.applying = true;
      fileInput.dispatchEvent(new Event('change', { bubbles: true }));
      state.applying = false;
      return true;
    } catch (error) {
      state.applying = false;
      return false;
    }
  }

  function applyDraft(draft, savedPhoto) {
    if (!draft) return;
    state.applying = true;
    setRadio('time_of_day', draft.timeOfDay);
    setRadio('weather', draft.weather);
    const weatherNote = document.getElementById('weather-note-input');
    const memo = document.getElementById('photo-memo-input');
    const nickname = document.getElementById('nickname-input');
    if (weatherNote) weatherNote.value = draft.weatherNote || '';
    if (memo) memo.value = draft.memo || '';
    if (nickname) nickname.value = draft.nickname || '';
    updateChipPresentation();

    const file = createRestoredFile(savedPhoto);
    const photoRestored = attachFile(file);
    const faceCheckbox = document.getElementById('face-confirmation-checkbox');
    if (faceCheckbox) faceCheckbox.checked = false;
    missingPhoto.hidden = photoRestored;
    banner.hidden = false;
    state.applying = false;
    state.pending = null;
    state.pendingPhoto = null;
    state.active = true;
    scheduleExpiry(draft.savedAt);
  }

  function restorePoint(draft) {
    const appState = global.App.state;
    const spot = (appState.spots || []).find(item => item.id === draft.spotId);
    if (!spot) return false;
    if (draft.pointId && (spot.points || []).some(point => point.id === draft.pointId)) appState.currentPointId = draft.pointId;
    if (global.App.renderPointTabs) global.App.renderPointTabs();
    if (global.App.renderSummaryCard) global.App.renderSummaryCard();
    if (global.App.renderMatrix) global.App.renderMatrix();
    if (global.SpotMap) global.SpotMap.refresh(false);
    return true;
  }

  async function attemptResume() {
    if (!state.pending || state.attempting) return;
    const draft = state.pending, generation = ++state.generation;
    state.attempting = true;
    const spot = (global.App.state.spots || []).find(item => item.id === draft.spotId);
    if (!spot) { state.attempting = false; return; }
    global.App.selectSpot(draft.spotId);
    const detailHash = `#/spot/${encodeURIComponent(draft.spotId)}`;
    if (global.location.hash !== detailHash) {
      global.location.hash = detailHash;
      await new Promise(resolve => global.setTimeout(resolve, 60));
    }
    if (generation !== state.generation || state.pending !== draft) { state.attempting = false; return; }
    if (!restorePoint(draft)) { state.attempting = false; return; }

    // 복귀 시 위치를 새로 확인하고 기존 업로드 버튼과 동일한 지점 반경 판정을 수행합니다.
    const opened = await global.App.openUploadModal(true);
    if (generation !== state.generation || state.pending !== draft) { state.attempting = false; return; }
    state.attempting = false;
    if (!opened) return;
    applyDraft(draft, state.pendingPhoto);
  }

  openButton.addEventListener('click', event => {
    if (!state.pending) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    attemptResume();
  }, true);

  restartButton.addEventListener('click', () => {
    state.generation += 1;
    state.pending = null;
    state.pendingPhoto = null;
    state.active = false;
    state.attempting = false;
    global.clearTimeout(state.expiryTimer);
    storage.clear();
    form.reset();
    fileInput.value = '';
    const preview = document.getElementById('file-name-preview');
    if (preview) preview.textContent = '사진 선택하기';
    const faceCheckbox = document.getElementById('face-confirmation-checkbox');
    if (faceCheckbox) faceCheckbox.checked = false;
    const warning = document.getElementById('face-confirmation-warning');
    if (warning) warning.hidden = true;
    const feedback = document.getElementById('validation-feedback-card');
    if (feedback) { feedback.className = 'validation-feedback-box'; feedback.querySelectorAll('.feedback-title, .feedback-message, .feedback-hint').forEach(node => { node.textContent = ''; }); }
    const season = global.SpotData && global.SpotData.getCurrentSeason ? global.SpotData.getCurrentSeason() : 'spring';
    const seasonInput = document.getElementById('season-input');
    if (seasonInput) seasonInput.value = season;
    const seasonDisplay = document.getElementById('season-display');
    if (seasonDisplay) seasonDisplay.value = `${global.SpotData.SEASONS_KO[season]} · 오늘 날짜 기준`;
    banner.hidden = true;
    missingPhoto.hidden = true;
    updateChipPresentation();
  });

  function handleRegisteredNotice() {
    const notice = document.getElementById('app-status-notice');
    if (!notice || !notice.textContent.includes('등록됐어요. 운영자 승인 후 공개됩니다.')) return;
    state.generation += 1;
    state.pending = null;
    state.pendingPhoto = null;
    state.active = false;
    global.clearTimeout(state.expiryTimer);
    storage.clear();
    banner.hidden = true;
  }

  function beginRestore() {
    const draft = storage.readText();
    if (!draft || typeof draft.spotId !== 'string' || !draft.spotId) return;
    state.pending = draft;
    scheduleExpiry(draft.savedAt);
    Promise.resolve().then(() => storage.loadPhoto()).then(photo => {
      if (state.pending === draft) state.pendingPhoto = photo;
    }).catch(() => {
      if (state.pending === draft) state.pendingPhoto = null;
    }).finally(() => {
      if (state.pending !== draft) return;
      state.pendingPhoto = state.pendingPhoto || null;
      attemptResume();
    });
  }

  if (global.MutationObserver) {
    const notice = document.getElementById('app-status-notice');
    if (notice) new MutationObserver(handleRegisteredNotice).observe(notice, { childList: true, characterData: true, subtree: true });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => global.setTimeout(beginRestore, 0), { once: true });
  else global.setTimeout(beginRestore, 0);
})(globalThis);
