# hisab-proxy: the Cloudflare Worker in front of Cloud Run

`hisab.sumittripathi.dev` is served by this Worker, which forwards every request to the `hisaab-web` Cloud Run service
(`ORIGIN` in `wrangler.toml`). Cloud Run domain mapping isn't available in asia-south1, so this takes its place.
Cloudflare manages `sumittripathi.dev`; the apex is a separate Vercel site and this Worker never touches it.

The route is a **Workers Custom Domain**, so the first deploy creates the `hisab` DNS record and its certificate. There
is no `*.workers.dev` URL and no preview URLs (`workers_dev = false`, `preview_urls = false`).

## Deploy

From the repo root, logged in to the Cloudflare account that owns `sumittripathi.dev`:

```bash
pnpm dlx wrangler@4.149.0 login        # once per machine
pnpm dlx wrangler@4.149.0 deploy --config infra/cloudflare-worker/wrangler.toml
```

Until the secret below is set, the Worker answers every request with a 500 and forwards nothing.

## The secret

`PROXY_SECRET` is a Worker secret, never in `wrangler.toml` or git. Its value is the `HISAAB_PROXY_SECRET` secret in
Secret Manager (created by `infra/setup.sh`), which Cloud Run also gets as `PROXY_SECRET`. Pipe it across so it is never
printed or kept in shell history:

```bash
gcloud secrets versions access latest --secret=HISAAB_PROXY_SECRET --project advance-wavelet-409207 |
  pnpm dlx wrangler@4.149.0 secret put PROXY_SECRET --config infra/cloudflare-worker/wrangler.toml
```

To rotate it: add a new Secret Manager version, run the command above, then redeploy Cloud Run (merge to `main`). In
between, the two copies differ and the app answers 403, so do the last two steps back to back.

## What it does to each request

| Header | Set to | Why |
|---|---|---|
| `x-hisaab-proxy-secret` | `PROXY_SECRET` | The app's proxy gate (`src/proxy.ts`) refuses requests without it once Cloud Run has `PROXY_SECRET`, so the run.app URL can't be used to skip this Worker. The app drops the header before any page or route sees it. |
| `x-forwarded-for` | `cf-connecting-ip` | The visitor's IP, for Better Auth's per-IP rate limits. Cloud Run appends this Worker's Cloudflare egress IP after it, which `trustedProxies` in `src/lib/auth.ts` skips while the gate is on. |
| `x-forwarded-host` | the incoming host | Next.js checks a Server Action's `Origin` against this (it prefers it to `Host`, which is the run.app name). |
| `x-forwarded-proto` | `https` | The public scheme. |
| `x-real-ip`, `host` | removed | `host` comes from the upstream URL, which Cloud Run routes on. |

Client-sent copies of all of these are dropped first, so a visitor can't choose their own IP or guess at the secret.
The method and body are streamed through (never a body on GET or HEAD), and redirects are passed back, not followed.

On the way back, a `Location` pointing at the run.app URL is rewritten to `https://hisab.sumittripathi.dev`; every
`Set-Cookie` header is kept, and the body streams through unbuffered, so server-sent events work.

The logic is `proxy()` in `src/index.js`, tested in `test/cloudflare-worker.test.ts` (`pnpm test`).
