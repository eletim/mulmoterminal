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

### 1. セットアップ不備は HTTP エラーではなく **200 + `errors`** で返す

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

サーバが 5xx を返すのは**予期しない例外のときだけ**。`pushCalendarForCollection` は自前で
try/catch して `{kind:"failed"}` を返すので通常そこには来ないが、保険は残す。

### 2. outcome → wire 形の変換は純粋関数として切り出す

`CalendarPushOutcome` は 5 通りの union で、4 通りが「押せなかった理由」。ここが
この変更の実質的なロジックのすべてなので、ルートから切り離して `kind` ごとに
テストする（CLAUDE.md の「純粋なデータ変換は別ファイルへ」）。

| outcome | wire |
|---|---|
| `pushed` | `pushed: true` + カウントをそのまま（`slug` は落とす） |
| `not-a-calendar` | `pushed: false` + このコレクションはカレンダーを宣言していない |
| `not-linked` | `pushed: false` + Google 未連携（Settings で連携するよう促す） |
| `read-only` | `pushed: false` + `accessRole` を添えて読み取り専用 |
| `failed` | `pushed: false` + エンジンのメッセージ |

`not-a-calendar` はプラグインのボタンが `schema.googleCalendar` で出し分けているので
UI からはまず起きない。API を直に叩いた場合の経路として残す。

### 3. 置き場所

- `common/collectionPush.ts` — wire 型。サーバが組み立て UI が読む形なので common
  （`voiceInputStatus.ts` と同じ理由）。プラグインの `CollectionPushResult` とは
  **構造的に一致させるだけ**で、プラグインの型を server から import はしない
  （Vue 向けパッケージをサーバに引き込みたくない）
- `server/backends/calendarPushResult.ts` — 純粋変換
- `server/backends/calendarPush.ts` — ルート。workspace は `getWorkspaceRoot()` で
  取れるので `mountCollectionRoutes` と同じく引数なしで mount できる
- `src/composables/collectionUi.ts` — バインディング 1 行（`refreshCollection` の隣）

## 実機で確かめられていないこと

Google カレンダーへの実書き込みは**このマシンでは確認していない**。`configureGoogleHost`
は `server/index.ts` で呼ばれているので既定 deps は動くはずだが、確かめたのは
「型が通る」「変換が正しい」までで、実際に Google にイベントが立つところは見ていない。
`schema.googleCalendar` を宣言したコレクションと連携済みアカウントが要る。
