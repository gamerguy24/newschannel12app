/**
 * WEB PUSH
 *
 * Sends a notification to a browser that has subscribed, whether or not the
 * site is open. That is the whole point: an in-page banner is useless for a
 * tornado warning, because the viewer is not looking at the page.
 *
 * Two things make this small enough to do here rather than pull in a library:
 *
 * The push is sent with no payload. RFC 8291 payload encryption is real work
 * - ECDH against the subscriber's key, HKDF, AES-GCM - and buys nothing here,
 * because the service worker can simply ask the API what the notification
 * says. A bodyless push is just an authenticated POST to the endpoint. It
 * also means a subscription record needs only its endpoint: we never hold
 * the keys that would let us encrypt to that browser.
 *
 * Authentication is VAPID: a short-lived ES256 JWT saying who is sending and
 * to which push service. Web Crypto in Workers signs that directly.
 */

const b64url = (bytes) => {
  let binary = '';
  const view = new Uint8Array(bytes);
  for (let i = 0; i < view.length; i += 1) binary += String.fromCharCode(view[i]);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

const encode = (value) => b64url(new TextEncoder().encode(JSON.stringify(value)));

/** True when the keys are configured; without them nothing can be sent. */
export const pushConfigured = (env) => Boolean(env?.VAPID_PUBLIC_KEY && env?.VAPID_PRIVATE_JWK);

let signingKey = null;

async function privateKey(env) {
  if (signingKey) return signingKey;
  const jwk = JSON.parse(env.VAPID_PRIVATE_JWK);
  signingKey = await crypto.subtle.importKey(
    'jwk',
    { ...jwk, key_ops: ['sign'], ext: true },
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign'],
  );
  return signingKey;
}

/**
 * A VAPID token for one push service.
 *
 * The audience is the push service's origin, not the endpoint, and the token
 * is short lived. Twelve hours is the common ceiling; an hour is plenty for a
 * send that happens immediately.
 */
async function vapidToken(env, audience) {
  const header = encode({ typ: 'JWT', alg: 'ES256' });
  const body = encode({
    aud: audience,
    exp: Math.floor(Date.now() / 1000) + 3600,
    sub: env.VAPID_SUBJECT || 'mailto:weather@storm12weather.example',
  });

  const signature = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    await privateKey(env),
    new TextEncoder().encode(`${header}.${body}`),
  );

  return `${header}.${body}.${b64url(signature)}`;
}

/**
 * Poke one subscriber.
 *
 * Returns whether the subscription is still good. A push service answers 404
 * or 410 for an endpoint that has been revoked - the browser uninstalled, the
 * viewer cleared their data - and those should be dropped rather than retried
 * forever.
 */
export async function sendPush(env, endpoint) {
  if (!pushConfigured(env)) return { ok: false, gone: false, status: 0 };

  let audience;
  try {
    audience = new URL(endpoint).origin;
  } catch {
    return { ok: false, gone: true, status: 0 };
  }

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        TTL: '3600',
        Authorization: `vapid t=${await vapidToken(env, audience)}, k=${env.VAPID_PUBLIC_KEY}`,
        // Urgency matters to battery-saving push services: a warning should
        // wake the device rather than wait for the next convenient moment.
        Urgency: 'high',
        'Content-Length': '0',
      },
    });

    return {
      ok: response.ok,
      gone: response.status === 404 || response.status === 410,
      status: response.status,
    };
  } catch {
    // A push service that cannot be reached is not a dead subscription.
    return { ok: false, gone: false, status: 0 };
  }
}

/**
 * Send to everybody, and report which endpoints are dead.
 *
 * Sends run in parallel but in batches: a station with thousands of
 * subscribers would otherwise open thousands of sockets at once, and a
 * Worker has a cap on concurrent connections.
 */
export async function fanOut(env, endpoints) {
  const dead = [];
  let sent = 0;

  for (let i = 0; i < endpoints.length; i += 40) {
    const batch = endpoints.slice(i, i + 40);
    const results = await Promise.all(batch.map((endpoint) => sendPush(env, endpoint)));
    results.forEach((result, j) => {
      if (result.ok) sent += 1;
      if (result.gone) dead.push(batch[j]);
    });
  }

  return { sent, dead };
}
