# Contributing

Thanks for considering a contribution.

## Getting set up

Follow the "Web(管理画面)のセットアップ" section in [README.md](README.md) (in Japanese) — it
covers installing dependencies and running `packages/web` locally against the deployed API.

## Before opening a PR

```sh
pnpm lint        # biome check .
pnpm typecheck   # tsc --noEmit in both packages
pnpm build       # vite build for packages/web
```

There's no automated test suite yet (see "Not included" below for other gaps) — please describe
how you manually verified your change in the PR description.

## Scope

This project intentionally stays small: a redirect/logging Worker, an admin dashboard, and a
pluggable auth seam. Please open an issue to discuss anything that adds new infrastructure
dependencies (new Cloudflare bindings, new external services) before sending a PR — smaller,
focused PRs are much easier to review.

Known gaps that are welcome as contributions:

- A real test suite (`vitest` is already used elsewhere in the ecosystem and would fit naturally).
- The LINE Bot/LIFF QR scanner and receipt-printer (ePOS) integrations mentioned in the README's
  "Not included" section.
- Additional `Verifier` implementations under `packages/api/src/auth/` (see the "認証" section in
  [README.md](README.md)) for real identity providers.

## Commit style

Plain, descriptive commit messages explaining *why* a change was made are preferred over
conventional-commits-style prefixes. Keep PRs focused — one logical change per PR.

## Reporting bugs / requesting features

Open a GitHub issue. For security issues, see [SECURITY.md](SECURITY.md) instead of a public issue.
