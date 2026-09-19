# Deploying Storm 12 Weather

The whole station runs as **one Cloudflare Worker**: it serves the website and
the `/api` routes, decodes NEXRAD radar, and keeps newsroom state in a Durable
Object. There is no separate backend to host.

## What you need first

- **Workers Paid ($5/month).** Not optional. Decoding a Level III radar sweep
  is bzip2 plus a PNG encode - roughly 250ms of CPU. The free plan allows 10ms
  per request, so radar is the one feature that cannot run on it. Everything
  else would.
- Node 20 or newer, for building the site locally.

## First deploy

```bash
npx wrangler login                     # once, in a browser
npx wrangler secret put ADMIN_PASSWORD # the newsroom password; never in git
npm run deploy                         # builds the site, then deploys
```

`npm run deploy` runs the frontend build and `wrangler deploy` together, because
the Worker serves `frontend/dist` and a stale build would ship a stale site.

The Worker lands at `https://newschannel12app.<your-account>.workers.dev`.

## Deploying from GitHub instead

Use **Workers Builds**, not a Pages project. In the Cloudflare dashboard:
Workers & Pages → your Worker → Settings → Builds → connect the repository.

| Setting | Value |
|---|---|
| Build command | leave empty |
| Deploy command | `npx wrangler deploy` |
| Root directory | `/` |

The build command can be empty because `wrangler.jsonc` carries a build hook:
`wrangler deploy` runs `npm run build` itself before uploading. The Worker
serves `frontend/dist`, and a deploy that skipped the site build would fail
outright - so the build belongs with the deploy, not in a CI field somebody
has to remember to fill in.

A Pages project cannot run this app: Pages serves static files, and every
`/api` call would 404.

## Day-to-day

```bash
npm run dev       # Worker on :8787 and Vite on :5173, together
npm run dev:api   # just the Worker, on :8787 - serves the built site too
npm run build     # typecheck + build the frontend
```

`wrangler dev` runs the real Workers runtime locally, including the Durable
Object, so local behaviour matches production. Local newsroom state lives in
`.wrangler/state` and is not shared with the deployed site.

## Settings and secrets

Non-secret settings - the market, coverage states, radar site, ticker towns -
live in `vars` in `wrangler.jsonc`. Edit and redeploy, or override any of them
from the admin panel, which stores them in the Durable Object and wins over
`vars`.

`ADMIN_PASSWORD` is a secret, set with `wrangler secret put`. If it is unset,
the admin panel disables itself rather than opening unlocked. Locally it comes
from `.dev.vars`, which is gitignored.

## Playout output

Point vMix, OBS or TriCaster at:

```
https://<your-worker-domain>/output
```

as a 1920x1080 browser source. It is transparent, so lower thirds and the
temperature bug key straight over video.

**This address needs no password.** Anyone who can reach the site can see what
is on program. On a station network that is fine; if the Worker is on the open
internet and that matters, ask for a key to be added to the output address.

## What lives where

| Piece | Where |
|---|---|
| `worker/index.js` | Worker entry: routing, CORS, errors, assets |
| `worker/router.js` | Small Express-compatible router the routes run on |
| `worker/newsroom.js` | Durable Object: the only writable copy of station state |
| `worker/store-bridge.js` | Reads a state snapshot; sends writes to the Durable Object |
| `backend/src/` | Services and API routes, unchanged from the Node build |
| `frontend/` | The site, built to `frontend/dist` and served by the Worker |
