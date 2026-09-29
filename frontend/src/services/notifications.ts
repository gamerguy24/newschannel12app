import { apiGet } from '../api/client';

/**
 * NOTIFICATIONS, VIEWER SIDE
 *
 * Web push rather than an in-page banner: a warning is worth sending
 * precisely because the viewer is not looking at the site.
 *
 * Three things have to line up - the browser supports push, the viewer has
 * granted permission, and the station has keys configured - and each fails
 * differently, so the state is reported rather than reduced to a boolean.
 */

export type PushState =
  | 'unsupported'
  | 'unconfigured'
  | 'denied'
  | 'off'
  | 'on';

export const pushSupported = () =>
  typeof window !== 'undefined' &&
  'serviceWorker' in navigator &&
  'PushManager' in window &&
  'Notification' in window;

/** The VAPID key arrives base64url; subscribe() wants raw bytes. */
function decodeKey(key: string): Uint8Array {
  const padded = key.padEnd(key.length + ((4 - (key.length % 4)) % 4), '=');
  const raw = atob(padded.replace(/-/g, '+').replace(/_/g, '/'));
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

const serverKey = () => apiGet<{ publicKey: string | null; configured: boolean }>('/notifications/key');

async function registration(): Promise<ServiceWorkerRegistration> {
  const existing = await navigator.serviceWorker.getRegistration('/');
  return existing ?? navigator.serviceWorker.register('/sw.js', { scope: '/' });
}

/** Where this device stands right now. */
export async function pushState(): Promise<PushState> {
  if (!pushSupported()) return 'unsupported';
  if (Notification.permission === 'denied') return 'denied';

  try {
    const { configured } = await serverKey();
    if (!configured) return 'unconfigured';
  } catch {
    return 'unconfigured';
  }

  const reg = await navigator.serviceWorker.getRegistration('/');
  const sub = await reg?.pushManager.getSubscription();
  return sub ? 'on' : 'off';
}

/**
 * Ask for permission and subscribe.
 *
 * The browser only offers the prompt in response to a gesture, so this must
 * be called straight from a click - not from an effect.
 */
export async function enablePush(): Promise<PushState> {
  if (!pushSupported()) return 'unsupported';

  // Permission first, before any await that is not the prompt itself.
  // Safari in particular drops the user-gesture chain across a fetch, and
  // then the prompt never appears.
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return permission === 'denied' ? 'denied' : 'off';

  const { publicKey, configured } = await serverKey();
  if (!configured || !publicKey) return 'unconfigured';

  const reg = await registration();
  await navigator.serviceWorker.ready;

  const existing = await reg.pushManager.getSubscription();
  const sub =
    existing ??
    (await reg.pushManager.subscribe({
      // Required by every browser: a push must always show something, which
      // is what the service worker does.
      userVisibleOnly: true,
      applicationServerKey: decodeKey(publicKey) as BufferSource,
    }));

  await fetch('/api/notifications/subscribe', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ endpoint: sub.endpoint }),
  });

  return 'on';
}

/** Stop here. The browser subscription goes too, not just the server record. */
export async function disablePush(): Promise<PushState> {
  const reg = await navigator.serviceWorker.getRegistration('/');
  const sub = await reg?.pushManager.getSubscription();
  if (!sub) return 'off';

  await fetch('/api/notifications/unsubscribe', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ endpoint: sub.endpoint }),
  }).catch(() => undefined);

  await sub.unsubscribe().catch(() => undefined);
  return 'off';
}
