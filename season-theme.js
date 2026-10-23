(function (global) {
  'use strict';

  const SEASONS = new Set(['spring', 'summer', 'autumn', 'winter']);
  const ICON_BASES = [
    'my-photos-icon',
    'icon-pin',
    'icon-sunrise',
    'icon-sunset',
    'icon-car',
    'icon-memo',
    'icon-lock',
    'icon-compass'
  ];
  const root = document.documentElement;
  const themeMeta = document.querySelector('meta[name="theme-color"]');
  let iconObserverStarted = false;

  function updateIcon(img, season) {
    if (!img || !season || !SEASONS.has(season)) return;
    const src = img.getAttribute('src');
    if (!src) return;

    const pathEnd = src.search(/[?#]/);
    const path = pathEnd === -1 ? src : src.slice(0, pathEnd);
    const slashIndex = path.lastIndexOf('/');
    const filename = path.slice(slashIndex + 1);
    const match = filename.match(/^(.+?)(?:-(spring|summer|winter))?\.png$/);
    if (!match || !ICON_BASES.includes(match[1])) return;

    const base = match[1];
    img.dataset.iconBase = base;
    const targetFilename = base + (season === 'autumn' ? '' : '-' + season) + '.png';
    if (filename === targetFilename) return;

    const prefix = slashIndex === -1 ? '' : path.slice(0, slashIndex + 1);
    img.setAttribute('src', prefix + targetFilename + src.slice(path.length));
  }

  function updateIconsIn(node, season) {
    if (!node || !season || !SEASONS.has(season)) return;
    if (node.nodeType === 1 && node.matches('img')) updateIcon(node, season);
    if (typeof node.querySelectorAll === 'function') {
      node.querySelectorAll('img').forEach((img) => updateIcon(img, season));
    }
  }

  function updateAllIcons(season) {
    if (!season || !SEASONS.has(season)) return;
    document.querySelectorAll('img').forEach((img) => updateIcon(img, season));
  }

  function observeIcons() {
    if (iconObserverStarted) return;
    if (!document.body) {
      document.addEventListener('DOMContentLoaded', observeIcons, { once: true });
      return;
    }

    iconObserverStarted = true;
    updateAllIcons(current());
    const observer = new MutationObserver((records) => {
      const season = current();
      records.forEach((record) => {
        record.addedNodes.forEach((node) => updateIconsIn(node, season));
      });
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }

  function apply(season) {
    if (!SEASONS.has(season)) return current();
    root.dataset.theme = season;
    if (themeMeta) {
      const background = global.getComputedStyle(root).getPropertyValue('--bg-primary').trim();
      if (background) themeMeta.content = background;
    }
    updateAllIcons(season);
    return season;
  }

  function current() {
    return root.dataset.theme || null;
  }

  const params = new URLSearchParams(global.location.search || '');
  const requestedSeason = params.get('season');
  const initialSeason = SEASONS.has(requestedSeason)
    ? requestedSeason
    : global.SpotData && typeof global.SpotData.getCurrentSeason === 'function'
      ? global.SpotData.getCurrentSeason()
      : 'spring';

  global.SeasonTheme = Object.freeze({ apply, current });
  observeIcons();
  apply(initialSeason);
})(globalThis);
