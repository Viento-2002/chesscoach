'use strict';
// ChessCoach service worker.
//  1. Web Push: shows the reminders and "analysis finished" notices the server sends.
//  2. Offline and speed: the app page is fetched fresh whenever you are online (so an update never gets stuck behind
//     an old copy) and falls back to the saved copy when you are not; the engine, opening book, icons and piece pictures
//     are kept on the device and refreshed quietly in the background. API calls are never cached.
const CACHE = 'cc-static-v2';   // bump when vendor/ files change in a way that must not be served stale
const SHELL = /\/(vendor|icons|engine)\/|\/book\.json$|\/manifest\.webmanifest$/;
const CDN = /^https:\/\/(cdn\.jsdelivr\.net|cdnjs\.cloudflare\.com)\//;

// Installing already saves the small essentials (page, chess library, opening book, icons), so the very first
// visit works offline afterwards. The 7 MB engine is saved the first time it is used.
self.addEventListener('install', e => e.waitUntil(
  caches.open(CACHE).then(async c => {
    try { await c.put('app-shell', await fetch('index.html', { cache: 'reload' })); } catch (err) { /* offline install: nothing to save yet */ }
    await Promise.all(['vendor/chess.min.js', 'book.json', 'manifest.webmanifest', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png']
      .map(u => fetch(u, { cache: 'reload' }).then(r => r.ok && c.put(u, r)).catch(() => {})));
  }).then(() => self.skipWaiting())
));
self.addEventListener('activate', e => e.waitUntil(
  caches.keys().then(keys => Promise.all(keys.filter(k => k.startsWith('cc-') && k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())
));

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  const sameOrigin = url.origin === self.location.origin;
  if (sameOrigin && (url.pathname.startsWith('/api/') || url.pathname.startsWith('/s/'))) return;   // always live
  if (sameOrigin && (req.mode === 'navigate' || /\/(index\.html)?$/.test(url.pathname))) {
    // the page itself: network first, saved copy when offline
    e.respondWith(fetch(req).then(res => { const copy = res.clone(); caches.open(CACHE).then(c => c.put('app-shell', copy)); return res; })
      .catch(() => caches.match('app-shell').then(r => r || Response.error())));
    return;
  }
  if (sameOrigin && SHELL.test(url.pathname)) {
    // engine, book, icons: serve the saved copy at once and refresh it in the background
    e.respondWith(caches.open(CACHE).then(async c => {
      const hit = await c.match(req);
      const net = fetch(req).then(res => { if (res.ok) c.put(req, res.clone()); return res; }).catch(() => null);
      return hit || (await net) || Response.error();
    }));
    return;
  }
  if (CDN.test(req.url)) {
    // piece pictures: never change, keep them. Always fetched in CORS mode (the CDN allows it), so the saved copy is a
    // normal response that works for plain <img> tags and for the canvas share image alike (an opaque copy would not).
    e.respondWith(caches.open(CACHE).then(async c => {
      const hit = await c.match(req.url);
      if (hit) return hit;
      try { const res = await fetch(req.url, { mode: 'cors' }); if (res.ok) c.put(req.url, res.clone()); return res; }
      catch (err) { try { return await fetch(req); } catch (e2) { return Response.error(); } }
    }));
  }
});

self.addEventListener('push', e => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (err) { d = { body: e.data ? e.data.text() : '' }; }
  e.waitUntil(self.registration.showNotification(d.title || 'ChessCoach', {
    body: d.body || 'Ten minutes of training today?',
    icon: 'icons/icon-192.png',
    badge: 'icons/icon-192.png',
    tag: d.tag || 'daily-training',
    data: { url: d.url || './' }
  }));
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  const url = (e.notification.data && e.notification.data.url) || './';
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
    for (const c of list) {
      if ('focus' in c) {
        c.postMessage({ type: 'open', url });   // the app is already open: ask it to show the game the notification is about
        return c.focus();
      }
    }
    return self.clients.openWindow(url);
  }));
});
