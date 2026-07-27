# feat #883 — 起動時の既定ビューをグリッドにする

グリッドは「複数エージェントを監督する」ための主役の画面なのに、起動して開くのは単一ビュー。
毎回ツールバーの Grid を押していた。

## 形

```ts
{ path: "/",          redirect: { name: "terminals" } },   // 既定ビューへの入口
{ path: "/terminals", name: "terminals", component: Stub },
{ path: "/chat",      name: "chat",      component: Stub },
{ path: "/:pathMatch(.*)*", redirect: "/" },               // 変更なし = 既定に追随
```

`/terminals` を正規 URL にし、`/` はそこへのリダイレクト。単一ビューには `/chat` を与える。

**`/` を「ビュー」ではなく「既定ビューへの入口」と定義した**のがこの変更の本体で、どの画面を
既定にするかがルータ 1 行の決定になる。設定キーは増やさない。catch-all も `/` 経由のままに
したので、既定を動かせば不明 URL の着地先も自動的に追随する。

## ルータより危なかったもの: パスで「チャット」を意味していた箇所

`router.push("/")` が「チャットに戻る」の意味でコードに散っていた。`/` がグリッドを指した
瞬間、全部グリッドに着地する — **ツールバーの Chat ボタン自身を含む**。

| 場所 | |
|---|---|
| `AppToolbar.vue` `showChat()` | Chat ボタンがグリッドへ飛ぶ |
| `GridView.vue` `configureAppearance()` | |
| `useCollectionBrowse.ts` `browseClose()` | |
| `useWikiBrowse.ts` `wikiClose()` | |
| `usePrsView.ts` `prsClose()` | |
| `useAccountingView.ts` `accountingViewClose()` | |

すべて `router.push({ name: "chat" })` に変えた。**パスをコードから消して名前だけにすることが、
「ルータ 1 行で既定を変えられる」を実際に成立させる条件**であり、この変更の一部。

### 7 箇所目はテストが見つけた

`useFilesView.ts` の `originFromHistory()` は、戻り先が history state に無いときのフォールバックが
**文字列リテラルの `"/"`** だった。`push("/")` を探す grep には掛からない形。Files を直リンクや
ブラウザ履歴で開いて閉じると、チャットではなくグリッドに戻る。

この値は history state にも書かれ、読み戻し側が `typeof origin === "string"` で判定しているので
戻り値は文字列のままにする必要がある。そこで `router.resolve({ name: "chat" }).fullPath` に
した — 文字列だが、知識は名前側にある。

## 検証

ユニットテスト（`test/src/` 1489 件）に加えて、**ビルドした実アプリを別ポートで起動し、
ヘッドレスブラウザで 4 経路を実際に開いた**:

| URL | 着地 | グリッド描画 |
|---|---|---|
| `/` | `/terminals` | true |
| `/chat` | `/chat` | false（＝単一ビュー） |
| `/terminals` | `/terminals` | true |
| `/nope` | `/terminals` | true |

サーバ側も実リクエストで確認: `/` `/chat` `/terminals` `/nope` すべて 200 で SPA シェル、
`/api/bogus` は 404（シェルを返さない）。SPA フォールバックは `/api` 以外を通す正規表現なので
**サーバの変更は不要**だった。

起動時の `router.isReady()` 待ち（`src/main.ts`）はリダイレクトも待つので、グリッドを描く前に
単一ビューの PTY を掴む事故は起きない。ナビゲーションガードは存在しない（確認済み）。

## 挙動が変わる点（意図的）

- 不明な URL の着地先が単一ビュー → グリッド。「不明な URL は既定ビューへ」という元の意図は保つ
- `/` をブックマークしている人は次回からグリッド。`/terminals` の直リンクは維持
