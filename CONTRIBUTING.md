# Contributing

Thanks for considering a contribution.

## Getting set up

Follow the "Web(管理画面)のセットアップ" section in [README.md](README.md) (in Japanese) — it
covers installing dependencies and running `packages/web` locally against the deployed API.

## Before opening a PR

```sh
pnpm lint        # biome check .
pnpm typecheck   # tsc --noEmit in both packages
pnpm test        # vitest unit tests for packages/web
pnpm build       # vite build for packages/web
```

There's a small unit test suite (`pnpm test`) covering the pure logic that is
hardest to eyeball — the API error → message mapping, locale-aware date
formatting, filename slugging and the `localStorage` fallback. Page components
are deliberately not covered yet (see "Not included" below for other gaps) — please describe
how you manually verified your change in the PR description.

## Scope

This project intentionally stays small: a redirect/logging Worker, an admin dashboard, and a
pluggable auth seam. Please open an issue to discuss anything that adds new infrastructure
dependencies (new Cloudflare bindings, new external services) before sending a PR — smaller,
focused PRs are much easier to review.

Known gaps that are welcome as contributions:

- Component-level tests for the page components (`@testing-library/react` on top of the
  existing `vitest` setup). The pages are large and fetch-heavy, so this needs a bit of
  structure first.
- The LINE Bot/LIFF QR scanner and receipt-printer (ePOS) integrations mentioned in the README's
  "Not included" section.
- Additional `Verifier` implementations under `packages/api/src/auth/` (see the "認証" section in
  [README.md](README.md)) for real identity providers.

## Commit style

Commit messages use a prefix followed by a description in Japanese explaining what changed, e.g.:

```
[feat] QRコード読み取り機能を追加
[fix] リダイレクト時のタイムゾーン計算を修正
```

Common prefixes: `[feat]` (new feature), `[fix]` (bug fix), `[refactor]`, `[docs]`, `[chore]`.
Keep PRs focused — one logical change per PR.

## Reporting bugs / requesting features

Open a GitHub issue. For security issues, see [SECURITY.md](SECURITY.md) instead of a public issue.
