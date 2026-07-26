# feat #886 — ヘッダー左のメニューをビューごとに変える

#884 でグリッドが起動時の画面になったのに、そこに「エージェントの監督」と無関係なボタンが
並んでいた。ツールバーは `AppToolbar.vue` 1 つを 2 つのビューがそれぞれ描画している
（`GridView.vue` がグリッド用の props 付き、`App.vue` が単一ビュー用）ので、差は `inGrid` で
表現できる。

## 分け方

| | グリッド | 単一ビュー |
|---|---|---|
| ビュー切替 | Chat / Grid view | Chat / Grid view |
| 監督しながら参照するもの | **Pull requests**, **Worklog** | — |
| グリッドを操作するもの | New terminal, 並び順, 状態カウント | — |
| コンテンツ | — | **Collections**, **Accounting**, **Wiki**, お気に入り |

Worklog は元々**右側**にあり、しかも既にグリッド専用だった。「Wiki をグリッドから外すのに、
グリッドには wiki を開くボタンが残る」という綻びになるので、左ナビの Pull requests の隣に
移した。どちらも「監督しながら参照する外部の面」で、グリッド自体を操作するボタンとは別の
グループになる。

ビュー切替の 2 つは両方に残す。片方でも隠すと、そのビューから出られなくなる。

## 合わせて直した: オーバーレイを閉じたときの戻り先

4 つのオーバーレイ（Collections / Wiki / PRs / Accounting）は、閉じると**必ず**
`{ name: "chat" }` へ push していた。つまりグリッドから開いて閉じると黙って単一ビューに落ちる。
PRs と Worklog をグリッド専用にする以上、この綻びは必ず踏む場所に来る。

`useFilesView` に既にあった仕組み（戻り先を **history エントリの state** に載せる）を
`overlayOrigin.ts` 1 本に切り出し、5 つ全部をそれに寄せた。history state に載せるのは、
ブラウザの戻る/進むでそのエントリ自身の origin が復元されるため。モジュール変数だと、別の
経路で開いた古い origin が残る。

- `overlayReturnPath()` — 開いた場所。無ければチャット（**リテラルの `"/"` ではない**。
  それは既定ビューの入口でグリッドに着地する #883）
- `overlayOriginState(alreadyOpen)` — push に載せる state。オーバーレイの**中**を移動する
  ときは最初の origin を持ち回る（wiki のタブ移動、collections の index→detail、ref hop）

## 検証

ユニットテスト 20 件（`overlayOrigin.spec.ts` 14 / `AppToolbar.spec.ts` 6）に加えて、
**ビルドした実アプリをヘッドレスブラウザで開き、ビューごとのボタン配列を読んだ**:

```
/terminals -> ["Chat","Grid view","Pull requests","New terminal","Toggle grid cell ordering"]
/chat      -> ["Chat","Grid view","Collections","Accounting","Wiki", <ピン留め 5 件>]
```

### 検証手順の事故（記録）

最初の実機確認は**古いサーバープロセスを見ていた**。同じポートに前回の検証サーバーが残って
いて、新しく起動した方は "Port already in use" で死んでおり、`/chat` が `/` に落ちる（#884
以前の挙動）という嘘の結果が出た。**起動ログを読むまで気づけなかった。**

さらに後始末で `pkill -f "server/index.ts"` を打ったが、このパターンは**利用者自身が動かして
いる MulmoTerminal 本体にも一致する**（`yarn server` も同じ入口を実行するため）。検証用の
サーバーは起動時の PID を控えて、その PID だけを kill すること。
