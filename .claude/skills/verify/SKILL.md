---
name: verify
description: Build/launch/drive recipe for manually verifying TrackingLink (api + web) end-to-end
---

# Verifying TrackingLink locally

This is a pnpm workspace with two apps that must run together for a real
end-to-end check: `packages/api` (Hono Worker on Cloudflare D1) and
`packages/web` (Vite/React SPA).

## 1. Local D1 + API

```sh
cd packages/api
npx wrangler d1 execute trackinglink-db --local --file=./schema.sql   # idempotent
npx wrangler dev --local        # serves on http://localhost:8789
```

`.dev.vars` already has `ADMIN_PASSWORD=dev-admin-password` and
`JWT_SECRET` for local dev — no setup needed. The local D1 file lives
under `packages/api/.wrangler/state` and **persists across sessions**
(it's gitignored), so previously-seeded test projects/QR codes will
still be there next time — check `GET /projects` before assuming a
clean slate.

Get a session token for API testing without the browser:

```sh
curl -s -X POST http://localhost:8789/auth/login \
  -H "Content-Type: application/json" \
  -d '{"password":"dev-admin-password"}'
# -> { "token": "..." }
```

## 2. Web dev server against the local API

```sh
cd packages/web
VITE_API_URL=http://localhost:8789 npx vite --port 5173
```

(Don't use the default `pnpm dev`, which points at the production
`VITE_API_URL` baked into `.env.local`.)

## 3. Driving the browser

Playwright's own browser download (`npx playwright install`) is
**blocked in this sandbox** — `cdn.playwright.dev` doesn't resolve.
Instead, reuse the system Chrome and only install `playwright-core`
(pure JS, comes from the npm registry which *is* reachable):

```sh
mkdir -p <scratchpad>/pw && cd <scratchpad>/pw
npm init -y && npm install playwright-core
```

```js
const { chromium } = require('playwright-core');
const browser = await chromium.launch({
  executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  headless: true,
});
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
```

Gotcha: the layout renders **both** a mobile card list (`md:hidden`)
and a desktop table (`hidden md:block`) for the same data, so a plain
`text=...` locator matches twice (one hidden). Force viewport width
≥768px (md breakpoint) and scope locators to `td:has-text(...)` /
`tr:has-text(...)` for the desktop table to avoid picking the hidden
mobile node.

Login flow: go to `/login`, fill `#password`, click the submit
button, `waitForURL('**/links')`.

## Notes

- `pnpm --filter @tracking-link/web dev` / `wrangler dev` (no
  `--local`) both talk to production — never use them for
  verification.
- Background wrangler/vite processes: don't pipe through `| tail`
  when backgrounding — output buffers until the process exits and
  you'll see nothing until it's too late to be useful.
