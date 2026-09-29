/* eslint-disable no-undef */

/**
 * STORM 12 WEATHER - SERVICE WORKER
 *
 * Its only job is notifications. Nothing here caches the site or intercepts
 * a request: a weather app showing yesterday's radar from a cache would be
 * worse than one that simply fails to load.
 *
 * The push that wakes this up carries no payload, so the first thing it does
 * is ask the API what happened. That keeps the encryption key material out
 * of the station's hands entirely, and means a notification always shows the
 * newest wording rather than whatever was true when the push was queued.
 */

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

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
        icon: '/favicon.svg',
        badge: '/favicon.svg',
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
