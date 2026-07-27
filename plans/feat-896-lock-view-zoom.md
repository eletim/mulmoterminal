# feat #896 — マウス/トラックパッドのズームでビューが拡大しないようにする

ターミナル操作中に `ctrl + ホイール`（トラックパッドのピンチはこの形で届く）でブラウザの
ページズームが効いてしまう。ズーム倍率が変わるとレイアウトも xterm の fit もずれるので、
うっかり触った拡大は事故でしかない。

## 何を止めて、何を残すか

| 入力 | 扱い | 理由 |
|---|---|---|
| `wheel` + `ctrlKey` | 止める | Chrome / Firefox / Edge のピンチ・`ctrl+ホイール` はこれ |
| `gesturestart` / `gesturechange` / `gestureend` | 止める | WebKit のトラックパッドピンチ。Safari は wheel を出さない経路がある |
| `Cmd/Ctrl` + `+` `-` `0` | **残す** | 意図的な拡大の逃げ道。うっかり押す入力ではない |
| スマホの指ピンチ | **残す** | `index.html` の viewport meta は触らない。電話から見るときに拡大できないのは困る |

「うっかり」だけを潰して、意図した拡大は残す、という切り分け。読みづらいときの手段としては
アプリ内のターミナルフォントサイズ設定（`useTerminalFontSize`）もある。

## 実装

`src/composables/usePageZoomGuard.ts` — `installFileDropGuard` と同じ形の window レベルガード。

- `main.ts` で mount 前に install（両ビューとその隙間を丸ごとカバーするため）
- `wheel` は `{ passive: false }` 必須。Chrome は window/document の wheel を既定で passive
  扱いにするので、付けないと `preventDefault()` が黙って無視される
- window の bubble 段で止める。ターミナル自身の wheel ハンドラ（`terminalMouseInput` の SGR
  レポート）は子から先に走るので、そちらの動作は変わらない
- `gesture*` は WebKit 独自イベントで `WindowEventMap` に無い。`preventDefault()` しか
  使わないので `Event` のまま扱えばキャストは要らない

## テスト

`test/src/composables/usePageZoomGuard.spec.ts`

- ctrl 付き wheel は preventDefault される / ctrl なしは素通り
- gesture 3 種が preventDefault される
- wheel は `{ passive: false }` で登録されている（これが抜けると Chrome で無言で効かなくなる）
- teardown で全リスナが外れる
- 実 window に dispatch して `defaultPrevented` を見る統合ケース
