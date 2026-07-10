# TrackingLink

A self-hosted QR code link tracker on Cloudflare Workers + D1: print QR codes that redirect to
a destination URL, log every scan (time, location, user agent, IP), and see the results in a
small admin dashboard.

Originally built in-house for a university festival to track foot traffic from posters/flyers to
installed QR codes around a venue, and extracted as a standalone, generic project
([trackable-links-oss](https://github.com/gakusai-UoA/trackable-links-oss), MIT licensed).
TrackingLink is a rebrand/fork of that project for our own festival's use.

## How it works

- A **project** groups QR codes that all redirect to the same destination URL (e.g. one flyer
  campaign, one poster design).
- Each **QR code** belongs to a project and has its own **location** label (e.g. "Main entrance",
  "2F hallway"). Printed QR codes start with no location — the first scan shows a small
  passcode-gated form so whoever installs the code can label where it ended up.
- Every scan after that is logged (timestamp, user agent, IP) and redirects (HTTP 301) to the
  project's destination URL.
- The admin dashboard shows scan counts per project, a QR code manager (create/print/delete), and
  an analytics view (scans by hour and by location).

```
 Visitor scans QR ──▶ GET /?id={qrId} (packages/api) ──▶ log scan ──▶ 301 redirect
                                │
                                ▼
                      D1 database (Projects, QRCodes, AccessLogs)
                                ▲
                                │
        Admin dashboard (packages/web) ──▶ /projects/*, /auth/* (Bearer JWT)
```

## Packages

- [`packages/api`](packages/api) — a [Hono](https://hono.dev) Worker: the public redirect
  endpoint, the location-setup flow, and the authenticated project/QR-code management API. Data
  lives in a Cloudflare D1 (SQLite) database via [Drizzle ORM](https://orm.drizzle.team).
- [`packages/web`](packages/web) — a React + Vite + Tailwind admin dashboard that talks to the API
  over `fetch`. Deployable as static assets (Cloudflare Workers Assets, Pages, or any static host).

## Quick start (local development)

Requires Node 20+ and [pnpm](https://pnpm.io). **A Cloudflare account is *not* needed for local
development** — `wrangler dev` simulates the Worker and D1 database entirely on your machine
(Miniflare + a local SQLite file under `.wrangler/state`). You only need a Cloudflare account when
you get to [Deploy](#deploy).

```sh
pnpm install
```

### 1. Apply the schema to the local D1 database

No `wrangler d1 create` or Cloudflare login required for this step — it just initializes the local
SQLite file that Miniflare uses:

```sh
pnpm --filter @tracking-link/api run db:apply:local
```

### 2. Configure local secrets

This repo already ships `packages/api/.dev.vars` with local-only dev defaults, so you can skip
straight to [step 3](#3-run-locally). To use your own values instead:

```sh
cp packages/api/.dev.vars.example packages/api/.dev.vars
```

Edit `packages/api/.dev.vars` and set:

| Variable                   | Purpose                                                                 |
| --------------------------- | ------------------------------------------------------------------------ |
| `JWT_SECRET`                | Signs/verifies admin session tokens. Generate with `openssl rand -base64 48`. |
| `ADMIN_PASSWORD`            | The password used to log in to the admin dashboard.                    |
| `LOCATION_SETUP_PASSCODE`   | Shared passcode required to label a QR code's location after printing. |

### 3. Run locally

```sh
pnpm dev
```

This runs the API on `http://localhost:8789` and the dashboard on `http://localhost:5173`. Copy
`packages/web/.env.example` to `packages/web/.env.local` if you need to point the dashboard at a
different API URL.

Log in at `http://localhost:5173` with the `ADMIN_PASSWORD` from `packages/api/.dev.vars`. Out of
the box (unmodified `.dev.vars`) that's:

```
password: dev-admin-password
```

**Do not reuse these `.dev.vars` values in production.** Before deploying, create a real D1
database and set real secrets as described below.

## Deploy

Requires a Cloudflare account.

### 1. Create the remote D1 database

```sh
pnpm --filter @tracking-link/api exec wrangler d1 create trackinglink-db
```

Copy the printed `database_id` into `packages/api/wrangler.jsonc`, and set `account_id` at the
top of that file to your own Cloudflare account id (`wrangler whoami`).

Apply the schema to it:

```sh
pnpm --filter @tracking-link/api run db:apply:remote
```

### 2. Set production secrets

```sh
pnpm --filter @tracking-link/api exec wrangler secret put JWT_SECRET
pnpm --filter @tracking-link/api exec wrangler secret put ADMIN_PASSWORD
pnpm --filter @tracking-link/api exec wrangler secret put LOCATION_SETUP_PASSCODE
```

Use different, strong values from the local `.dev.vars` — generate `JWT_SECRET` with
`openssl rand -base64 48`.

### 3. Deploy

```sh
pnpm deploy:api   # deploys packages/api with `wrangler deploy`
pnpm deploy:web   # builds and deploys packages/web as static assets
```

Both `wrangler.jsonc` files have a commented-out `routes` block if you want to put them on a
custom domain instead of the default `workers.dev` subdomain. Set `VITE_API_URL` (via `.env`
or your CI) to the deployed API URL before building `packages/web`.

## Authentication

There's no external identity provider by default — the admin dashboard uses a single shared
`ADMIN_PASSWORD`. `POST /auth/login` exchanges it for a short-lived (24h) HS256 JWT that carries
the full permission bitmask; the dashboard sends it back as `Authorization: Bearer <token>` on
every request.

This lives behind one seam so it's easy to replace — [`packages/api/src/auth/`](packages/api/src/auth):

```
auth/
├── types.ts       # Verifier type + Bindings/AuthUser/HonoEnv — the contract everything else depends on
├── local.ts        # the built-in single-admin-password Verifier (signLocalSession/verifyLocalSession)
├── middleware.ts    # createAuthMiddleware(verifier) — turns any Verifier into Hono middleware
└── index.ts        # re-exports all of the above
```

A `Verifier` is just `(token, env) => Promise<{ sub, permissions } | null>`. To plug in a real
identity provider (Auth0, Clerk, your org's SSO, a per-user database, ...), write a function with
that signature and pass it to `createAuthMiddleware` in place of the built-in `verifyLocalSession`
— see the worked example in [`auth/types.ts`](packages/api/src/auth/types.ts). Nothing else in the
codebase needs to change: every route only depends on `c.get('user')` resolving to
`{ sub, permissions }`, not on how it got there. `POST /auth/login` and `GET /auth/me` in
[`routes/auth.ts`](packages/api/src/routes/auth.ts) are themselves just the default login flow —
replace or remove them if your provider handles login differently (e.g. an OAuth redirect).

### Permissions

Four independent bits, combined into one bitmask (see
[`packages/api/src/permissions.ts`](packages/api/src/permissions.ts)):

| Bit  | Value | Grants |
| ---- | ----- | ------ |
| `TRACKING_LINK_VIEW`      | 1 | List projects and QR codes |
| `TRACKING_LINK_EDIT`      | 2 | Create projects/QR codes, delete QR codes you created |
| `TRACKING_LINK_ANALYTICS` | 4 | View the analytics dashboard |
| `TRACKING_LINK_DELETE`    | 8 | Delete any project or QR code |

The built-in single-admin login always grants all four. If you add multi-user auth, issue a
`permissions` integer per user from whatever subset of these bits they should hold.

## API reference

All `/projects/*` routes require `Authorization: Bearer <token>`.

| Method | Path                              | Auth                | Description |
| ------ | ---------------------------------- | -------------------- | ----------- |
| GET    | `/?id={qrId}`                      | none                 | Scan a QR code: log the visit and redirect, or show the location-setup form |
| GET    | `/view/:qrId`                      | none                 | Human-readable info page for a QR code |
| POST   | `/api/set-location`                | passcode             | Label a QR code's location for the first time |
| POST   | `/api/edit-location/:qrId`         | passcode             | Re-label a QR code's location |
| POST   | `/auth/login`                      | none                 | Exchange `ADMIN_PASSWORD` for a session token |
| GET    | `/auth/me`                         | Bearer               | Resolve the current session |
| GET    | `/projects`                        | Bearer               | Paginated project list with scan counts |
| POST   | `/projects`                        | Bearer               | Create a project |
| GET    | `/projects/:id`                    | Bearer               | Project detail |
| PUT    | `/projects/:id`                    | Bearer               | Update a project |
| DELETE | `/projects/:id`                    | Bearer + `DELETE`    | Delete a project (QR codes cascade) |
| GET    | `/projects/:id/qrcodes`            | Bearer               | Paginated QR codes for a project |
| POST   | `/projects/:id/qrcodes`            | Bearer               | Create a QR code |
| GET    | `/projects/:id/access-stats`       | Bearer               | Scan counts grouped by hour × location |
| GET    | `/projects/:id/access-logs`        | Bearer               | Paginated raw scan log |
| GET    | `/projects/qrcodes`                | Bearer               | All QR codes across all projects |
| GET    | `/projects/qrcodes/:id`            | Bearer               | Single QR code |
| PUT    | `/projects/qrcodes/:id`            | Bearer               | Update a QR code's location |
| DELETE | `/projects/qrcodes/:id`            | Bearer + `DELETE`/own | Delete a QR code (and its scan log) |

## Not included

A couple of features from the original internal tool were left out of this extraction because
they depended on the host organization's internal infrastructure or were already broken:

- **LINE Bot / LIFF QR scanner** — a webhook integration for scanning codes from inside LINE.
- **Receipt printer integration** — printing QR labels directly to a local Epson ESC/POS printer
  bridge running on the operator's machine.

Both are reasonable things to add back as optional features — PRs welcome.

## License

MIT — see [LICENSE](LICENSE).
