// 아래에서 올라오는 창(사진 등록·사진 보기)을 휴대폰 뒤로가기로 닫을 수 있게 한다.
// 창이 열리면 같은 주소로 기록을 하나 쌓고, 뒤로가기가 눌리면 화면 이동 대신 그 창만 닫는다.
(function (global) {
  'use strict';

  const MARKER = '__modalBack';
  let openId = null;

  function openModals() {
    return Array.prototype.slice.call(document.querySelectorAll('.modal-overlay.open'));
  }

  function markerOf(state) {
    return state && typeof state === 'object' ? state[MARKER] : null;
  }

  function onOpened() {
    if (openId) return;
    openId = 'modal-' + Date.now() + '-' + Math.random().toString(36).slice(2);
    const base = global.history.state && typeof global.history.state === 'object' ? global.history.state : {};
    const next = Object.assign({}, base);
    next[MARKER] = openId;
    global.history.pushState(next, '', global.location.href);
  }

  function onClosed() {
    if (!openId) return;
    const id = openId;
    openId = null;
    // X 버튼 등으로 닫혔을 때는 쌓아 둔 기록을 걷어 내 뒤로가기가 한 번 더 필요 없게 한다.
    if (markerOf(global.history.state) === id) global.history.back();
  }

  function sync() {
    if (openModals().length) onOpened();
    else onClosed();
  }

  global.addEventListener('popstate', function () {
    if (!openId) return;
    if (markerOf(global.history.state) === openId) return;
    // 뒤로가기로 기록이 이미 빠졌으니 다시 back 하지 않도록 먼저 비운다.
    openId = null;
    openModals().forEach(function (modal) {
      const closeButton = modal.querySelector('.btn-close-modal');
      if (closeButton) closeButton.click();
      else modal.classList.remove('open');
    });
  });

  function start() {
    const observer = new MutationObserver(sync);
    observer.observe(document.body, { subtree: true, attributes: true, attributeFilter: ['class'], childList: true });
    sync();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})(window);
