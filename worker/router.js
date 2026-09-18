/**
 * A very small Express-compatible router, for Workers.
 *
 * The route files in backend/src/routes are ~1,400 lines of working, tested
 * code that touch only a sliver of Express: get/post/put/delete, req.query,
 * req.params, req.body, req.headers, req.on('close'), and res.json/set/status/
 * write/flushHeaders/end. Reimplementing that sliver against the platform's
 * own Request and Response is a far smaller risk than hand-translating every
 * route and hoping nothing was transcribed wrong.
 *
 * Streaming is the piece with teeth: the alert stream calls res.write() long
 * after its handler returned, so the Response resolves the moment headers are
 * flushed and stays open, fed by writes that arrive later.
 */

const BACKSLASH = String.fromCharCode(92);
const REGEX_SPECIAL = new Set(['.', '*', '+', '?', '^', '$', '{', '}', '(', ')', '|', '[', ']']);

const escapeLiteral = (segment) => {
  let out = '';
  for (const ch of segment) out += REGEX_SPECIAL.has(ch) ? BACKSLASH + ch : ch;
  return out;
};

const IDENT = /[A-Za-z0-9_]/;

/**
 * Turn '/radar/nexrad/:site/:product.png' into a matcher.
 *
 * A parameter can carry a literal suffix inside its own segment: Express
 * reads ':product.png' as the parameter `product` followed by '.png', and the
 * radar routes lean on exactly that to tell a PNG request from a metadata one.
 * The capture is lazy so the suffix, not the parameter, wins the dot.
 */
function compile(path) {
  const names = [];
  const pattern = path
    .split('/')
    .map((segment) => {
      if (!segment) return '';
      if (segment === '*') return '.*';

      let out = '';
      let i = 0;
      while (i < segment.length) {
        if (segment[i] === ':') {
          let j = i + 1;
          while (j < segment.length && IDENT.test(segment[j])) j += 1;
          names.push(segment.slice(i + 1, j));
          out += '([^/]+?)';
          i = j;
        } else {
          out += escapeLiteral(segment[i]);
          i += 1;
        }
      }
      return out;
    })
    .join('/');
  return { regex: new RegExp('^' + (pattern || '/') + '/?$'), names };
}

export function Router() {
  const stack = [];
  const add = (method) => (path, ...handlers) => {
    const { regex, names } = compile(path);
    stack.push({ method, regex, names, handlers });
    return router;
  };
  const router = {
    stack,
    get: add('GET'),
    post: add('POST'),
    put: add('PUT'),
    delete: add('DELETE'),
    patch: add('PATCH'),
  };
  return router;
}

/** Express's next(): run the chain, and let a thrown error reject the run. */
async function runChain(handlers, req, res) {
  let index = 0;
  const next = async (err) => {
    if (err) throw err;
    const handler = handlers[index];
    index += 1;
    if (!handler) return undefined;
    return handler(req, res, next);
  };
  await next();
}

function buildRequest(request, url, params, body, listeners) {
  const query = {};
  for (const key of new Set(url.searchParams.keys())) {
    const all = url.searchParams.getAll(key);
    // Express hands back a string for one value and an array for repeats.
    query[key] = all.length > 1 ? all : all[0];
  }
  const headers = {};
  for (const [key, value] of request.headers) headers[key.toLowerCase()] = value;

  return {
    method: request.method,
    url: url.pathname + url.search,
    originalUrl: url.pathname + url.search,
    path: url.pathname,
    protocol: url.protocol.replace(':', ''),
    query,
    params,
    body,
    headers,
    raw: request,
    on(event, listener) {
      (listeners[event] ??= []).push(listener);
    },
  };
}

/**
 * The res half. Resolves with a Response as soon as the handler either sends
 * a body or flushes headers for a stream.
 */
function buildResponse(resolve) {
  const headers = new Headers();
  let status = 200;
  let streamController = null;
  let finished = false;
  const encoder = new TextEncoder();

  const startStream = () => {
    if (streamController) return;
    const stream = new ReadableStream({
      start(controller) {
        streamController = controller;
      },
    });
    resolve(new Response(stream, { status, headers }));
  };

  const finish = (payload) => {
    if (finished) return;
    finished = true;
    if (streamController) {
      if (payload !== undefined && payload !== null) streamController.enqueue(encoder.encode(String(payload)));
      try {
        streamController.close();
      } catch {
        // Already closed by a client that went away; nothing to do.
      }
      return;
    }
    resolve(new Response(payload ?? null, { status, headers }));
  };

  return {
    get headersSent() {
      return finished || streamController !== null;
    },
    set(key, value) {
      if (key && typeof key === 'object') {
        for (const [k, v] of Object.entries(key)) headers.set(k, String(v));
      } else {
        headers.set(key, String(value));
      }
      return this;
    },
    setHeader(key, value) {
      return this.set(key, value);
    },
    status(code) {
      status = code;
      return this;
    },
    json(payload) {
      headers.set('content-type', 'application/json; charset=utf-8');
      finish(JSON.stringify(payload));
      return this;
    },
    send(payload) {
      finish(payload);
      return this;
    },
    flushHeaders() {
      startStream();
      return this;
    },
    write(chunk) {
      startStream();
      if (finished) return false;
      try {
        streamController.enqueue(encoder.encode(String(chunk)));
      } catch {
        return false;
      }
      return true;
    },
    end(payload) {
      finish(payload);
      return this;
    },
  };
}

/**
 * Match one request against the mounted routers and run it. Returns null when
 * nothing matches, so the caller can 404 in its own voice.
 */
export async function dispatch(mounts, request, url, context = {}) {
  for (const { prefix, router } of mounts) {
    if (prefix && !url.pathname.startsWith(prefix)) continue;
    const rest = (prefix ? url.pathname.slice(prefix.length) : url.pathname) || '/';

    for (const route of router.stack) {
      if (route.method !== request.method) continue;
      const match = route.regex.exec(rest);
      if (!match) continue;

      const params = {};
      route.names.forEach((name, i) => {
        params[name] = decodeURIComponent(match[i + 1] ?? '');
      });

      let body;
      if (request.method !== 'GET' && request.method !== 'HEAD') {
        body = await request.json().catch(() => ({}));
      }

      const listeners = {};
      const fire = (event) => {
        for (const listener of listeners[event] ?? []) {
          try {
            listener();
          } catch {
            // A teardown callback must never take the response with it.
          }
        }
      };
      // A viewer closing an SSE tab is the normal way these streams end.
      request.signal?.addEventListener('abort', () => fire('close'), { once: true });

      let resolve;
      const settled = new Promise((r) => {
        resolve = r;
      });
      const req = buildRequest(request, url, params, body, listeners);
      // Handlers that write state need the bindings; nothing else touches these.
      req.env = context.env;
      req.ctx = context.ctx;
      const res = buildResponse(resolve);

      const run = runChain(route.handlers, req, res);
      // Whichever lands first: the handler sending, or the handler throwing.
      // A streaming handler resolves `settled` and keeps running afterwards.
      return await Promise.race([settled, run.then(() => settled)]);
    }
  }
  return null;
}

export default { Router, dispatch };
