(function (global) {
  'use strict';

  const DIRECTIONS = Object.freeze(['북쪽', '북동쪽', '동쪽', '남동쪽', '남쪽', '남서쪽', '서쪽', '북서쪽']);

  function label(deg) {
    if (deg === null || deg === undefined || deg === '') return null;
    const value = Number(deg);
    if (!Number.isFinite(value)) return null;
    const normalized = ((value % 360) + 360) % 360;
    return DIRECTIONS[Math.round(normalized / 45) % 8];
  }

  function headingOf(form) {
    if (!form || form.dataset.photoExifHeading === undefined) return null;
    const value = Number(form.dataset.photoExifHeading);
    return Number.isInteger(value) && value >= 0 && value <= 359 ? value : null;
  }

  function attachForm(form, fileInput, readoutId) {
    if (!form || !fileInput || form.dataset.photoHeadingReady === 'true') return;
    form.dataset.photoHeadingReady = 'true';

    const readout = document.createElement('p');
    readout.id = readoutId;
    readout.className = 'photo-heading-readout';
    readout.setAttribute('role', 'status');
    readout.hidden = true;
    readout.style.cssText = 'margin: -8px 0 12px; color: var(--text-muted); font-size: 12px; line-height: 1.5;';

    const photoGroup = fileInput.closest('.form-group');
    if (photoGroup && photoGroup.parentNode) photoGroup.parentNode.insertBefore(readout, photoGroup.nextSibling);
    else form.insertBefore(readout, form.firstChild);

    let requestId = 0;
    function clear() {
      requestId += 1;
      delete form.dataset.photoExifHeading;
      readout.textContent = '';
      readout.hidden = true;
    }

    form.addEventListener('reset', clear);
    fileInput.addEventListener('change', async () => {
      const request = ++requestId;
      const file = fileInput.files && fileInput.files[0];
      delete form.dataset.photoExifHeading;
      readout.textContent = '';
      readout.hidden = true;
      if (!file || !global.ExifGpsReader || typeof global.ExifGpsReader.extractMetadataFromImage !== 'function') return;
      try {
        const metadata = await global.ExifGpsReader.extractMetadataFromImage(file);
        if (request !== requestId || !fileInput.files || fileInput.files[0] !== file) return;
        const heading = metadata && metadata.imgDirection;
        if (!Number.isInteger(heading) || heading < 0 || heading > 359) return;
        form.dataset.photoExifHeading = String(heading);
        readout.textContent = `찍은 방향: ${label(heading)} (${heading}°)`;
        readout.hidden = false;
      } catch (error) {
        if (request === requestId) {
          delete form.dataset.photoExifHeading;
          readout.hidden = true;
        }
      }
    });
  }

  function setup() {
    attachForm(document.getElementById('upload-form'), document.getElementById('photo-file-input'), 'photo-heading-readout');
    const observer = new MutationObserver(() => {
      const form = document.getElementById('free-upload-form');
      if (form) attachForm(form, form.querySelector('#free-photo-file'), 'free-photo-heading-readout');
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }

  global.PhotoHeading = Object.freeze({ label, headingOf });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', setup, { once: true });
  else setup();
})(globalThis);
