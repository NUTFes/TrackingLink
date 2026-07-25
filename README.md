# TrackingLink

QRコード/リンクのアクセスを記録し、リダイレクトするためのセルフホスト型トラッキングツールです。ポスターやチラシに印刷したQRコードがいつ・どこでスキャンされたかを記録し、管理画面で確認できます。

[trackable-links-oss](https://github.com/gakusai-UoA/trackable-links-oss)(MITライセンス)をベースに、NUTFesの文化祭運用向けにリブランド・改修したものです。

## できること

- **プロジェクト**は遷移先(Instagramアカウント、特定のWebページなど)を表し、同じ遷移先URLを持つQRコードをグループ化する
- 各**QRコード**は遷移"元"のソース情報を持つ: **名前**(総称、例:「造形大ポスター」)、**媒体**(例:「Instagram」「ポスター」)、**場所**(貼ってある場所や渡された場所、例:「1F掲示板」)。媒体+場所はプロジェクト内で重複登録できない
- スキャンのたびにアクセスログ(日時・User-Agent・IP)を記録し、301リダイレクトで指定URLへ遷移
- 管理画面でプロジェクトごとのスキャン数、QRコード管理(作成/編集/印刷/削除)、アクセスログのCSVダウンロード(現在は無効化中)を確認可能

```
 QRコードをスキャン ──▶ GET /?id={qrId} (packages/api) ──▶ ログ記録 ──▶ 301リダイレクト
                                │
                                ▼
                      D1データベース (Projects, QRCodes, AccessLogs)
                                ▲
                                │
        管理画面 (packages/web) ──▶ /projects/*, /auth/* (Bearer JWT)
```

## 構成

このリポジトリはpnpmワークスペースで、2つの独立したアプリケーションから成ります。デプロイ先が異なる点に注意してください。

- [`packages/api`](packages/api) — [Hono](https://hono.dev)製のWorker。QRコードのリダイレクト、場所設定、認証付きのプロジェクト/QRコード管理APIを提供。データはCloudflare D1([Drizzle ORM](https://orm.drizzle.team)経由)に保存。
  **→ Cloudflare Workersにデプロイ済み**(下記「本番API」参照)
- [`packages/web`](packages/web) — React + Vite + Tailwindの管理画面(SPA)。`fetch`でAPIと通信する。
  **→ Cloudflareにはデプロイせず、自作サーバーでホストする**方針

## 本番API(デプロイ済み)

| 項目 | 値 |
| --- | --- |
| Worker URL | `https://trackinglink.nutfes-nutmeg9488.workers.dev` |
| Cloudflare Workerプロジェクト名 | `trackinglink` |
| D1データベース名 | `trackinglink-db` |
| デプロイ方法 | Cloudflareダッシュボード連携(Workers Builds)。`main`ブランチにpushすると自動デプロイ |

APIの設定・認証情報は以下の2種類に分かれています。

- **`packages/api/wrangler.jsonc`(リポジトリにコミット)**: Worker名、D1バインディング(`database_id`含む)、`ALLOWED_ORIGINS`、`CSV_EXPORT_ENABLED`など。`database_id`はリソースの識別子であり、それ単体では中身にアクセスできないため許容してコミットしています。
- **Cloudflareダッシュボード側でのみ設定(リポジトリには含まれない)**:
  - `account_id` → Worker の **Settings → Build → Environment variables** に `CLOUDFLARE_ACCOUNT_ID` として設定
  - `JWT_SECRET` / `ADMIN_PASSWORD` → Worker の **Settings → Variables and Secrets** に Secret(暗号化)として設定

## Web(管理画面)のセットアップ

Webは静的サイト(SPA)としてビルドされ、Cloudflareとは別のサーバーで配信します。ローカル開発でも自作サーバーでの本番運用でも、**同じ本番API(`https://trackinglink.nutfes-nutmeg9488.workers.dev`)を参照する**構成にしています。

### 前提

- Node.js 20以上
- [pnpm](https://pnpm.io)(未インストールの場合は `npx pnpm@9.15.0 <コマンド>` のように `npx` 経由でも実行できます)

### 1. リポジトリのclone・依存関係のインストール

```sh
git clone git@github.com:NUTFes/TrackingLink.git
cd TrackingLink
pnpm install
```

ワークスペース全体(`packages/api`と`packages/web`)の依存関係が一括でインストールされます。

### 2. ローカルで開発する場合

```sh
pnpm --filter @tracking-link/web dev
```

`http://localhost:5173` で管理画面が起動し、`packages/web/.env.local` に設定された本番API(`VITE_API_URL`)へ接続します。`ADMIN_PASSWORD`(Cloudflareに設定した値)でログインしてください。

`.env.local`が無い場合は以下のように作成してください。

```sh
echo "VITE_API_URL=https://trackinglink.nutfes-nutmeg9488.workers.dev" > packages/web/.env.local
```

### 3. 自作サーバーへの本番デプロイ

本番ビルド時は `packages/web/.env.production` の値(既にリポジトリにコミット済み、`VITE_API_URL=https://trackinglink.nutfes-nutmeg9488.workers.dev`)が自動的に使われます。

```sh
pnpm --filter @tracking-link/web build
```

`packages/web/dist/` に静的ファイル一式が出力されるので、これを自作サーバー上の任意のWebサーバー(nginx、Apache、Node製の静的サーバーなど)で配信してください。

**注意**: このアプリはReact Routerによるクライアントサイドルーティングを使用したSPAです。存在しないパス(`/links`など)へ直接アクセス・リロードされた場合に `index.html` を返すよう、**SPAフォールバック設定**をWebサーバー側で行ってください(例: nginxなら`try_files $uri /index.html;`)。

### 4. CORSの設定(重要・要対応)

自作サーバーのドメインが決まったら、`packages/api/wrangler.jsonc` の `ALLOWED_ORIGINS` に追加してcommit・pushしてください(pushすると自動で本番APIに反映されます)。

```jsonc
"vars": {
    "ALLOWED_ORIGINS": "http://localhost:5173,http://127.0.0.1:5173,https://<自作サーバーのドメイン>"
}
```

これを設定しないと、自作サーバー上のWebからAPIへのリクエストがブラウザ側でブロックされます(現時点ではドメイン未定のため、localhost分のみ許可されています)。

## 認証

外部の認証プロバイダは使わず、単一の共有パスワード(`ADMIN_PASSWORD`)方式です。`POST /auth/login`でパスワードを渡すと、24時間有効なHS256 JWTが発行され、以降のリクエストで`Authorization: Bearer <token>`として使用します。

認証ロジックは差し替えやすいよう1箇所にまとまっています([`packages/api/src/auth/`](packages/api/src/auth)):

```
auth/
├── types.ts       # Verifier型 + Bindings/AuthUser/HonoEnv —全体が依存する契約
├── local.ts        # 組み込みの単一パスワード認証(signLocalSession/verifyLocalSession)
├── middleware.ts    # createAuthMiddleware(verifier) — VerifierをHonoミドルウェア化
└── index.ts        # 上記の再エクスポート
```

将来Auth0やClerk、独自SSOなどに差し替える場合は、`(token, env) => Promise<{ sub, permissions } | null>` というシグネチャの関数を実装し、`createAuthMiddleware`に渡すだけで済みます。

### 権限(Permissions)

4つの独立したビットの組み合わせです([`packages/api/src/permissions.ts`](packages/api/src/permissions.ts)):

| ビット | 値 | 権限内容 |
| --- | --- | --- |
| `TRACKING_LINK_VIEW` | 1 | プロジェクト・QRコードの一覧参照 |
| `TRACKING_LINK_EDIT` | 2 | プロジェクト・QRコードの作成、自分が作ったQRコードの削除 |
| `TRACKING_LINK_ANALYTICS` | 4 | アクセスログのCSVダウンロード |
| `TRACKING_LINK_DELETE` | 8 | 任意のプロジェクト・QRコードの削除 |

現在の単一管理者ログインは、常にこの4つ全てを付与します。

## APIリファレンス

`/projects/*` 配下はすべて `Authorization: Bearer <token>` が必要です。

| Method | Path | 認証 | 説明 |
| --- | --- | --- | --- |
| GET | `/?id={qrId}` | 不要 | QRコードスキャン。アクセスを記録してリダイレクト |
| POST | `/auth/login` | 不要 | `ADMIN_PASSWORD`をセッショントークンと交換する |
| GET | `/auth/me` | Bearer | 現在のセッション情報を取得 |
| GET | `/projects` | Bearer | プロジェクト一覧(ページネーション、スキャン数付き) |
| POST | `/projects` | Bearer | プロジェクトを作成 |
| GET | `/projects/:id` | Bearer | プロジェクト詳細 |
| PUT | `/projects/:id` | Bearer | プロジェクトを更新 |
| DELETE | `/projects/:id` | Bearer + `DELETE`権限 | プロジェクトを削除(QRコードも連動して削除) |
| GET | `/projects/:id/qrcodes` | Bearer | プロジェクト内のQRコード一覧(ページネーション) |
| POST | `/projects/:id/qrcodes` | Bearer | QRコードを作成(名前・媒体・場所必須) |
| GET | `/projects/:id/access-logs` | Bearer | 生のスキャンログ(ページネーション) |
| GET | `/projects/:id/access-logs/csv` | Bearer + `ANALYTICS`権限 | アクセスログをCSVダウンロード(`CSV_EXPORT_ENABLED=true`の間のみ) |
| GET | `/projects/qrcodes` | Bearer | 全プロジェクト横断のQRコード一覧 |
| GET | `/projects/qrcodes/:id` | Bearer | QRコード単体の情報 |
| PUT | `/projects/qrcodes/:id` | Bearer | QRコードの名前・媒体・場所を更新 |
| DELETE | `/projects/qrcodes/:id` | Bearer + `DELETE`権限/自分が作成したもの | QRコードを削除(スキャンログも削除) |

## 含まれていない機能

元になった内部ツールの一部機能は、組織固有のインフラに依存していたため今回のプロジェクトには含まれていません。

- **LINE Bot / LIFF QRスキャナー** — LINE内からQRコードをスキャンするWebhook連携
- **レシートプリンター連携** — Epson ESC/POSプリンターへ直接QRラベルを印刷する機能

必要になれば追加実装も可能です。

## ライセンス

MIT — [LICENSE](LICENSE)参照。
