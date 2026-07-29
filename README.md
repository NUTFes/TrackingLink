# TrackingLink

QRコード/リンクのアクセスを記録し、リダイレクトするためのセルフホスト型トラッキングツールです。ポスターやチラシに印刷したQRコードがいつ・どこでスキャンされたかを記録し、管理画面で確認できます。

[trackable-links-oss](https://github.com/gakusai-UoA/trackable-links-oss)(MITライセンス)をベースに、NUTFesの文化祭運用向けにリブランド・改修したものです。

## できること

- **プロジェクト**は遷移先(Instagramアカウント、特定のWebページなど)を表し、同じ遷移先URLを持つQRコードをグループ化する
- 各**QRコード**は遷移"元"のソース情報を持つ: **名前**(貼る物の名前、例:「造形大ポスター」)、**媒体**(例:「Instagram」「ポスター」)、**場所**(貼ってある場所や渡された場所、例:「1F掲示板」。任意)。**物ごとに1つのQRコードを発行する**運用なので、名前はプロジェクト内で重複登録できない
- スキャンのたびにアクセスログ(日時・User-Agent・IP)を記録し、302リダイレクトで指定URLへ遷移。SNSのリンクプレビュー用クローラーからのアクセスは `is_bot` フラグを立てて記録する(捨てないので、判定を後から改良して過去分を再集計できる)
- **D1に接続できないときは、QRコードに埋め込まれたキーワードから転送先を決めて遷移する**([設定](#5-d1に接続できないときのフォールバック))
- 管理画面でプロジェクトごとのスキャン数、QRコード管理(作成/編集/削除)、アクセスログのCSVダウンロード(現在は無効化中)を確認可能

```
 QRコードをスキャン ──▶ GET /?id={qrId} (packages/api) ──▶ ログ記録 ──▶ 302リダイレクト
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

### 5. D1に接続できないときのフォールバック

スキャンのたびにD1から転送先を読むため、**D1に接続できないと全来場者に500が返り、貼り出したポスターが一斉に無反応になります**。最も起こりやすいのはD1の障害そのものより**クォータ枯渇**で、Freeプランの上限(読み取り500万行/日)を超えると Worker は生きたままD1呼び出しだけが失敗します。

これを避けるため、QRコードには転送先の**キーワード**が `&p=<キーワード>` として埋め込まれ、Workerは設定だけを見て転送先を決められるようになっています。

```jsonc
"vars": {
    // D1に繋がらないときの最終手段。未設定だと503を返します。
    "FALLBACK_URL": "https://www.nutfes.net/",
    // キーワード -> 転送先。D1が読めないときだけ使われます。
    "FALLBACK_DESTINATIONS": {
        "instagram": "https://www.instagram.com/nutfes_official/",
        "web": "https://www.nutfes.net/event/"
    }
}
```

キーワードはプロジェクトごとに管理画面で設定しますが、**選べるのはここに書いたキーワードだけです**(APIも設定にないキーワードを400で拒否します)。ここに未登録のキーワードは、D1が落ちた当日まで何も起きていないように見えてしまうためです。順序としては**先にここへ追記し、そのあとで管理画面から選んでください。** なおキーワードを設定しないプロジェクトは `FALLBACK_URL` に落ちるだけで壊れはせず、平常運転中に `scan_fallback_not_configured` がWorkers Logsに出るので、障害が起きる前に気づけます。

キーワードは短い半角英数字にしてください。印刷するQRコードに入るため、日本語のキーワードは1文字9文字分にパーセントエンコードされ、シンボルが 57×57 から 61×61 モジュールに大きくなります(この判断はここを書く人の責任です。APIは文字種を見ません)。

転送先URLそのものではなくキーワードを埋めているのは、QRから復元できるURLはQRに入っていなければならず、シンボルが 53×53 から 69×69 まで大きくなるためです(ハッシュは一方向で復元できず、暗号化は平文より長くなるので、暗号技術では回避できません)。キーワードなら +4モジュールで済み、副次的に`&p=`が設定済みの一覧からしか選べないため**オープンリダイレクトが構造的に不可能**になります。

**注意点が2つあります。**

- **D1障害中はリダイレクトは動きますが、スキャンは計上されません。** `AccessLogs.project_id` はNOT NULLで `qr_id` はQRCodesへの外部キーがあり、DBが読めない状況では有効な行を作れないためです。件数は `scan_unlogged_due_to_db_failure` で分かります。
- **キーワードを後から変更しても、既に印刷したQRコードには反映されません。** 古いキーワードの設定は残しておいてください。

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
