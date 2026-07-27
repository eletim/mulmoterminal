# フォーカスセルの in-place zoom で文字がぼやける

Issue: #965

## 症状

グリッドでセルをフォーカスすると `transform: scale(1.03)` で浮き上がるが、その間ターミナルの
文字がぼやける。フォーカスを外すと戻る。

## 原因

#309 の設計メモ (`plans/feat-grid-active-zoom.md:12`) は「このアプリは xterm を **DOM レンダラ**
（canvas 無し）で描くので、実 DOM テキストを拡大しても crisp のまま」を根拠にしていた。zoom が
入った `535fe68`（2026-07-11 19:34）の時点では正しい。

その 8 時間後、`b12cc48`（2026-07-12 03:47 "render the terminal with the canvas renderer to stop
CJK drift"）で **CanvasAddon** が入り（`src/composables/useTerminalConnections.ts:421`）、
ターミナルの中身は解像度固定のビットマップになった。canvas のバッキングストアは
「CSS サイズ × devicePixelRatio」で決まり、CSS transform では再描画されない。よって
`transform: scale(1.03)` はビットマップを 1.03 倍に引き伸ばすだけで、非整数倍率の再サンプリングが
にじみになる。前提が別コミットで崩れた形で、zoom 側にも canvas 側にも単体の誤りは無い。

## 方針（ユーザー判断）

**zoom は維持する。** セルの枠は今まで通り 1.03 倍に育てる。ただしセルの中身をまとめて
1/1.03 で逆スケールし、**中身に掛かる合成変換を厳密に恒等**にする。canvas は 1:1 で
ラスタライズされたまま、枠だけが育つ。文字サイズは変わらない。

## Chromium で実測して選んだ（scratchpad の puppeteer + sharp）

同じ canvas を同じページ座標に描き、変換なしの基準画像とピクセル比較（DPR 2、内側 6px を除いた
テキスト領域）:

| 変え方 | 基準と異なるチャンネル |
|---|---|
| 今の `scale(1.03)` のみ | **21.85%**（平均差 24.1）|
| 中身を「自分の中心」で 1/1.03 逆スケール | **13.96%** |
| 中身を「セルの中心」で 1/1.03 逆スケール | **0.000%** |
| セルは拡大せず枠レイヤーだけ拡大 | **0.000%** |

逆スケールの**中心がずれると直らない**のが要点。ヘッダの下から始まるラッパーを逆スケールすると
合成変換に 0.4px 程度の並進が残り、それだけで 14% のピクセルが変わる。

## 実装

1. `src/style.css` にトークンを 1 つ: `--focus-zoom: 1.03`。逆数は別トークンにせず
   `calc(1 / var(--focus-zoom))` で書く（2 つ置くと数値がずれ得るが、1 つなら構造的にずれない）。
2. `TerminalGrid.vue` の `.focused` は `scale(var(--focus-zoom))`（数値リテラルをやめる）。
3. `cellChromeClasses.ts` に `CELL_INNER` を追加。`group-[.focused]/cell:scale-[calc(1/var(--focus-zoom))]`。
   セルの子を**全部**（ヘッダも含めて）1 枚のラッパーに入れるのが、中心を一致させる方法。
   `CELL_FRAME` と TerminalCell のルートに `group/cell` を足す。
4. 3 つのセル（TerminalCell / CommandCell / LauncherCell）の中身をこのラッパーで包む。
   scoped CSS で子コンポーネント内部を狙うことはできない（#787、`cellChromeClasses.ts` 冒頭に
   その理由が書いてある）ので、ユーティリティで持たせる。

レイアウトサイズは transform では変わらないので、xterm の refit も PTY のリサイズも起きない
（#309 の性質はそのまま）。

## テスト

- `TerminalGrid.vue` の `.focused` がリテラルの `scale(1.` ではなくトークンを使い、`CELL_INNER` が
  同じトークンの逆数で打ち消している。#331 のように倍率を触るときの防波堤。
- 3 つのセルが `CELL_INNER` ラッパーを 1 枚だけ持ち、ルートが `group/cell` を持つ（mount）。

## 見た目の確認

ピクセル比較は「文字がぼけない」ことしか保証しない。「枠が育って中身が据え置き」が意図通りかは
人が見る必要があるので、PR では `/pr-ui-test` かユーザーの目視を求める。
