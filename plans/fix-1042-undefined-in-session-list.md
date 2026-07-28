# `work: undefined` が Firestore の書き込みごと落とす

Issue: #1042（#1017 のリグレッション。入れたのは自分）

## 症状

スマホの一覧にセッションが 1 件も出ない。`work` の行が欠けるのではなく、
**`listTerminalSessions` の返信そのものが書けず全滅する。**

## 原因

`Map.get()` が `undefined` を返してもキーは残り、`buildSessionList` のスプレッドがそれを
運ぶ。Firestore は `undefined` を深さを問わず拒否するので、`updateDoc` が例外になり
`status: "done"` が入らず、スマホは待ち続けてタイムアウトする。

`work?: SessionWorkSummary` は optional だが、`exactOptionalPropertyTypes` が無効なので
`{ work: undefined }` は型検査を通る。型では防げていない。

## 対策（issue の 1 と 2 を両方）

### 1. キーごと落とす — `buildSessionList`

呼び出し側ではなく、**optional と宣言している型と同じ場所**で落とす。`detailOf` の呼び出し側が
将来増えても再発しない。

```ts
.map(({ work, ...rest }) => (work ? { ...rest, work } : rest))
```

### 2. 書き込み前のガード — ハンドラ table のラッパ

`work` を直しても、ハンドラの戻り値は自由な JSON なので同じ事故が再発する。
`server/backends/remoteHost/firestoreSafeResult.ts`:

- `undefinedPaths(value)` — `result.sessions.3.work` の形でパスを返す。Firestore の素のエラーは
  ドキュメントしか教えてくれないので、**パスを出すことが価値**
- `stripUndefined(value)` — オブジェクトはキーごと削除、配列は `null` に（添字がずれると
  送り手の意図が変わるため）
- `firestoreSafeHandlers(handlers, warn)` — table 全体を包む。壊れた 1 つではなく全部に掛ける

**エラーではなく除去 + warn** を採る（issue の推奨どおり）。throw だと今回と同じ「一覧が全滅」
になり、この機構が防ごうとしている結果そのものになる。warn があるので黙って消えることはない。

`ignoreUndefinedProperties` は採らない。バグが「なぜか値が来ない」に化けて、grep する手がかりも
残らない。

**集約先が core でなくここなのは**、core が published package で跨げないため。issue にある
暫定案どおり。

## テスト

- `undefinedPaths`: ネスト / 配列の添字 / 複数 / **null は素通し** / 値そのものが undefined
- `stripUndefined`: キーごと削除 / ネスト / 配列は null で位置を保つ / 綺麗な値は不変
- `firestoreSafeHandlers`: 綺麗なら warn 無しで素通し / 除去してパスとハンドラ名を warn /
  async を await してから見る / table 全体に掛かる / **ハンドラ名が変わらない**
  （名前は capabilities として広告される）
- リグレッション: `buildSessionList` の結果を `Object.hasOwn(s, "work") === false` で見る。
  `expect(s.work).toBeUndefined()` は**壊れた形でも通る**（issue の指摘どおり）。
  さらに `undefinedPaths` に通して空であることも確認する

## やらないこと

`exactOptionalPropertyTypes` の有効化は影響が読めないので別 issue（issue の 4 のとおり）。
