# fix(#890): 音声入力の言語選択まわりの後始末

issue: #890 ／ 対象: #887（`a311a3c`）のレビュー指摘

## 課題

#887「話す言語を選べるようにする」は機能としては正しく動いている。whisper に聞こえない
言語を強制すると翻訳が返る、という前提も、依存パッケージとサーバ実装の両方で裏が取れた。
残ったのは**規約違反と後始末**——ドキュメント、重複、型、テスト。

加えて、レビュー中に**既存のバグ**が 1 件見つかった。ポルトガル語ブラウザでは
「My browser's language」が実質「自動検出」になる（詳細は下）。#887 以前からある挙動だが、
今回ラベルが付いたことで約束と実装のずれが表に出たので、ここで塞ぐ。

## 決めたこと

### 1. `/api/transcribe/model` のレスポンス形は `common/` に置く

現状、同じ wire 形が **3 箇所**に別々に書かれている。

| 場所 | 定義 |
|---|---|
| `server/backends/whisper.ts` | `interface VoiceInputStatus` |
| `src/composables/useVoiceInput.ts` | `interface VoiceModelStatusResponse` |
| `src/components/SettingsModal.vue` | インラインの `{ capable?: boolean }` |

CLAUDE.md の指針どおり `common/voiceInputStatus.ts` に一本化する。**core の型を
re-export はしない**——これは API 契約であって、サーバがどのパッケージで実装しているかは
UI の関知するところではない。state のリテラル union は独立に書き、サーバ側の
`getVoiceInputStatus(): VoiceInputStatus` という戻り値注釈が両者の一致を型で保証する。

### 2. capability の取得は 1 本の関数に

`SettingsModal` の `refreshVoiceCapable` と `useVoiceInput` の `fetchModelStatus` は
同じ GET を別々に書いている。`src/composables/voiceModelStatus.ts` に
`fetchVoiceInputStatus()` として出し、両者がそれを呼ぶ。

ついでに **AbortController によるタイムアウト**をここに入れる（CLAUDE.md の必須ルール。
`src/utils/translateUi.ts` が同じ形）。同一オリジンなので詰まる見込みは薄いが、
`useVoiceInput` はこれをポーリングに使っているので、応答しない GET が溜まるのは避けたい。

### 3. `voiceLanguage` を union 型にする

`ref<string>` だと、localStorage 読み出し経路のバリデーションだけが守られ、代入は素通り。
`VOICE_LANGUAGES` を `as const` にして `VoiceLanguage` を導出し、`parseVoiceLanguage` を
**型ガードを通る本物の絞り込み**にする。永続化した値を信用しない、という #887 の判断は
そのまま——型は「今のコードが壊せない」ことしか保証せず、localStorage の中身は保証しない。

### 4. ポルトガル語の既定が壊れている件

`browserLocale()` は地域サブタグを落とす（`en-GB` と `en-US` が同じ翻訳束を引くべきなので、
これ自体は正しい）。ところが core の `LOCALE_TO_WHISPER` は**ポルトガル語だけキーが
`pt-BR`** なので、`pt` は表を素通りして `auto` になる。

```
pt-BR  -> pt  -> auto     ← 8 言語中これだけ
pt-PT  -> pt  -> auto
ja-JP  -> ja  -> ja       (他は全て正常)
```

表は依存パッケージ側にあり、`navigator.language` をそのまま渡す案は
`en-US` などの他の locale を巻き添えに壊すので採らない。UI 側で
`browserVoiceLanguage()` を挟み、**core が諦めた（`auto` を返した）ときにだけ**、
その locale がピッカーの提供言語なら採用する。将来 core が別の言語を地域付きキーで
足しても同じ経路で救われる。

### 5. `<select>` のクラス列と focus trap のセレクタを共有する

- `SettingsModal` の `<select>` は `ModelPicker` と `font-mono` 以外完全一致 →
  `src/components/selectClasses.ts` の `SELECT_CONTROL` へ。既存の
  `cellChromeClasses.ts` と同じ「クラス列は定数、CSS は書かない」流儀。
- `trapTabKey` のセレクタ文字列が `SettingsModal` と `ModelSetupHelp` に重複していて、
  しかも **`select` を含んでいない**。今回が設定モーダル初の `<select>`。中間位置なので
  現状は実害がないが、トラップが認識できないフォーカス可能要素がモーダル内にある状態は
  残さない。`focusTrap.ts` に `MODAL_FOCUSABLE` として出し、`select` と `textarea` を足す。

## テスト

- `voiceLanguage.spec.ts` に `browserVoiceLanguage` の分岐（表に載っている locale、
  ポルトガル語、未知の locale）を追加。
- `SettingsModal.spec.ts` に**セクションのゲート**を追加。`capable` が false / GET 失敗の
  ときに出ないことが要点で、#887 ではここが未検証だった。
- `focusTrap.spec.ts` に `MODAL_FOCUSABLE` が `<select>` を拾うことを追加。

## ドキュメント

`README.md` と `docs/guide/{en,ja}/features.md` の音声入力の記述に言語設定を足す。
ターミナルのフォントサイズが「設定モーダルで調整（ブラウザごと）」と書かれているのと
同じ粒度に揃える。日英は同時に更新する。
