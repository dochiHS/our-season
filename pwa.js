(function (global) {
  'use strict';

  const IOS_DISMISSED_KEY = 'our-season-pwa-ios-notice-dismissed';
  let deferredInstallPrompt = null;
  let installButton = null;
  let iosNotice = null;

  function addStylesheet() {
    if (document.querySelector('link[href="pwa.css"]')) return;
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = 'pwa.css';
    document.head.appendChild(link);
  }

  function isStandalone() {
    return global.navigator.standalone === true || Boolean(global.matchMedia && global.matchMedia('(display-mode: standalone)').matches);
  }

  function isIosSafari() {
    const ua = global.navigator.userAgent || '';
    const isIos = /iPad|iPhone|iPod/.test(ua) || (global.navigator.platform === 'MacIntel' && global.navigator.maxTouchPoints > 1);
    const isSafari = /Safari/i.test(ua) && !/(CriOS|FxiOS|EdgiOS|OPiOS|Chrome|Chromium|Firefox|Edg)/i.test(ua);
    return isIos && isSafari;
  }

  function getHomeSearchWrap() {
    return document.querySelector('#home-screen .home-search-wrap');
  }

  function ensureArea() {
    const wrap = getHomeSearchWrap();
    if (!wrap) return null;
    let area = wrap.querySelector('.home-pwa-area');
    if (!area) {
      area = document.createElement('div');
      area.className = 'home-pwa-area';
      const authStatus = document.getElementById('home-auth-status');
      if (authStatus && authStatus.parentNode === wrap) authStatus.insertAdjacentElement('afterend', area);
      else wrap.appendChild(area);
    }
    return area;
  }

  function createInstallButton() {
    const area = ensureArea();
    if (!area || installButton) return;
    installButton = document.createElement('button');
    installButton.type = 'button';
    installButton.className = 'home-pwa-install-button';
    installButton.textContent = '홈 화면에 앱 추가';
    installButton.hidden = true;
    area.appendChild(installButton);
    installButton.addEventListener('click', async () => {
      if (!deferredInstallPrompt) return;
      const promptEvent = deferredInstallPrompt;
      deferredInstallPrompt = null;
      installButton.hidden = true;
      try {
        await promptEvent.prompt();
        const choice = await promptEvent.userChoice;
        if (choice && choice.outcome !== 'accepted' && !isStandalone()) {
          deferredInstallPrompt = null;
          installButton.hidden = true;
        }
      } catch (error) {
        deferredInstallPrompt = null;
        installButton.hidden = true;
      }
    });
  }

  function wasIosNoticeDismissed() {
    try {
      return global.localStorage.getItem(IOS_DISMISSED_KEY) === 'true';
    } catch (error) {
      return false;
    }
  }

  function createIosNotice() {
    const area = ensureArea();
    if (!area || iosNotice || wasIosNoticeDismissed()) return;
    iosNotice = document.createElement('div');
    iosNotice.className = 'home-pwa-ios-notice';
    const message = document.createElement('span');
    message.textContent = "공유 버튼 → '홈 화면에 추가'를 누르면 앱처럼 쓸 수 있어요";
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'home-pwa-ios-dismiss';
    close.setAttribute('aria-label', '설치 안내 닫기');
    close.textContent = '×';
    close.addEventListener('click', () => {
      iosNotice.hidden = true;
      try {
        global.localStorage.setItem(IOS_DISMISSED_KEY, 'true');
      } catch (error) {
        // 저장소를 사용할 수 없는 경우에도 현재 화면에서는 안내를 닫습니다.
      }
    });
    iosNotice.append(message, close);
    area.appendChild(iosNotice);
  }

  function updateForStandalone() {
    if (!isStandalone()) return;
    if (installButton) installButton.hidden = true;
    if (iosNotice) iosNotice.hidden = true;
  }

  function initialize() {
    addStylesheet();
    if ('serviceWorker' in global.navigator) {
      global.navigator.serviceWorker.register('sw.js').catch(() => {});
    }
    if (isStandalone()) return;

    const ua = global.navigator.userAgent || '';
    if (/Android/i.test(ua)) {
      createInstallButton();
      global.addEventListener('beforeinstallprompt', event => {
        event.preventDefault();
        deferredInstallPrompt = event;
        if (installButton && !isStandalone()) installButton.hidden = false;
      });
      global.addEventListener('appinstalled', () => {
        deferredInstallPrompt = null;
        if (installButton) installButton.hidden = true;
      });
    }
    if (isIosSafari()) createIosNotice();
    if (global.matchMedia) {
      const displayMode = global.matchMedia('(display-mode: standalone)');
      if (typeof displayMode.addEventListener === 'function') displayMode.addEventListener('change', updateForStandalone);
      else if (typeof displayMode.addListener === 'function') displayMode.addListener(updateForStandalone);
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initialize, { once: true });
  else initialize();
})(globalThis);
