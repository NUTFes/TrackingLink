# 負荷テスト

計画・シナリオの根拠・リリース前チェックリストは [`docs/load-testing.md`](../../../docs/load-testing.md) にある。
ここは実行手順だけ。

---

## ⚠️ 結果を読み違えないための4点

**先にこれを読むこと。** ここを飛ばすと、測っていないものを測ったと報告することになる。

1. **1台のPCからは自分の上り帯域を測っているだけ。** Cloudflare は1台では飽和させられない
   エッジで受け止める。**「500 rps 捌けた」を成果として引用してはいけない。**
2. **見るべきは集計値ではなくリクエスト単位の指標** — Worker の **CPU時間**(Free は 10ms 上限)と
   **D1 の rows read / rows written per request**。CPUと読み取り行数が半分になれば本物の改善、
   ノートPCの RPS が上がっただけなら NIC が温まっただけ。
3. **エラー率を信じる前に Cloudflare の Security → Events を見る。** 単一IPから
   `*.workers.dev` を叩くと Cloudflare 自身の濫用対策で 429/1015 が返り、**アプリの障害に見える。**
4. **`*.workers.dev` では Cache API と `Cache-Control` が効かない。** キャッシュのベンチマークを
   workers.dev に向けても何も測れない。

もう1つ、書き込み側の性質: **`AccessLogs` は単一テーブルで D1 は DB あたり単一ライター**なので、
**アクセスを複数プロジェクトに分散させても書き込み競合は緩和しない。** 期待してはいけない。

---

## 準備

k6 を入れる(単一 Go バイナリ):

```
winget install k6          # または: scoop install k6 / choco install k6
```

シードを作って流す。**`wrangler dev` は止めてから**(起動中に書き込むと workerd が
`kj/table.c++:57: HashIndex detected hash table inconsistency` で落ちる — 実測):

```
cd packages/api
node loadtest/seed/generate.mjs --logs=100000
node loadtest/seed/run.mjs --target=local
```

25プロジェクト × 10 QRコード + 指定件数のアクセスログが入る。プロジェクト数が
`PAGE_SIZE`(10)を超えているのは意図的で、**そうでないとページングのバグも集計を
絞る修正の効果も観測できない。**

データには意図的な偏りを付けている(1プロジェクトに約60%、その中の1 QRに約30%、
3日間の日内変動 + 10分の急峻なスパイク1回)。一様乱数はインデックスの選択性を
過大評価させ、p95 が実際より良く見えるため。

サーバーを起動:

```
npx wrangler dev --local --port 8789
# CSVを試すとき: --var CSV_EXPORT_ENABLED:true
```

---

## 実行

| コマンド | シナリオ | 実行先 |
|---|---|---|
| `pnpm loadtest:smoke` | S6 挙動スモーク(**CIゲート**) | ローカル |
| `pnpm loadtest:scan` | S1 50rps × 5分 | **ローカルのみ** |
| `pnpm loadtest:spike` | S2 5→500rps ランプ | **ローカルのみ** |
| `pnpm loadtest:admin` | S3 管理ダッシュボード | ローカル → 本番 |
| `pnpm loadtest:csv` | S4 CSV出力 | ローカル → 本番 |
| `pnpm loadtest:login` | S5 ログイン総当たり | ローカル → 本番 |
| `pnpm loadtest:prod:ramp` | P1 本番ランプ(約9,000件) | **本番** |

**S1 と S3 は修正前のベースラインも取る。** 悪い数字がそのまま before/after の証拠になる。

**S2 がこの一式で最も価値が高い。** D1 は SQLite で単一ライターなので、500並列 INSERT が
優雅に直列化するのか `SQLITE_BUSY` を吐き始めるのかを答える唯一のシナリオ。
書き込み3万件は Free の日次クォータの30%なので**必ずローカルで**。

---

## 本番に向けるとき

```
BASE_URL=https://trackinglink.<subdomain>.workers.dev \
ADMIN_PASSWORD=<本番のパスワード> \
k6 run loadtest/k6/scan-ramping-prod.js
```

実行前:

1. D1 の当日 rows written が0に近いことを確認(リセットは 00:00 UTC = **09:00 JST**)。
2. `wrangler d1 export trackinglink-db --remote --output=backup-YYYYMMDD.sql`
3. `.out/qrids.json` の ID を**本番に実在する ID** に差し替える(ローカルのシードIDは本番にない)。

実行中に見るもの: Workers Metrics の 5xx と CPU時間 p99 / Workers Logs の
`access_log_insert_failed`・1101・1102・1015 / Security → Events。

**後片付け**: D1 は **DELETE した行も rows written に計上する**ので、9,000行消すと更に
9,000書き込み。リリース前にどうせ本番を空にするなら、**DBを作り直すのが書き込みゼロで済む**
(`wrangler d1 delete` → `d1 create` → `schema.sql` と移行を流し直す。`database_id` の
更新を忘れないこと)。行単位で消すならテストと別日にする。

---

## 生成物

`loadtest/.out/` は gitignore 済み。`qrids.json` には k6 が同じ偏りを再現するための
重み付き ID 配列が入っている(単一 IDを叩き続けると Worker 内メモリキャッシュの
ヒット率が非現実的に良くなるため)。
