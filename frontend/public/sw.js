/* eslint-disable no-undef */

/**
 * STORM 12 WEATHER - SERVICE WORKER
 *
 * Two jobs: notifications, and enough offline capability to be installable.
 *
 * What it deliberately does not do is cache weather. A weather app that
 * serves yesterday's radar from a cache is worse than one that admits it
 * cannot reach the network - so every /api/ request goes straight past this
 * and the app shows its own "unavailable" state when it fails.
 *
 * What is cached is the shell: the HTML and the content-hashed bundles. That
 * is what lets the app open from the home screen without a connection and
 * then say honestly that it has no data, rather than showing a dead browser
 * error page.
 */

const SHELL = 'storm12-shell-v1';
const SHELL_URLS = ['/', '/favicon.svg', '/icons/icon-192.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(SHELL);
      // Best effort: a missing file must not block the install.
      await Promise.all(SHELL_URLS.map((url) => cache.add(url).catch(() => undefined)));
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(names.filter((name) => name !== SHELL).map((name) => caches.delete(name)));
      await self.clients.claim();
    })(),
  );
});

/** Content-hashed, so a cache hit can never be the wrong version. */
const immutable = (pathname) =>
  pathname.startsWith('/assets/') || pathname.startsWith('/icons/') || pathname === '/favicon.svg';

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  // Someone else's tiles and fonts are their business.
  if (url.origin !== self.location.origin) return;
  // Weather is never served from a cache. Not radar, not alerts, not a
  // forecast - stale data here is the one failure that actually matters.
  if (url.pathname.startsWith('/api/')) return;

  if (request.mode === 'navigate') {
    event.respondWith(
      (async () => {
        try {
          const fresh = await fetch(request);
          const cache = await caches.open(SHELL);
          // Keep the shell current while there is a connection.
          cache.put('/', fresh.clone()).catch(() => undefined);
          return fresh;
        } catch {
          const cached = await caches.match('/', { cacheName: SHELL });
          if (cached) return cached;
          throw new Error('offline and no shell cached');
        }
      })(),
    );
    return;
  }

  if (immutable(url.pathname)) {
    event.respondWith(
      (async () => {
        const cached = await caches.match(request, { cacheName: SHELL });
        if (cached) return cached;
        const fresh = await fetch(request);
        if (fresh.ok) {
          const cache = await caches.open(SHELL);
          cache.put(request, fresh.clone()).catch(() => undefined);
        }
        return fresh;
      })(),
    );
  }
});

/* --------------------------------------------------------- notifications */

/**
 * The push that wakes this up carries no payload, so the first thing it does
 * is ask the API what happened. That keeps encryption key material out of the
 * station's hands entirely, and means a notification always shows the newest
 * wording rather than whatever was true when the push was queued.
 */
self.addEventListener('push', (event) => {
  event.waitUntil(
    (async () => {
      let notice = null;
      try {
        const response = await fetch('/api/notifications/latest', { cache: 'no-store' });
        if (response.ok) notice = (await response.json())?.data?.notice ?? null;
      } catch {
        // Offline, or the API is down. A push must still put something on
        // screen: the browser shows its own "site updated" notice otherwise,
        // which looks broken.
      }

      const isAlert = notice?.kind === 'alert';
      await self.registration.showNotification(notice?.title || 'Storm 12 Weather', {
        body: notice?.body || 'Tap to open the latest from Storm 12 Weather.',
        icon: '/icons/icon-192.png',
        badge: '/icons/icon-192.png',
        // Tagged by notice, so the same warning arriving twice replaces its
        // predecessor instead of stacking up.
        tag: notice?.id || 'storm12',
        renotify: true,
        // A warning stays until it is dealt with; a new blog post does not.
        requireInteraction: isAlert,
        data: { url: notice?.url || '/' },
      });
    })(),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = event.notification.data?.url || '/';

  event.waitUntil(
    (async () => {
      const open = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      // Reuse a tab that is already on the site rather than piling up
      // windows every time a warning is tapped.
      for (const client of open) {
        if ('focus' in client) {
          await client.focus();
          if ('navigate' in client) await client.navigate(target).catch(() => undefined);
          return;
        }
      }
      await self.clients.openWindow(target);
    })(),
  );
});
