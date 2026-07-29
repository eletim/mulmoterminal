# feat(#996): 自分の配色を Settings のテーマ選択に足せるようにする

組み込みは `midnight` / `nord` / `daylight` / `solarized` の 4 つで、これ以外の配色をアプリ全体に
適用する手段が無い。`~/.mulmoterminal/config.json` に自分の配色を定義して、Settings のテーマ選択に
並べられるようにする。

方針は issue #996 で 1 つずつ詰めた（[コメント](https://github.com/receptron/mulmoterminal/issues/996#issuecomment-5100193275)）。

## 決めたこと

| # | 論点 | 決定 |
| --- | --- | --- |
| 1 | 定義の書き方 | `config.json` の `themes`。`extends` は**任意**、省略時は CSS 変数 20 個すべて必須 |
| 2 | 明暗の判定 | `--bg-base` の輝度から**自動判定** |
| 3 | xterm パレット | **CSS 変数から導出**。16 ANSI 色は `extends` 先から継承 |
| 4 | 組み込みと同じ id | **拒否**して「落としたキー」として見せる |
| 5 | テーマ消失時 | 既定に戻して告知。選択は localStorage に保持 → 定義が戻れば自動復帰 |
| 6 | `.mulmoterminal.json` の `theme` | カスタム id も指定可。**適用範囲は現状のまま**（その端末のキャンバスのみ） |
| 7 | UI 編集 | 後追い。まずファイルだけで完結させる |

`themes` を **localStorage ではなくサーバ側の config.json** に置くのは、自分で作った配色が
複数ブラウザ・スマホでも使いたい資産だから。**どれを選んでいるか**は今までどおり localStorage
（「この端末では暗い方」が成り立つ）。

> issue の「フォントサイズ・ファミリーと同じく localStorage」は事実と違う。サイズは localStorage、
> ファミリーは config.json（`config-schema.ts` / `terminalFontFamily.ts`）で、方針が割れている。

## 実装

### common/ — 両側が同じ定義から判断する

`common/themeVars.ts`（新規）

- `THEME_VAR_KEYS` — CSS 変数 20 個の名前（`style.css:15-36` と対応）
- `resolveThemeColors(theme, builtins)` — `extends` + 差分 → 20 個そろった形へ
- `isLightBackground(color)` — `--bg-base` の相対輝度で light/dark を判定
- `termThemeFromVars(vars)` — `background ← --bg-base` / `foreground ← --term-fg` /
  `selectionBackground ← --term-selection`

`THEME_COLOR_KEYS`（`common/themeColors.ts`）と同じ理由で common/ に置く。サーバは検証、
クライアントは適用に使うので、片方だけ変わるとズレる。

### サーバ

- `config-schema.ts` に `themes` を追加。id の形式・組み込みとの衝突・色の値を検証する。
  値は既存の `HEX_COLOR_RE` / `PALETTE_COLOR_RE` を再利用する — **CSS 変数へ注入するので、
  ここを緩めると CSS インジェクションになる**
- `themeIdSchema` の `z.enum(THEME_IDS)` を外し、id 形式の検証済み文字列にする。
  `dirThemeField` も追随（決定 6）
- `/api/config` の応答に `themes` を載せる

### クライアント

- `useTheme.ts` — 組み込み + カスタムを 1 つのリストに。カスタムが選ばれたら CSS 変数を
  `:root` に注入する（組み込みは今までどおり `data-theme` 属性で `style.css` が当たる）
- **`style.css` の明るいテーマ用ブロックを `:root[data-appearance="light"]` に変える。**
  今は `:root[data-theme="daylight"], :root[data-theme="solarized"]` と id を列挙しており、
  カスタムの明るいテーマがここに入らない＝ステータスピルが読めなくなる。組み込みも含めて
  `data-appearance` を必ず立てる
- 選択中の id が見つからないときは既定の見た目に戻し、Settings に理由を出す
  （`useTheme.ts:91` のコメントが警告している無言フォールバックを塞ぐ）

### テスト

- `resolveThemeColors` — extends あり / なし、未知キー、部分上書き
- `isLightBackground` — 組み込み 4 つが期待どおりに分類されること（daylight/solarized が light）
- `termThemeFromVars` — 導出結果、ANSI 継承
- config schema — 受理 / 組み込み id の拒否 / 不正な色の拒否 / 未知キーの除去
- `useTheme` — カスタム適用で変数が入ること、消失時に既定へ戻り選択は保持されること

### ドキュメント

- `config.md`（日英）に節を追加。Settings の表の Theme 行も更新
- 用語集の「テーマ」に触れる必要があれば追記
