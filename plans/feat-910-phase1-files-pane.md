# feat #910 Phase 1 — 拡大中のセルの隣に file explorer / viewer を出す

ズーム中（セルを拡大している状態）に、広がったターミナル領域を左右に分割して右に
explorer / viewer を出す。今は専用の全画面ビューが開くだけで、ターミナルと同時に見られない。

## 中身は作らない — 全画面 Files view を共通化する

ツリー＋CodeMirror＋md プレビュー＋未保存ガード＋409 バナーは、全画面 Files view として
すでに全部動いている。**`FilesPane.vue` に抽出し、全画面版（`FilesOverlay.vue`）はその薄い
ラッパにする。** サーバ API は追加ゼロ（Phase 0 の `version` / `baseVersion` をそのまま使う）。

### 分割線をどこに引いたか

| 置き場所 | 何を持つか |
|---|---|
| `FilesPane.vue` | ツリー、エディタ、保存、409 バナー、自分の未保存ガード |
| `FilesOverlay.vue` | ルート結合（`useFilesView`）、`fixed` の枠、ルート離脱時のガード |
| `TerminalGrid.vue` | ペインの開閉・幅、スプリッタ、どのセルの dir を見せるか |

**ペインは `cwd` の変化に自分では反応しない。** 反応させると、ホストがまだユーザーに確認して
いる最中のバッファを捨ててしまう。ホストが「ルート変更はガードを通った」と判断してから
`reload()` を呼ぶ。全画面版のルートガード（`reverting` / `bypassGuard`）はこの前提で今の
挙動をそのまま保っている（既存 12 テストが green のままなのが確認）。

未保存かどうかはホストも知る必要があるので `dirty` を emit する。

## レイアウト — 行ラッパ 1 つで両モードに効かせる

ズームには 2 つの形があり、**`listMode` の既定は `true`（ロースター）**。strip だけ対応すると
既定のユーザーには何も出ないので、最初から両方に出す。

- list モード: stage が **row** → `roster | terminal`
- strip モード: stage が **column** → `terminal / filmstrip`

`zoom-main` を stage の直下に並べたままペインを足すと、strip モードでは**ターミナルの下**に
入ってしまう。`zoom-main` とペインを **row のラッパで包む**と、stage がどちら向きでも
「ターミナルの右」になる。ラッパは Tailwind のみ（`zoomed ? 'flex …' : 'hidden'`）で、既存の
`.zoom-main` の CSS には触っていない。

## 幅の規則は単一ビューのスプリッタを流用

`splitterWidth.ts` に `clampPaneWidth(paneWidth, available)` を 1 行足す。中身は
`available - clampTerminalWidth(available - paneWidth, available)` — **同じ規則を反対側から
読んだだけ**にすることで、2 つのスプリッタが別々に育つのを防ぐ。狭いときにターミナルの下限が
勝ち、ペインが自分の下限を諦めるのもそのまま継承される（3 カラムになる list モードで効く）。

キーボード操作も `splitterKeyWidth` をそのまま使う（ターミナル幅で話す API なので、ペイン幅は
その残り）。

## 入口

セルヘッダの `CellChromeButtons` にトグルを 1 つ。**拡大中のセルにだけ出す**（タイルや
フィルムストリップのサムネイルには分割する余地がない）。expand/restore の**後ろ**に置いた —
複数のテストと grid が最初の `.cell-btn` を掴んでいるため。

`toggle-files` は `gridCell.ts` の `GridCellEmits` に足したので、3 種類のセル全部が同じ形で
持つ。開閉状態と幅は `TerminalGrid` が持ち、localStorage に覚える（**セルごとの記憶は
Phase 2**）。

## その他

- `⌘S` はペインの**自分のサブツリー**に束ねた。window だと、隣のターミナルに打ち込んでいる
  最中の `⌘S` で保存が走る
- `.cm-editor` の高さ指定を `<style scoped>` から `src/style.css` の `@layer base` へ移した。
  CodeMirror が実行時に注入する要素なのでユーティリティでは届かず、かつ全画面版とペインの
  両方から使うため（CLAUDE.md の「utility にできないものはグローバル 1 箇所へ」）

## テスト

- `FilesPane.spec.ts`（新規 5 件）— cwd プロップだけで動く / `dirty` を上げる / `⌘S` は
  ペイン内だけ効き window では効かない / 未保存の close を確認する / **`cwd` 変更では
  読み直さず `reload()` でだけ読み直す**
- `TerminalGrid.spec.ts`（新規 5 件）— 拡大するまで出ない / **list と strip の両モードで
  ターミナルと同じ行に入る** / 拡大中のセルの dir を見る（無ければ既定にフォールバック）/
  ズームを移してもペインは 1 つのまま張り替わる / 開閉が localStorage に残る
- `CellChromeButtons.spec.ts`（新規 4 件）— 拡大中だけ出る / `aria-pressed` / emit するだけ /
  expand の後ろにいる
- `splitterWidth.spec.ts`（新規 4 件）— `clampPaneWidth` の下限とタイブレーク
- `FilesOverlay.spec.ts` は**無改造で 12 件 green** — 抽出のリグレッションゲート

## やらないこと（#910 の後続）

- 自動保存＋3 世代バックアップ＋セルごとの記憶 — Phase 2
- 外部変更の検知（hook ＋ 30 秒ポーリング）— Phase 3
