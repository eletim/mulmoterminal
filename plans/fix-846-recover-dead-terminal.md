# fix #846 — 死んだターミナルを reload なしで復帰させる

リサイズ後にセルが真っ白になり、以後そのセルは一切更新されなくなる（#846）。根本原因は
xterm 6.0.0 本体の `Buffer.resize` バグ（本家 xtermjs/xterm.js#6063、未修正）なので**こちらでは
直せない**。直せるのは「ユーザーが reload するしかない」状態のほうで、本 PR はそれをやる。

## 実測で分かったこと（headless 6.0.0 で upstream の状態を再現して確認）

upstream のフライトレコーダの値（`ybase=5, y=13, lines.length=18` の状態で 39x18 → 37x23）を
再現すると、こちらでも同じ例外（`_eraseInBufferLine` の `replaceCells`）が出る。そのうえで:

| 状態 | `write` の callback | バッファ不変条件 |
|---|---|---|
| 正常 | 発火 | ok |
| クラッシュ後 | **発火しない** | 壊れている |
| `term.reset()` 後（＝`connect()` がすること） | **発火しない** | 直る |
| Terminal を作り直す | 発火 | ok |

- **例外は xterm の内部タスク（`_innerWrite` の setTimeout）で投げられる**ので、`term.write()` の
  呼び出し側 try/catch では捕まえられない。だから「例外を捕まえて直す」方式は取れない
- **`WriteBuffer` が永久に止まる**: `write()` はキューが空だったときしか `_innerWrite` を起こさない
  （`if (this._writeBuffer.length === 1)`）。throw で残ったキューは二度と流れない。これが
  「以後そのセルは一切更新されない」の正体
- `term.reset()` はバッファを作り直す（`fillViewportRows`）ので不変条件は直るが、
  **WriteBuffer は直らない**。つまり `connect()`（reset + 再接続）だけでは復帰しない
- 描画ループは例外で止まらない（`RenderDebouncer._innerRefresh` は `_animationFrame` を先に
  クリアしてから描画コールバックを呼ぶ）。復帰後は次のフレームで描き直される

## 方針: 壊れたバッファを検知して、そのスロットの Terminal を作り直す

PTY はサーバ側で生きており、再アタッチでバッファ末尾が replay される（`terminal-replay.ts`）。
つまり Terminal を捨てて作り直し、同じセッションに再接続すれば、ユーザーから見て**セルが一瞬
またたいて戻る**。失うのは replay 範囲外のスクロールバックだけ。

### 1. 検知（`src/composables/terminalBufferHealth.ts` 新規）

純関数で、public API から読める値だけを見る:

```ts
bufferIsShort({ length, baseY, cursorY, rows })
  = length < baseY + rows   // レンダラが読む行が無い
  || length <= baseY + cursorY  // InputHandler が書く行が無い
```

upstream が壊すのはまさにこの不変条件で、フライトレコーダの記録では**致命的な resize の前**から
既に壊れている（マスクされていただけ）。つまり多くの場合、**クラッシュする前に検知できる**。

呼ぶ場所は 2 箇所:

- `fit()` の直後 — リサイズがトリガーなので、壊れた直後に気付ける
- 出力メッセージ受信時（`handleMessage`）— リサイズが続かないケースを拾う。読むのは 4 プロパティだけ

**誤検知したら復帰動作が破壊的**なので、初回検知では直さず**次のマクロタスクで再確認**する。
パース途中の一時的な状態はそこで消えるが、本当に死んでいれば状態は動かない。

### 2. 復帰（`useTerminalConnections.ts`）

`ensure()` の Terminal 生成部分を `buildTerminal()` に切り出し、`rebuildTerminal(c)` から再利用する:

1. 新しい Terminal + addon + host を作る（`swallowedMouseModes` は Conn のものを引き継ぐ）
2. `registerFilePathLinks` / `wireTerminalInput` を張り直し、テーマを再適用
3. 新 host を `attachedEl` に挿し、旧 host を外して旧 Terminal を dispose
4. `connect(c)` — 同じセッションに再接続 → サーバが末尾を replay
5. `fitAndSyncSize(c)` — 新しい Terminal を実サイズに合わせ、PTY にも伝える

フォーカスは、旧 host がフォーカスを持っていたときだけ復元する（他セルからフォーカスを奪わない）。

**やらないケース**:

- `c.sawExit` のスロット（終了済みセッション）— 再接続はコマンドを再実行しかねないし、replay の
  無い空のターミナルは「固まったが読める画面」より悪い
- 直近 `REBUILD_COOLDOWN_MS` 以内に作り直したスロット — 検知が続いても暴走させない

### 3. テスト

- `test/src/composables/terminalBufferHealth.spec.ts`
  - 純関数: 健全な状態、upstream のフライトレコーダの実値（`length=18, ybase=5, y=13, rows=18` と
    resize 後の `length=18, ybase=0, y=18, rows=23`）、境界値
  - **誤検知しないこと**: 実 headless Terminal に write / resize / reset / alt 画面切替 / scroll を
    ランダムに流し、プローブが一度も鳴らないことを固定する。誤検知は破壊的な復帰動作を招くので、
    ここが一番大事なテスト

### 4. ドキュメント

`docs/terminal-notes.md` に、この故障モード（WriteBuffer が止まる／reset では直らない／Terminal を
作り直す）と upstream issue へのリンクを書く。

## スコープ外

- `fitAndSyncSize` の退化ボックスガード（#846 の対策 2）。トリガーである確証が無く、本 PR の
  復帰機構とは独立に判断できる
- upstream バグ自体の回避（`Buffer.resize` の穴は xtermjs/xterm.js#6063 待ち）
