# feat(#897): コレクションを Google カレンダーへ push する

issue: #897 ／ 前提: #889 で `@mulmoclaude/collection-plugin` を `^1.1.1` に据え置いた件の解消

## 課題

`@mulmoclaude/collection-plugin` 1.2.0 が `CollectionUi` に **`pushCalendarCollection` を
必須プロパティとして**追加した。ホスト側に実装がないと `yarn typecheck` が落ちるので、
#889 では collection-plugin だけ据え置いて他の依存だけ上げた。この変更でそれを解消する。

エンジンは `@mulmoclaude/core` 1.7.0 に既にある。ホストが書くのは**アダプタだけ**。

```ts
export declare function pushCalendarForCollection(
  slug: string, workspaceRoot: string, deps?: CalendarPushDeps,  // deps は既定値あり
): Promise<CalendarPushOutcome>;
```

## 決めたこと

> **追記（実装後）**: 初版はプラグインの型とコメントだけを頼りに書き、`../mulmoclaude` の
> 参照実装と食い違った。ルートのパスを `/calendar/push` と推測し（正しくは `calendar-push`）、
> 失敗を全部 200 で返し、文言を独自に書いていた。以下は突き合わせ後の内容。
> 経緯は CLAUDE.md の「MulmoClaude is the reference host」に規約として残した。

### 1. **どの失敗を HTTP ステータスにし、どれを 200 のフィールドにするか**

これがこの変更で一番効いている判断で、プラグインの実装がそう要求している。

```js
// collection-plugin/dist/vue.js — pushCalendar()
const result = await cui.pushCalendarCollection(current.slug);
if (!result.ok) { loadError.value = result.error; return; }   // ページ全体のエラー欄
await loadCollection(current.slug);
reportPush(result.data);                                       // インラインのバナー
```

`reportPush` に添えられたコメントが `Problems arrive as fields on an HTTP 200` と明言して
いる。未連携・読み取り専用を 4xx で返すと `loadError`（ページ全体）に落ち、**push を
押した文脈から切り離された場所**に出てしまう。プラグインが用意しているのは
`pushProblems()` → `collectionsView.pushFailed` のインライン経路のほうで、そこに載せる
には 200 で `errors` に入れて返すしかない。

`errors` を空にしたまま `created: 0` を返すのも同じ理由で誤り — プラグインのコメントが
「a push that reported only its counts would render a setup failure as "0 created"」と
書いているとおり、「何もすることがなかった」に読めてしまう。

HTTP ステータスで弾くのは「push の結果を報告する相手そのものが無い」場合だけ。

| 状況 | 応答 |
|---|---|
| コレクションが存在しない | **404** |
| `googleCalendar` 未宣言 | **200** + `errors`（下記の divergence） |
| 未連携 / 読み取り専用 / エンジン失敗 | **200** + `errors` |
| 予期しない例外 | **500** |

`pushCalendarForCollection` は自前で try/catch して `{kind:"failed"}` を返すので 500 には
通常来ないが、保険は残す。

#### `googleCalendar` 未宣言だけ参照実装と分かれる

参照実装はここを **400** で弾く。こちらは **200 + `errors`** にした。理由は
**2 つのホストの fetch ラッパが違う**こと:

```ts
// mulmoclaude/src/utils/api.ts
if (!res.ok) { const { error, status } = await extractError(res); return { ok:false, error, status }; }
//                     ^^^^^^^^^^^^ 本文から理由を取り出す

// mulmoterminal/src/utils/fetchJson.ts
if (!res.ok) return { ok: false, error: `HTTP ${res.status}`, status: res.status };
//                                       ^^^^^^^^^^^^^^^^^^ 本文を捨てる
```

MulmoClaude では 400 でも文言がユーザーに届く。こちらで 400 を返すと
**「HTTP 400」しか出ない** — 直せる設定の問題が、説明のないページ全体エラーに化ける。
揃えるべきはステータスコードではなく**ユーザーに届く体験**なので、ここは分かれる。

ゲートを外すとエンジン側の calendar-only な lookup が `not-a-calendar` を返すので、
ルートに分岐を書く必要はない。

根本的には `fetchJson` に本文を読ませれば両者は再統合できる。全ルートの挙動が変わる
変更なので別 issue。

### 2. outcome → wire 形の変換は純粋関数として切り出す

`CalendarPushOutcome` は 5 通りの union で、4 通りが「押せなかった理由」。ここが
この変更の実質的なロジックのすべてなので、ルートから切り離して `kind` ごとに
テストする（CLAUDE.md の「純粋なデータ変換は別ファイルへ」）。

| outcome | wire |
|---|---|
| `pushed` | カウントをそのまま（engine 側の `slug` は落とす） |
| `not-linked` | カウント 0 + `errors: [PUSH_NOT_LINKED_ERROR]` |
| `not-a-calendar` | カウント 0 + `errors: [PUSH_NOT_DECLARED_ERROR]` |
| `read-only` | カウント 0 + `errors: [accessRole を含む文言]` |
| `failed` | カウント 0 + `errors: [エンジンのメッセージ]` |

`pushed` は**常に `true`**（型もリテラル）。参照実装に倣った。プラグインの公開型は
`boolean` だが、プラグインは `pushed` を読んでおらず（`reportPush` は `pushProblems` と
カウントだけ）、`pushWroteSomething()` も export されているだけで未使用。意味が
未定義のフィールドで 2 ホストが割れるより揃えるほうを取った。upstream で意味を
確定させる価値はある。

文言も参照実装からそのまま移植した。両方使うユーザーが同じ設定不備に別々の説明を
受けないため。

`not-a-calendar` は実際にここを通る（ルートは存在チェックしかしない）。

### 3. 置き場所

- `common/collectionPush.ts` — wire 型。サーバが組み立て UI が読む形なので common
  （`voiceInputStatus.ts` と同じ理由）。プラグインの `CollectionPushResult` とは
  **構造的に一致させるだけ**で、プラグインの型を server から import はしない
  （Vue 向けパッケージをサーバに引き込みたくない）
- `server/backends/calendarPushResult.ts` — 純粋変換 + 文言定数
- `server/backends/calendarPush.ts` — ルート。**deps 注入**（`mountGoogleRoutes` と同じ形）。
  どの失敗をどのステータスにするかがこのルートの仕事そのものなので、実ワークスペースと
  Google grant なしに固められる必要がある。`workspaceRoot` は**リクエストごとに**読む —
  コレクションホストの設定はルート mount より後なので、mount 時に読むと空文字のままになる
- `src/composables/collectionUi.ts` — バインディング 1 行（`refreshCollection` の隣）

## テスト

- `calendarPushResult.spec.ts` — 変換。`kind` 5 通り、部分成功、`accessRole` が空のとき、
  refusal ごとに配列が独立していること
- `calendarPush.spec.ts` — ルート。404 ゲート、refusal 4 通りがすべて 200 + `errors` に
  なること、workspace をリクエストごとに読むこと、依存が throw したときの 500

どちらも実装を書き換えると実際に落ちることを確認済み（ゲートを潰す / workspace を
mount 時に固定する / 共有オブジェクトにする）。

## 実機で確かめられていないこと

Google カレンダーへの実書き込みは**このマシンでは確認していない**。実サーバでは
404（不在の slug）とカレンダー未宣言の経路まで到達を確認したが、
`pushed` / `not-linked` / `read-only` には `schema.googleCalendar` を宣言した
コレクションと連携済みアカウントが要る。
