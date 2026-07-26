# fix #845 — TUI のクリック可能要素にクリックを届ける

Claude の "Jump to bottom" / "1 new message" が押しても反応しない。#729 でマウストラッキングの
SET を丸ごと破棄しているため、クリック報告が PTY に届かないのが原因（#845 で調査済み）。

## 方針: 案 A（クリックだけ合成する）

#737 がホイールに対してやったことを、クリックにも広げる。ドラッグは従来どおりテキスト選択のまま。

案 B（破棄をやめてトラッキングを honour する）を採らない理由は xterm 6 のソースで確認済み:
`CoreBrowserTerminal` の mousedown は `areMouseEventsActive && !shouldForceSelection(ev)` で報告に
入るため、**トラッキングが有効な間はモードに関係なく素のドラッグ選択が死ぬ**（`shouldForceSelection`
は mac: Option、他: Shift）。「1000 だけ honour する」折衷も同じ理由で不可。案 B は #729 の差し戻し。

## 変更

### 1. `src/composables/wheelReports.ts` → `src/composables/mouseReports.ts`

ホイール専用ではなくなるのでリネーム（import 元は本体と spec の 2 箇所だけ）。SGR フレームの
組み立てを共通化し、以下を持たせる:

- `recordSwallowedModes` / `clearResetModes` — 変更なし
- `wantsWheelReports` → **`wantsMouseReports`** にリネーム（クリックも同じ条件で判定するため）
- `wheelReportSequence(deltaY, col, row)` — 変更なし
- `clickReportSequences(col, row)` — press `CSI < 0 ; C ; R M` と release `… m` の対を返す。
  TUI がどちらで反応するか不定なので両方送る
- `cellFromPoint(rect, cols, rows, clientX, clientY)` — ピクセル → **1 始まり**のセル座標。
  グリッド外は端にクランプ。xterm 6 の public API に pixel→cell 変換が無いため自前
  （内部の `_core._renderService.dimensions` は `any` 経由になり CLAUDE.md 違反）
- `isClickGesture(from, to)` — 押下から解放までの移動が閾値内なら「クリック」。超えたらドラッグ＝選択

### 2. `src/composables/useTerminalConnections.ts`

- `guardMouseTracking` のホイールハンドラを**実座標**にする（現状は `1, 1` 固定）。
  当たり判定を持つ TUI が増えている以上、ホイールも正しい座標で報告すべき
- `term.open(host)` の**後**に `guardMouseClicks(term, swallowedMouseModes)` を追加。
  `term.element` は open 前は undefined なので、既存の `guardMouseTracking`（parser フック）とは
  呼び出し位置を分ける。リスナは `.xterm-screen` に張る（グリッド外のクリックを拾わないため）

合成する条件（すべて満たすとき）:

1. alternate buffer である — ホイール側と同じゲート。対象（Claude / Codex）は alt 画面。
   通常バッファのアプリまで広げるのは既知の利用者がおらず、必要になったら外せる
2. `wantsMouseReports(swallowedMouseModes)` — アプリが tracking + SGR(1006) を要求済み
3. `.xterm-screen` に `xterm-cursor-pointer` が付いていない — **リンク hover 中はスキップ**。
   OSC 8 / file-path / web-links のクリックと二重発火させないため（xterm の Linkifier が
   hover 中だけこのクラスを付ける。`decorations.pointerCursor` を切る provider には効かないが、
   本アプリの provider は `pointerCursor: true`）
4. 主ボタンの押下→解放で、移動が閾値内（ドラッグは選択のまま）

`preventDefault()` はしない（選択が壊れる）。送出は既存のホイール経路と同じ `term.input(seq, false)`。

### 3. テスト

- `test/src/composables/wheelReports.spec.ts` → `mouseReports.spec.ts`（既存ケースは維持）。
  追加: `cellFromPoint` のセル境界とクランプ、`isClickGesture` の閾値境界、
  `clickReportSequences` の press/release 文字列
- `test/src/composables/mouseClickReports.integration.spec.ts` — 実 xterm を jsdom で open し、
  `\x1b[?1002;1006h`（破棄される）の後に `.xterm-screen` へ mousedown/mouseup を dispatch して
  `onData` に SGR クリック報告が流れることを固定する。純関数だけのテストでは「配線を間違えても緑」
  になるため（`mouseTrackingGuard.spec.ts` と同じ思想）。jsdom の `getBoundingClientRect` は
  ゼロを返すのでスタブする

### 4. ドキュメント

`docs/terminal-notes.md` の「Mouse tracking & selection — `guardMouseTracking` (#729/#737)」節に、
クリックも合成であること・リンク hover 中はスキップすることを追記。

## スコープ外

- 右クリック / 中クリック、修飾キー付きクリック（SGR button への 4/8/16 加算）
- ドラッグ報告（#729 の意図そのものなので永続的に対象外）
- 通常バッファでのクリック合成（上記ゲート 1）
