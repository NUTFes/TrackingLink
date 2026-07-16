# ブランチ運用ルール

このリポジトリは以下のブランチモデルで運用しています。

- `main` — GitHub上の正式な最新状態。直接コミットしない。
- `develop` — 開発の統合ブランチ。`main` から分岐している。機能追加や作業はここから枝分かれさせる。
- 機能・作業ブランチ — 新しい機能追加や作業を行う際は、必ず `develop` から新しいブランチを作成する
  (例: `git switch develop && git pull && git switch -c feature/xxx`)。
  作業が終わったら `develop` へPRを出してマージする。
- `develop` → `main` へのマージは、リリース時にのみ行う。

Claude Codeがこのリポジトリで新しいブランチを作成する際は、特に指示がない限り `develop` を起点にすること。

# コミットメッセージ

`[feat]`・`[fix]` などの接頭辞 + 日本語で内容を説明する形式にする(詳細は [CONTRIBUTING.md](CONTRIBUTING.md) を参照)。

例:

```
[feat] QRコード読み取り機能を追加
[fix] リダイレクト時のタイムゾーン計算を修正
```

主な接頭辞: `[feat]`(新機能) / `[fix]`(バグ修正) / `[refactor]` / `[docs]` / `[chore]`。
