# feat(push): Web Push を種類ごとに ON/OFF する

Issue: #850

## 発端

ユーザから「タスクが終わっていないのに通知が頻繁に来る」。調べると**仕様**で、しかも
**現状の設定では回避できない**。

Push は2種類（`pushKindFor`）:

| 種類 | フック | 通知 |
|---|---|---|
| `finished` | `Stop` | ✅ ターンが完了した |
| `waiting` | `Notification` | ❓ 許可プロンプト・質問で止まっている |

`waiting` は `36e9e72`（2026-07-21）で追加された。`Notification` は Claude Code が許可を
求めるたびに発火するので、**長いタスクで許可が何度も要れば、そのたびに飛ぶ**。1件ずつは
「入力待ち」として正しいが、体感は「途中で頻繁に来る」。

ユーザ設定は `pushEnabled` の ON/OFF だけで、**片方だけ止められない**。

## 設計

`pushEnabled`（master）は**残す**。種類の許可リスト `pushKinds` を**足す**。

```
送信条件 = pushEnabled && pushKinds.includes(kind)
```

`pushEnabled` を三値化や列挙に置き換えなかった理由:

- **後方互換**。意味が変わらないので設定ファイルの移行ロジックが要らない
- 一時的に全部止めても**種類の選択が失われない**
- `[]` を「off」と兼用させると、master と紛らわしい

### `PUSH_KINDS` と `DEFAULT_PUSH_KINDS` を分ける（今回の再発防止）

```ts
export const PUSH_KINDS = ["finished", "waiting"] as const;   // 存在する全種類
export const DEFAULT_PUSH_KINDS: PushKind[] = ["finished", "waiting"];  // 新規 config の初期値
```

**今回の不満の根本は「`waiting` が追加されて全員に黙って有効化された」こと。** 将来
`PUSH_KINDS` に種類を足しても `DEFAULT_PUSH_KINDS` に入れなければ、既存ユーザには
**勝手に鳴らない**（opt-in になる）。

この2つが「同じに見えて意図的に違う」ことは、CLAUDE.md の言う「意図的な非対称」なので
**テストでピン留めする**。次の読者が「揃える」修正をしないように。

### 種類は `common/` に置く

サーバ（送信判定）と Settings UI（チェックボックス）の両方が読むため。
`PushKind` は今 `server/session/activity-hook.ts` にあるので移す。

### `config-body.ts` の `ARRAY_FIELDS` に追加する

同ファイルのコメントどおり、merge は「present なら置換」で sanitizer は非配列に空配列を
返す。入れないと `{"pushKinds": {}}` が 400 ではなく**保存済みリストの消去**として通る。
quickCommands（#830）で踏んだのと同じ穴。

## 実装

| ファイル | 変更 |
|---|---|
| `common/pushKinds.ts`（新規） | `PUSH_KINDS` / `DEFAULT_PUSH_KINDS` / `PushKind` / `isPushKind` |
| `server/session/activity-hook.ts` | `PushKind` を common から import |
| `server/config/app-config.ts` | `pushKinds` + `sanitizePushKinds` |
| `server/config/config-body.ts` | `ARRAY_FIELDS` に追加 |
| `server/config/config-routes.ts` | `getPushKinds()` |
| `server/session/task-push.ts` | 種類でゲート |
| `src/composables/useAppConfig.ts` | `pushKinds` + `savePushKinds` |
| `src/components/SettingsModal.vue` | 種類ごとのチェックボックス |
| `src/components/AppSettingsModal.vue` | 配線 |

## ドキュメント（ユーザ要望）

**「どの設定で、どういうときに飛ぶか」をガイドに明記する。**

- `docs/guide/{en,ja}/notifications.md` — 「通知が来る条件」を**種類ごとの表**に書き直す。
  トグル / 種類の選択 / 実際に飛ぶ瞬間 / 通知の見た目（✅ ❓）を対応付ける
- `docs/guide/{en,ja}/phone.md` — 通知の節からリンク
- `README.md` — config 表に `pushKinds`

**「許可プロンプトごとに飛ぶ」ことを明記する。** 今回の不満はこれを知らずに使ったことが
半分なので、「なぜ頻繁に来るのか」が読んで分かる状態にする。

## テスト

- `sanitizePushKinds` — 未知の値を落とす / 重複除去 / 非配列 / **未設定は DEFAULT**
- `PUSH_KINDS` と `DEFAULT_PUSH_KINDS` の**意図的な差**をピン留め
- 送信ゲート — master off / 種類が外れている / 両方満たす
