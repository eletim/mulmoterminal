# fix: 共有 ⤢ / ✕ ボタンに scoped CSS が当たらない (#787)

## 症状

セルヘッダ右上の拡大 ⤢ / 閉じる ✕ が、Claude Code セル（TerminalCell）ではフラットな
アイコンボタンなのに、ランチャー / コマンドセル（LauncherCell / CommandCell）では
**ブラウザ既定の `<button>`**（グレー背景＋枠、縦に間延び）になる。同じヘッダの ◀ ▶ は
正しいので、この 2 つだけが浮く。

## 原因

#646 B3 で ⤢ / ✕ を `CellChromeButtons.vue` に切り出した。このコンポーネントは

- ルートが **2 つの `<button>`（フラグメント）** → Vue は親の scope id を継承させない
  （継承されるのは単一ルートのときだけ）
- **自前の `<style scoped>` が無い** → 自身の scope id も付かない

一方 `.cell-btn` / `.cell-close` の実体は、各セルが `<style scoped src="./cellChromeBase.css">`
で読む scoped CSS（＝ `.cell-btn[data-v-xxxx]`）。よってこの 2 つのボタンには `data-v-*` が
1 つも付かず、ルールが当たらない。

LauncherCell を実際にマウントして確認したヘッダ:

```html
<button data-v-cbeb535d class="cell-btn">◀</button>   <!-- 親 scope id あり → 効く -->
<button class="cell-btn">⤢</button>                    <!-- scope id なし → 効かない -->
<button class="cell-btn cell-close">✕</button>         <!-- scope id なし → 効かない -->
```

TerminalCell の ⤢ / ✕ は自分のテンプレート内に直接あるので影響を受けない＝
「Claude Code のときと、ターミナルのときで閉じるボタンが違う」という見え方になる。

## 対応

`CellChromeButtons.vue` に他 3 セルと同じ 1 行を足し、自身の scope id が付くようにする:

```html
<style scoped src="./cellChromeBase.css"></style>
```

これで `.cell-btn[data-v-<CellChromeButtons>]` が自分のボタンに当たる。共有 CSS の
出どころは 1 箇所のまま（DRY）で、他セルの見た目は変わらない。

### 代替案（不採用）

- 共有チャームをグローバル CSS 化: 3 セルすべての特異度・レイヤ関係が変わり、影響範囲が
  この不具合より広い。
- ルートを 1 要素で包む: 親の scope id は包んだ要素にしか付かず、中のボタンには依然
  当たらないので直らない。

## テスト

`test/src/components/CellChromeButtons.spec.ts`（新規）

- ⤢ / ✕ の両方に `data-v-*` 属性が付く（＝ scoped CSS が当たる）ことを固定する回帰テスト。
  `<style scoped>` を外すと落ちる（外して赤くなることを確認済み）。
- expanded で ⤡ / title が Restore に変わる、クリックで `toggle-expand` / `close` が
  emit される、という既存の振る舞いも併せて固定する。
