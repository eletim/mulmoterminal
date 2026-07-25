# feat: バグ報告スキル `/mulmoterminal-bug-report` (#793)

**ゴールは issue を作ることではなく、ユーザーがその場で解決すること。** issue 化は最後の手段。

## フロー

1. **ヒアリング** — 何が起きたのかを言葉にしてもらう（自動収集はまだしない）
2. **仕様・設定の検証** — 同梱 FAQ を索引に、**現物**（実際の config / schema / バージョン）を読んで
   期待と実際を突き合わせる。設定で解けるならここで終了
3. **既知の確認** — 既存 issue を検索。修正済みでバージョンが古いだけならアップデート案内で終了
4. **issue 化** — ここで初めて詳細収集 → マスク → 全文プレビュー → 同意 → 投稿

## 置き場所とパッケージング

`server/skills/mulmoterminal-bug-report/`（`SKILL.md` + `faq.md`）。

`package.json` の `files` に `server/` が入っているので**同梱設定の変更は不要**
（`npm pack --dry-run` で `server/skills/mulmoterminal-config/{SKILL.md,palettes.json}` が
既にタルボールに入っていることを確認済み）。`installOwnedSkill()` はディレクトリごと
`cpSync(recursive)` するので、`faq.md` もそのままユーザーの `~/.claude/skills/` に届く。

`docs/` は `files` に無い＝ユーザーの手元に無いので、**FAQ の実体を `docs/guide` 側に置くことはできない**。

## インストーラの一般化

`server/infra/install-config-skill.ts` は config スキル 1 個決め打ちだったので、
`install-bundled-skills.ts` にリネームし、同梱スキルを**リスト**で回す形にする
（`installOwnedSkill()` は変更なし）。`extras`（生成した JSON Schema）は config スキルだけに付く。

## FAQ の腐り対策

- **値ではなくポインタを書く**。「既定は cr」ではなく「`terminalSubmit` を見よ / 現物は
  `~/.mulmoterminal/config.json` / 定義は `server/config/app-config.ts`」。
  値は腐るが、キー名は変われば実装が動かないので必ず直る。スキルは実行時に現物を読む。
- **腐ったら CI が赤くなる**。各エントリの `configKey:` / `source:` / `guide:` を
  `parseFaqEntries()`（純関数・単体テストあり）で抜き、spec で突き合わせる:
  - `configKey` が実在するか（`emptyConfig()` のキー ＝ グローバル設定、
    `dirConfigJsonSchema().properties` ＝ ディレクトリ設定）
  - `source` / `guide` のパスがリポジトリに実在するか
  - 参照 issue の open/closed 判定はネットワークが要るので単体テストには入れない（別途）

## FAQ の運用（issue は投稿の場、リポジトリが正）

- Step 2 で「仕様・設定でした」と分かった疑問は **FAQ issue として post**（スキルの回答は下書き）
- メンテナが確認して **close + ラベル**、内容は**人の手で `faq.md` に反映**（issue から生成はしない）
- 同じ疑問の issue があれば新規作成せず +1
- FAQ 件数は「UI が伝えられていない」ランキング。**増えるより減るのが正常**

## テスト

- `test/server/skills/faqEntries.spec.ts` — `parseFaqEntries()` の純粋な単体テスト
  （見出し / フィールド / 複数値 / 空 / 不正行）
- `test/server/skills/bugReportSkill.spec.ts` — 同梱 FAQ の実ファイルを検証
  （configKey 実在・パス実在・全エントリに根拠がある・SKILL.md の frontmatter）
- `test/server/infra/install-bundled-skills.spec.ts` — 既存の `installOwnedSkill` テストに加え、
  **同梱スキルが 2 つとも入る**ことを確認
