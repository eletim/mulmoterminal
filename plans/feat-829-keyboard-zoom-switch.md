# feat(#829): ズーム中のターミナルを Page Up / Page Down で切り替える

#829 の第1弾。キーボードショートカットの土台を、**新しい状態を一切増やさずに**成立する範囲だけ先に入れる。

## なぜこの範囲か

#829 は当初「非ズーム時に『今どのセルが選択中か』という状態が無いので、その新設が実装の本体」と見ていた。
しかし操作を **「ズームで拡大表示しているターミナルを前後に切り替える」** に定義すると、既存の
`zoomedUid` がそのままフォーカス状態として機能するため、新しい状態が要らない。

必要なプリミティブは3つとも既にある:

- `zoomedUid(state)` — 今どれを拡大しているか
- `visibleOrdered(state, statusByUid)` — 画面上の並び順。**ズーム中は全セル**（ページをまたいだ全体）を返す
- `expandNeighbour(order, uid, remaining)` — 「画面上の並びで隣へ拡大表示を移す」処理。`closeCell` が既に使用

よって追加するのは、`expandNeighbour` の兄弟にあたる **±1 方向へ動く純粋関数1つ**と、キーの入口だけ。

キー割り当ては **`~/.mulmoterminal/config.json` の `keymap`** に置き、**既定値は無し（opt-in）**とする。
設定が無ければショートカットは無効。編集用の Settings UI はこの PR に含めない。

## 変更内容

### 1. `src/components/gridTabs.ts` — `moveZoom(state, order, dir)`

`expandNeighbour` の隣に置く。

- ズーム中でなければ何もしない（後述の page 計算の前提になる）
- `order` 内で今のズーム対象を探し、`dir` 方向へ1つ動かす
- **端では止まる**（巻き戻さない）。#829 の決めること: 巻き戻すかは要判断。まず止まる側で入れる
- `order` に居ない／消えた uid は無視（`expandNeighbour` と同じ防御）
- **`page` も移動先のページへ更新する。** ズーム中は `visibleOrdered` が全セルを返すので page は表示に効かないが、
  ズームを解除した瞬間に効く。更新しないと「ページ2のセルを拡大して見ていたのに、閉じたらページ0に戻る」ことになる。
  `insertCellAfter` が同じ理由で page を更新している

page 計算が正しいのは「ズーム中は `order` が並び順の全体＝ページ分割前のリスト」だからで、
非ズーム時の `order` はページの一部でしかない。**ズーム中でなければ何もしない**ガードがこの前提を守っている。

### 2. `common/keymap.ts`（新規）— ユーザ定義キーマップ

`~/.mulmoterminal.json` ではなく **`~/.mulmoterminal/config.json` の `keymap`**。`terminalSubmit`（#772）と
同じ構造：定義とロジックを `common/` に置き、server が sanitize/永続化、client が照合する。

**既定値は無い。** `keymap` が無ければ空マップ＝ショートカット全体が無効。割り当てたキーはその分ターミナルから
奪われるので、そのトレードオフはユーザが決める（#829 で合意した方針）。

- `parseKeyBinding("Shift+PageUp")` — 修飾キーは `Shift`/`Ctrl`(`Control`)/`Alt`(`Option`)/`Cmd`(`Command`,`Meta`)。
  不正な記法は `null` を返し、そのエントリだけ捨てる（設定全体を壊さない）
- `matchesBinding` — **修飾キーは完全一致**。`PageDown` の割り当ては `Shift+PageDown` では発火しない。
  これが xterm のスクロールバック（`Shift+PageUp`）を残す仕組み
- `sanitizeKeymap` — 未知のアクション名・非文字列・パース不能な値を捨てる

### 3. `src/composables/gridShortcut.ts`（新規）— キー判定の純粋関数

`common/terminalSubmit.ts` の `enterKeyOverride` と同じ形（DOM 非依存の構造型を受ける純粋関数）。

- `gridShortcutFor(keymap, e, zoomed)` → `"zoom-next" | "zoom-prev" | null`
- keydown のみ。IME 変換中（`isComposing`）は素通し
- ズーム中のみ有効
- キーとアクションの対応は `common/keymap.ts` の `actionForKey` に委譲（ハードコードしない）
- `isEditableTarget(tagName, classList)` → フォーム部品なら素通し。ただし
  **xterm の入力面は `<textarea class="xterm-helper-textarea">`** なので、素朴に「textarea を除外」すると
  ショートカットが最も効くべき場所で効かなくなる。ここが唯一の罠

### 4. `src/components/GridView.vue` — キーの入口

`window` の **capture フェーズ**で `keydown` を拾う（`useCaptureKeydown`）。xterm はテキストエリアに
ハンドラを付けるので、capture なら先に取れる。設定モーダルが開いている間は無効。

**GridView は `<KeepAlive>` の下にあり、離脱時は unmount ではなく deactivate される**（App.vue）。
`onBeforeUnmount` だけで外すと、グリッドを離れた後も capture リスナーが生き続け、他のビューでキーを
飲み込んでしまう（Codex レビュー指摘）。`onActivated`/`onDeactivated` で着脱し、`onBeforeUnmount` は
最終後始末として残す — 同ファイル内の poll / new-terminal ハンドラと同じ形。

`onClose` が既に `displayCells.value.map((c) => c.uid)` を並び順として渡しているので、同じものを使う。

## テスト

`gridTabs.spec.ts` に `moveZoom` を追記、`keymap` / `gridShortcut` / `useCaptureKeydown` は新規。

- `moveZoom` — 前後移動、端で止まる、ズームしていなければ不変、移動先ページへの page 追従、
  `order` に無い uid、空の `order`、消えたセルを指す `order`、`order` の index を使う（`state.cells` の位置ではない）
- `keymap` — 記法のパース（修飾キー別名・空白・大文字小文字）、不正記法の破棄、修飾キー完全一致、
  空マップ、未知アクションの除去、プロトタイプチェーン読み抜けの防止
- `gridShortcut` — **空キーマップでは無反応（opt-in の要）**、修飾キー付き binding、keydown 以外 /
  `isComposing` / 非ズーム時は null、`xterm-helper-textarea` は編集対象として扱わない
- `useCaptureKeydown` — **`<KeepAlive>` で deactivate 中はリスナーを外す（Codex 指摘の回帰）**、
  再 activate で1回だけ張り直す、unmount 後は外れる、KeepAlive 外でも動く

## 含めないもの

- キーマップを編集する **Settings UI**（今回は `config.json` の手編集のみ）
- 非ズーム時の選択状態と、それを前提とするアクション群
- ターミナルの追加／クローズ／並べ替え等のショートカット

## 決めきっていない点（#829 に記載）

- 端で巻き戻すか止まるか（本 PR は止まる）
- ズーム切り替えがページをまたぐ挙動で良いか（本 PR はまたぐ）
