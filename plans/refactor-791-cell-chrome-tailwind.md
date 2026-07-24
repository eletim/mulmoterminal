# refactor: セルの共有チャームを Tailwind ユーティリティへ (#791)

`cellChromeBase.css` / `cellChrome.css`（＋ CommandCell の独自 scoped ブロック）を削除し、
グリッドセル 4 コンポーネントの見た目をユーティリティに寄せる。`docs/styling.md` の
Tailwind-first 方針の続き。

## なぜ

#787 で、共有 scoped CSS は**フラグメント・ルートのコンポーネントに黙って当たらない**ことが分かった
（Vue は親の scope id を単一ルートにしか渡さない）。ユーティリティならこの失敗モードが存在しない。

## 設計

### 1. クラス名は残す、CSS だけ消す

`.cell` / `.cell-header` / `.cell-btn` / `.cell-dot` などは**状態マーカーと DOM クエリのフック**として
そのまま残す（`is-working` / `is-zoomable` も同様）。既存 spec が多数これで要素を引いており、
スタイルを持たなくなった時点で `docs/styling.md` ルール 5（「スタイリング用クラスで引くな」）の
懸念——見た目を変えるとテストが壊れる——は消える。

### 2. `src/components/cellChromeClasses.ts`

繰り返すユーティリティ列を文字列定数に。**同じプロパティを 2 つのユーティリティが取り合わない**
ように、box / size / ink（色＋hover）に分割してある:

- Tailwind は出力順で勝敗が決まるため、`CELL_BTN` に `hover:bg-hover` を含めたまま
  close ボタンに `hover:bg-[var(--err-hover-bg)]` を足す形にはできない。状態ごとに
  **1 本の完成した文字列**を選ぶ（`CELL_BTN` / `CELL_CLOSE_BTN`、CommandCell の
  `SUMMARIZE_READY` / `SUMMARIZE_BUSY`）。
- ドットも同じ理由で、shape（`CELL_DOT`）と色（`CELL_DOT_IDLE` / `CELL_DOT_WORKING` /
  status）を分け、色は必ず 1 つだけ付く。
- variant は逆に安全（`hover:` は素のユーティリティより後に出力される）ので
  `bg-x hover:bg-y` は成立する。

### 3. `@keyframes` は Tailwind theme へ

ドットのパルスだけはユーティリティで書けないので `src/tailwind.css` の `@theme` に
`--animate-cell-pulse` として置き、`animate-cell-pulse` という普通のユーティリティにした。
Tailwind 標準の `animate-pulse` とは速度も濃さも違うので流用はしない。

## 検証

見た目が変わっていないことを、**削除前の CSS と新しいユーティリティを同じページに並べて
`getComputedStyle` を全プロパティ比較**して確認した（puppeteer、midnight テーマ）。
frame / header（hover 含む）/ actions / dir / cmd / term は**完全一致**。差分が出たのは 3 種のみ:

| 箇所 | 差分 | 判断 |
| --- | --- | --- |
| ボタン各種 | `border-*-color` と `--tw-border-style` | `border: none` → `border-none` の内部差。border-style は両方 none で描画されない |
| ドット | `border-radius: 50%` → `rounded-full`（33554432px） | 9×9 の正方形なのでどちらも真円 |
| ドット（working） | `animation-name: pulse` → `cell-pulse` | 意図したリネーム。duration / timing / iteration は一致 |

加えて `eslint.config.js` の scoped-CSS allowlist からセル系 4 件を削除、`docs/styling.md` の
allowlist 説明を更新し、今回学んだ 2 つの落とし穴（フラグメント・ルートに scope id が付かない／
同一プロパティのユーティリティ 2 枚は出力順で決まる）を Gotchas に追記した。
