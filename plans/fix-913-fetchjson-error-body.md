# fix #913 — `fetchJson` がサーバの理由を捨てている

サーバは一貫して `res.status(4xx).json({ error })` で**理由**を返しているのに、`fetchJson` は
非 2xx で本文を読まず `HTTP <status>` だけを返していた。直せる設定の問題が、説明のない
エラーに化ける。

## 直し方

非 OK 分岐で本文を読み、`{ error: string }` があればそれを、無ければ従来どおり
`HTTP <status>` を返す。

```ts
if (!res.ok) return { ok: false, error: errorMessage(await readErrorBody(res), res.status), status: res.status };
```

## 本文読み取りは独立した try/catch にする

`fetchJson` の外側の catch は `status: 0` を返す。これは「**リクエストがサーバに届かなかった**」
という意味で、コレクション UI は 404（not found）とオフラインをこれで区別している。本文の
パース失敗をそこに落とすと、HTTP エラーがオフライン扱いになる。

実際、既存テストの非 OK モックは `{ ok: false, status: 404 }` で **`json` メソッド自体が無い**。
`res.json()` は同期的に TypeError を投げるので、`.catch()` では捕まらない。独立した
try/catch が要る。

## 重複していたルールを共有する

`collectionUiRules.ts` の `deleteErrorMessage(body, status)` が、まさにこの issue が求める
ルールそのものだった（DELETE は成功時に本文を返さないので自前で fetch している）。

`fetchJson.ts` に `errorMessage(body, status)` として置き、`deleteErrorMessage` は削除して
呼び出し側を共有ルールに向けた。テストも移した。`deleteCollection` 自体を `fetchJson` に
寄せることはしない — 成功時に本文が無いため `await res.json()` が投げる。

## 影響

`apiGet` / `apiPost` / `apiPut` 経由でほぼ全 UI のエラー文言が変わる（サーバがメッセージを
返している場合）。`status` の意味は不変なので、404 判別は動き続ける。

既存テストで文言を assert しているのは `PrsOverlay.spec` の `HTTP 500` だが、そのモックは
`json: async () => ({})` を返すので `error` フィールドが無く、フォールバックのまま通る。

## #907 との関係

#907 は「MulmoTerminal では 400 の本文が UI に届かない」ため 200 + `errors` へ迂回していた。
これが直ったので、その迂回は外せる可能性がある。**本 PR では触らない** — 迂回を戻すかは
#907 側の判断で、混ぜると切り分けができなくなる。
