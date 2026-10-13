/**
 * free-upload.js
 * 우리 동네 기록 업로드 모달과 저장 기능
 * 공개 API: globalThis.FreeUpload.open()
 */
(function (global) {
  'use strict';

  const WEATHER_LABELS = Object.freeze({ clear: '맑음', cloudy: '흐림', rain: '비', snow: '눈', fog: '안개', other: '기타' });
  let modal, form, fields, isSubmitting = false, validationRequestId = 0, currentValidation = null, selectedTakenAt = null;

  function getSupabaseClient() {
    const config = global.SUPABASE_CONFIG;
    if (!config || !config.SUPABASE_URL || !config.SUPABASE_ANON_KEY || !global.supabase || typeof global.supabase.createClient !== 'function') return null;
    if (!getSupabaseClient.client) getSupabaseClient.client = global.supabase.createClient(config.SUPABASE_URL, config.SUPABASE_ANON_KEY);
    return getSupabaseClient.client;
  }

  function createRandomUuid() {
    if (global.crypto && typeof global.crypto.randomUUID === 'function') return global.crypto.randomUUID();
    if (!global.crypto || typeof global.crypto.getRandomValues !== 'function') throw new Error('안전한 무작위 ID를 만들 수 없습니다. HTTPS 환경에서 다시 시도해 주세요.');
    const bytes = new Uint8Array(16);
    global.crypto.getRandomValues(bytes);
    bytes[6] = (bytes[6] & 15) | 64;
    bytes[8] = (bytes[8] & 63) | 128;
    return Array.from(bytes, (byte, index) => {
      const value = byte.toString(16).padStart(2, '0');
      return [4, 6, 8, 10].includes(index) ? `-${value}` : value;
    }).join('');
  }

  function getSeason(takenAt) {
    const date = takenAt ? new Date(takenAt) : new Date();
    return global.SpotData.getCurrentSeason(Number.isNaN(date.getTime()) ? new Date() : date);
  }

  function formatKstDate(date) {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit'
    }).formatToParts(date);
    const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
    return `${values.year}.${values.month}.${values.day}`;
  }

  function updateSeason(takenAt) {
    const season = getSeason(takenAt);
    fields.season.value = season;
    fields.seasonDisplay.value = `${global.SpotData.SEASONS_KO[season]} · ${takenAt ? `촬영일 ${formatKstDate(new Date(takenAt))}` : '오늘 날짜 기준'}`;
  }

  function showFeedback(status, title, message) {
    fields.feedback.className = 'validation-feedback-box';
    if (status) fields.feedback.classList.add(status);
    fields.feedbackTitle.textContent = title || '';
    fields.feedbackMessage.textContent = message || '';
    fields.feedbackMessage.style.whiteSpace = 'pre-line';
  }

  function formatValidationErrors(result) {
    const errors = Array.isArray(result && result.errorItems) ? result.errorItems : [];
    if (!errors.length) return { title: '사진을 확인할 수 없습니다.', message: '사진 위치를 확인한 뒤 다시 선택해 주세요.' };
    const title = errors.length === 1 ? errors[0].title : `${errors.length}가지 확인이 필요합니다.`;
    const message = errors.length === 1 ? errors[0].message : errors.map(item => `${item.title}: ${item.message}`).join('\n\n');
    return { title, message };
  }

  function updateWeatherNoteVisibility() {
    const isOther = form.querySelector('input[name="weather"]:checked')?.value === 'other';
    fields.weatherNoteGroup.hidden = !isOther;
    fields.weatherNote.required = isOther;
    if (!isOther) fields.weatherNote.value = '';
  }

  function updateChipSelection() {
    form.querySelectorAll('input[type="radio"]').forEach(input => {
      const label = input.closest('.chip-option');
      if (label) label.classList.toggle('selected', input.checked);
    });
  }

  function updateSubmitAvailability() {
    if (!fields.submit) return;
    const hasFile = Boolean(fields.photo.files && fields.photo.files.length);
    const confirmed = fields.face.checked;
    fields.faceWarning.hidden = confirmed;
    fields.submit.disabled = isSubmitting || !hasFile || !currentValidation || !currentValidation.ok || !confirmed;
  }

  function resetForm() {
    validationRequestId += 1;
    currentValidation = null;
    selectedTakenAt = null;
    form.reset();
    fields.fileName.textContent = '사진 선택하기';
    fields.cityNotice.hidden = true;
    fields.cityNotice.textContent = '';
    fields.face.checked = false;
    fields.feedback.className = 'validation-feedback-box';
    fields.feedbackTitle.textContent = '';
    fields.feedbackMessage.textContent = '';
    updateSeason(null);
    updateWeatherNoteVisibility();
    updateChipSelection();
    updateSubmitAvailability();
  }

  async function inspectSelectedPhoto(file) {
    const requestId = ++validationRequestId;
    currentValidation = null;
    selectedTakenAt = null;
    fields.face.checked = false;
    fields.fileName.textContent = file ? file.name : '사진 선택하기';
    fields.cityNotice.hidden = true;
    fields.cityNotice.textContent = '';
    updateSeason(null);
    updateSubmitAvailability();
    if (!file) {
      showFeedback('', '', '');
      return;
    }

    showFeedback('status-checking', '사진 정보를 확인하고 있습니다.', '사진에 담긴 촬영 위치와 시각을 확인합니다.');
    try {
      const result = await global.FreePlaces.validateFreeUpload(file);
      if (requestId !== validationRequestId || fields.photo.files[0] !== file) return;
      currentValidation = result;
      selectedTakenAt = result.takenAt || null;
      updateSeason(selectedTakenAt);
      if (result.ok) {
        const city = global.FreePlaces.CITIES[result.city];
        fields.cityNotice.textContent = `${city ? city.name : '해당 도시'}에서 찍은 사진이에요`;
        fields.cityNotice.hidden = false;
        showFeedback('status-passed', '사진 확인을 통과했습니다.', '지원 도시 안에서 찍은 사진이에요.');
      } else {
        const error = formatValidationErrors(result);
        showFeedback('status-error', error.title, error.message);
      }
    } catch (error) {
      if (requestId !== validationRequestId) return;
      currentValidation = null;
      showFeedback('status-error', '사진을 확인하지 못했습니다.', error.message || '위치 확인 중 오류가 발생했습니다.');
    } finally {
      if (requestId === validationRequestId) updateSubmitAvailability();
    }
  }

  function validateFormValues() {
    const placeName = fields.placeName.value.trim();
    const nickname = fields.nickname.value.trim();
    const memo = fields.memo.value.trim();
    const weatherNote = fields.weatherNote.value.trim();
    const timeOfDay = form.querySelector('input[name="time_of_day"]:checked')?.value;
    const weather = form.querySelector('input[name="weather"]:checked')?.value;
    if (Array.from(placeName).length < 1 || Array.from(placeName).length > 30) throw new Error('장소 이름을 앞뒤 공백 없이 1~30자로 입력해 주세요.');
    if (!global.SpotData.TIME_OF_DAY.includes(timeOfDay)) throw new Error('시간대를 선택해 주세요.');
    if (!Object.prototype.hasOwnProperty.call(WEATHER_LABELS, weather)) throw new Error('날씨를 선택해 주세요.');
    if (weather === 'other' && (Array.from(weatherNote).length < 1 || Array.from(weatherNote).length > 10)) throw new Error('기타 날씨를 1~10자로 입력해 주세요.');
    if (weather !== 'other' && Array.from(weatherNote).length > 10) throw new Error('날씨 메모는 10자 이하로 입력해 주세요.');
    if (Array.from(nickname).length < 1 || Array.from(nickname).length > 20) throw new Error('닉네임을 앞뒤 공백 없이 1~20자로 입력해 주세요.');
    if (Array.from(memo).length > 30) throw new Error('메모는 30자 이하로 입력해 주세요.');
    return { placeName, nickname, memo, weatherNote, timeOfDay, weather };
  }

  function setBusy(busy) {
    isSubmitting = busy;
    form.querySelectorAll('input, button').forEach(input => { input.disabled = busy; });
    updateSubmitAvailability();
  }

  async function submitUpload(event) {
    event.preventDefault();
    if (isSubmitting) return;
    if (!fields.face.checked) return;
    const file = fields.photo.files && fields.photo.files[0];
    if (!file) {
      showFeedback('status-error', '사진을 선택해 주세요.', '위치 정보가 포함된 원본 사진을 선택해 주세요.');
      return;
    }

    let values;
    try {
      values = validateFormValues();
    } catch (error) {
      showFeedback('status-error', '입력 내용을 확인해 주세요.', error.message);
      return;
    }

    setBusy(true);
    showFeedback('status-checking', '사진 정보를 다시 확인하고 있습니다.', '사진에 담긴 촬영 위치와 시각을 다시 확인합니다.');
    try {
      const client = getSupabaseClient();
      if (!client) throw new Error('Supabase 설정을 확인해 주세요. supabase-config.js에 URL과 공개 키를 입력해야 합니다.');

      // 등록 직전에 사진 정보를 한 번 더 검사합니다. 좌표는 결과나 저장 데이터에 보관하지 않습니다.
      const validation = await global.FreePlaces.validateFreeUpload(file);
      if (!validation.ok) {
        const error = formatValidationErrors(validation);
        currentValidation = null;
        fields.cityNotice.hidden = true;
        showFeedback('status-error', error.title, error.message);
        return;
      }

      const city = validation.city;
      if (!city || !global.FreePlaces.CITIES[city]) throw new Error('사진의 도시 판정 결과를 확인할 수 없습니다.');
      selectedTakenAt = validation.takenAt || null;
      updateSeason(selectedTakenAt);
      fields.cityNotice.textContent = `${global.FreePlaces.CITIES[city].name}에서 찍은 사진이에요`;
      fields.cityNotice.hidden = false;
      showFeedback('status-checking', '사진 확인을 통과했습니다.', '사진을 웹용 크기로 압축하고 저장합니다.');

      const season = getSeason(selectedTakenAt);
      const compressed = await global.ImageCompressor.compressImage(file);
      const photoPath = `free/${city}/${createRandomUuid()}.jpg`;
      const { error: uploadError } = await client.storage.from('season-photos').upload(photoPath, compressed.blob, {
        cacheControl: '3600', contentType: 'image/jpeg', upsert: false
      });
      if (uploadError) throw uploadError;

      const { error: insertError } = await client.from('season_photos').insert({
        kind: 'free',
        city,
        place_name: values.placeName,
        spot_id: null,
        point_id: null,
        season,
        time_of_day: values.timeOfDay,
        weather: values.weather,
        weather_note: values.weather === 'other' ? values.weatherNote : null,
        memo: values.memo || null,
        nickname: values.nickname,
        photo_path: photoPath,
        taken_at: selectedTakenAt || new Date().toISOString(),
        status: 'pending'
      });
      if (insertError) throw insertError;

      resetForm();
      showFeedback('status-passed', '등록됐어요. 운영자 승인 후 공개됩니다.', '');
    } catch (error) {
      showFeedback('status-error', '사진을 등록하지 못했습니다.', error.message || '위치 확인 또는 사진 처리 중 오류가 발생했습니다.');
    } finally {
      setBusy(false);
    }
  }

  function close() {
    if (modal) modal.classList.remove('open');
  }

  function createModal() {
    modal = document.createElement('div');
    modal.id = 'free-upload-modal';
    modal.className = 'modal-overlay';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.setAttribute('aria-labelledby', 'free-upload-title');
    modal.innerHTML = `
      <div class="modal-sheet">
        <div class="sheet-header">
          <h3 id="free-upload-title" class="sheet-title">우리 동네 기록 올리기</h3>
          <button type="button" class="btn-close-modal" id="free-upload-close" aria-label="닫기" style="width:44px;height:44px;min-width:44px;min-height:44px;padding:0;display:inline-flex;align-items:center;justify-content:center;">×</button>
        </div>
        <form id="free-upload-form" class="upload-form" novalidate>
          <div class="form-group">
            <label class="form-label" for="free-place-name">장소 이름 (1~30자)</label>
            <input type="text" id="free-place-name" maxlength="30" required autocomplete="off" placeholder="예: 세종호수공원 수상무대" style="width:100%;padding:10px 12px;border:1px solid var(--bg-border);border-radius:var(--radius-sm);font-size:13px;font-family:var(--font-sans);">
          </div>
          <div class="form-group">
            <label class="form-label" for="free-photo-file">사진 파일 (JPEG/PNG)</label>
            <label for="free-photo-file" class="file-upload-box">
              <span class="upload-icon">📷</span><span class="upload-main-text" id="free-file-name">사진 선택하기</span>
              <span class="upload-sub-text">청주·천안·세종·김포·대전에서 찍은 원본 사진 (위치 정보 필수)</span>
            </label>
            <input type="file" id="free-photo-file" accept="image/jpeg,image/png,image/jpg" style="display:none;">
          </div>
          <div id="free-city-notice" class="upload-distance-notice" role="status" aria-live="polite" hidden></div>
          <div class="form-group">
            <label class="form-label" for="free-season-display">계절 (촬영 시각 기준)</label>
            <input type="text" id="free-season-display" readonly aria-readonly="true" style="width:100%;padding:10px 12px;border:1px solid var(--bg-border);border-radius:var(--radius-sm);font-size:13px;font-family:var(--font-sans);background:var(--bg-primary);color:var(--text-secondary);">
            <input type="hidden" id="free-season" name="season" value="spring">
          </div>
          <div class="form-group">
            <label class="form-label">시간대</label>
            <div class="chips-selector">
              <label class="chip-option selected"><input type="radio" name="time_of_day" value="sunrise" checked hidden>일출</label>
              <label class="chip-option"><input type="radio" name="time_of_day" value="day" hidden>낮</label>
              <label class="chip-option"><input type="radio" name="time_of_day" value="sunset" hidden>일몰</label>
              <label class="chip-option"><input type="radio" name="time_of_day" value="night" hidden>밤</label>
            </div>
          </div>
          <div class="form-group">
            <label class="form-label">날씨</label>
            <div class="chips-selector">
              <label class="chip-option selected"><input type="radio" name="weather" value="clear" checked hidden>맑음</label>
              <label class="chip-option"><input type="radio" name="weather" value="cloudy" hidden>흐림</label>
              <label class="chip-option"><input type="radio" name="weather" value="rain" hidden>비</label>
              <label class="chip-option"><input type="radio" name="weather" value="snow" hidden>눈</label>
              <label class="chip-option"><input type="radio" name="weather" value="fog" hidden>안개</label>
              <label class="chip-option"><input type="radio" name="weather" value="other" hidden>기타</label>
            </div>
          </div>
          <div class="form-group" id="free-weather-note-group" hidden>
            <label class="form-label" for="free-weather-note">기타 날씨 (10자 이하)</label>
            <input type="text" id="free-weather-note" maxlength="10" placeholder="날씨를 적어 주세요" style="width:100%;padding:10px 12px;border:1px solid var(--bg-border);border-radius:var(--radius-sm);font-size:13px;font-family:var(--font-sans);">
          </div>
          <div class="form-group">
            <label class="form-label" for="free-nickname">닉네임 (1~20자)</label>
            <input type="text" id="free-nickname" maxlength="20" required autocomplete="nickname" placeholder="닉네임을 입력해 주세요" style="width:100%;padding:10px 12px;border:1px solid var(--bg-border);border-radius:var(--radius-sm);font-size:13px;font-family:var(--font-sans);">
          </div>
          <div class="form-group">
            <label class="form-label" for="free-memo">메모 (선택, 30자 이내)</label>
            <input type="text" id="free-memo" maxlength="30" placeholder="사진에 대한 메모를 적어 주세요" style="width:100%;padding:10px 12px;border:1px solid var(--bg-border);border-radius:var(--radius-sm);font-size:13px;font-family:var(--font-sans);">
          </div>
          <div id="free-validation-feedback" class="validation-feedback-box">
            <div id="free-feedback-title" class="feedback-title"></div><div id="free-feedback-message" class="feedback-message"></div>
          </div>
          <div class="face-confirmation-group">
            <label class="face-confirmation" for="free-face-confirmation">
              <input type="checkbox" id="free-face-confirmation">
              다른 사람 얼굴이 알아볼 수 있게 찍히지 않았어요
            </label>
            <p id="free-face-warning" class="face-confirmation-warning" role="status">얼굴이 보이는 사진은 올릴 수 없어요</p>
          </div>
          <button type="submit" id="free-submit" class="btn-submit-upload" disabled>등록하기</button>
        </form>
      </div>`;
    document.body.appendChild(modal);

    form = modal.querySelector('#free-upload-form');
    fields = {
      placeName: modal.querySelector('#free-place-name'), photo: modal.querySelector('#free-photo-file'), fileName: modal.querySelector('#free-file-name'),
      cityNotice: modal.querySelector('#free-city-notice'), season: modal.querySelector('#free-season'), seasonDisplay: modal.querySelector('#free-season-display'),
      weatherNoteGroup: modal.querySelector('#free-weather-note-group'), weatherNote: modal.querySelector('#free-weather-note'), nickname: modal.querySelector('#free-nickname'), memo: modal.querySelector('#free-memo'),
      feedback: modal.querySelector('#free-validation-feedback'), feedbackTitle: modal.querySelector('#free-feedback-title'), feedbackMessage: modal.querySelector('#free-feedback-message'),
      face: modal.querySelector('#free-face-confirmation'), faceWarning: modal.querySelector('#free-face-warning'), submit: modal.querySelector('#free-submit')
    };

    modal.querySelector('#free-upload-close').addEventListener('click', close);
    modal.addEventListener('click', event => { if (event.target === modal) close(); });
    form.addEventListener('submit', submitUpload);
    fields.photo.addEventListener('change', () => inspectSelectedPhoto(fields.photo.files[0] || null));
    fields.face.addEventListener('change', updateSubmitAvailability);
    form.addEventListener('change', event => {
      if (event.target && event.target.name === 'weather') updateWeatherNoteVisibility();
      updateChipSelection();
    });
    updateSeason(null);
    updateWeatherNoteVisibility();
    updateChipSelection();
  }

  function open() {
    if (!modal) createModal();
    if (isSubmitting) return false;
    resetForm();
    modal.classList.add('open');
    return true;
  }

  global.FreeUpload = Object.freeze({ open });
})(globalThis);
