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

設定 UI（ユーザ定義キーマップ）はこの PR に含めない。キー判定を純粋関数に切り出しておくので、
後からマッピングを差し替えられる。

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

### 2. `src/composables/gridShortcut.ts`（新規）— キー判定の純粋関数

`common/terminalSubmit.ts` の `enterKeyOverride` と同じ形（DOM 非依存の構造型を受ける純粋関数）。

- `gridShortcutFor(e, zoomed)` → `"zoom-next" | "zoom-prev" | null`
- keydown のみ。IME 変換中（`isComposing`）は素通し
- ズーム中のみ有効
- **修飾キーが1つでも押されていたら素通し。** `Shift+Page Up` は xterm 自身のスクロールバック操作なので、
  奪うとズーム中に履歴を遡れなくなる
- `isEditableTarget(tagName, classList)` → フォーム部品なら素通し。ただし
  **xterm の入力面は `<textarea class="xterm-helper-textarea">`** なので、素朴に「textarea を除外」すると
  ショートカットが最も効くべき場所で効かなくなる。ここが唯一の罠

### 3. `src/components/GridView.vue` — キーの入口

`window` の **capture フェーズ**で `keydown` を拾う。xterm はテキストエリアにハンドラを付けるので、
capture なら先に取れる。設定モーダルが開いている間は無効。

`onClose` が既に `displayCells.value.map((c) => c.uid)` を並び順として渡しているので、同じものを使う。

## テスト

`test/src/components/gridTabs.spec.ts` に `moveZoom`、`test/src/composables/gridShortcut.spec.ts` を新規。

- 前後移動、端で止まる、ズームしていなければ不変
- 移動先ページへの page 追従（ページをまたぐ移動）
- `order` に無い uid、空の `order`、消えたセルを指す `order`
- 修飾キー付き（`Shift+Page Up` を含む）は null
- keydown 以外 / `isComposing` は null
- 非ズーム時は null
- `xterm-helper-textarea` は編集対象として扱わない（回帰）

## 含めないもの

- ユーザ定義キーマップの永続化と設定 UI（`common/keymap.ts` + `AppConfig` + Settings）
- 非ズーム時の選択状態と、それを前提とするアクション群
- ターミナルの追加／クローズ／並べ替え等のショートカット

## 決めきっていない点（#829 に記載）

- 素の Page Up / Page Down か修飾キー付きか。素だと `less` / `vim` / Claude Code TUI のページ送りを奪う
- 端で巻き戻すか止まるか（本 PR は止まる）
- ズーム切り替えがページをまたぐ挙動で良いか（本 PR はまたぐ）
