'use strict';

const CACHE = 'our-season-v1';
const PRECACHE_FILES = [
  './',
  'index.html',
  'manifest.webmanifest',
  'style.css',
  'icons.css',
  'auth.css',
  'pwa.css',
  'geo-calculator.js',
  'exif-gps-reader.js',
  'photo-heading.js',
  'spots-data.js',
  'reference-photos.js',
  'image-compressor.js',
  'upload-validator.js',
  'invite.js',
  'free-places-data.js',
  'free-places.js',
  'supabase-config.js',
  'upload-draft-storage.js',
  'auth.js',
  'my-photos.js',
  'camera-capture.js',
  'app.js',
  'free-upload.js',
  'modal-back.js',
  'free-photo-viewer.js',
  'free-records.js',
  'map-feature.js',
  'compass.js',
  'naver-route.js',
  'screens.js',
  'upload-draft-resume.js',
  'pwa.js',
  'my-photos-icon.png',
  'icon-pin.png',
  'icon-sunrise.png',
  'icon-sunset.png',
  'icon-car.png',
  'icon-memo.png',
  'icon-lock.png',
  'icon-compass.png',
  'icon-192.png',
  'icon-512.png',
  'icon-maskable-512.png',
  'apple-touch-icon.png',
  'favicon-32.png',
  'favicon.ico'
];

function isInScope(url) {
  return url.origin === self.location.origin && url.pathname.startsWith(new URL(self.registration.scope).pathname);
}

function isAdminPage(url) {
  return /(?:^|\/)admin\.html$/.test(url.pathname);
}

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await Promise.all(PRECACHE_FILES.map(async path => {
      const url = new URL(path, self.registration.scope);
      try {
        const response = await fetch(url.href, { cache: 'reload' });
        if (response.ok && response.type === 'basic' && isInScope(url) && !isAdminPage(url)) {
          await cache.put(url.href, response);
        }
      } catch (error) {
        // 개별 파일을 미리 가져오지 못해도 서비스 워커 설치는 계속합니다.
      }
    }));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter(name => name.startsWith('our-season-') && name !== CACHE).map(name => caches.delete(name)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (!isInScope(url)) return;

  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    try {
      const response = await fetch(request);
      if (response.ok && response.type === 'basic' && !isAdminPage(url)) {
        await cache.put(request, response.clone());
      }
      return response;
    } catch (error) {
      if (isAdminPage(url)) return Response.error();
      const cached = await cache.match(request);
      if (cached) return cached;
      if (request.mode === 'navigate') {
        const appShell = await cache.match(new URL('index.html', self.registration.scope).href);
        if (appShell) return appShell;
      }
      return new Response('오프라인 상태이며 저장된 페이지가 없습니다.', {
        status: 503,
        statusText: 'Service Unavailable',
        headers: { 'Content-Type': 'text/plain; charset=utf-8' }
      });
    }
  })());
});
