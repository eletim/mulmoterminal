# feat(remote-host): スマホのコマンド候補をユーザカスタムできるようにする

Issue: #830 / スマホ側: receptron/mulmoserver#112

## やること

スマホのターミナル表示に出る候補チップは、今は `suggestion`（エージェント自身が出している
dim ゴーストテキスト、#563）だけ。**ユーザ定義の定型**（「PR作って」「mergeして」）を足せるようにする。

## 決めたこと（ユーザ確認済み）

| 論点 | 決定 |
|---|---|
| 保存先 | `AppConfig.quickCommands`（案 A）。既存の `launchers` と同じ扱い |
| エージェント種別の出し分け | **各エントリに任意の `agents`**。省略＝全種別 |
| label と本文 | **分ける**。`label` はチップの面、`text` が挿入される本文 |
| タップ時 | **入力欄に差し込むだけ**（送信しない）。既存の suggestion チップと挙動が揃う |
| デフォルト同梱 | **しない**。空リストで出荷 |
| 編集 UI | mulmoterminal の Settings |

## 設計

### 型は `common/` に置く

`QuickCommand` は**サーバ（検証・保存）と Settings UI（編集）の両方が読む**ので
`common/quickCommands.ts` に1回だけ定義する。`SessionAgent` も同様に
`common/sessionAgent.ts` へ移した（UI が種別チェックボックスを出すため）。

zod スキーマは `server/config/config-schema.ts` に残し、`satisfies z.ZodType<QuickCommand>`
で共有型と突き合わせる。スキーマだけ広げて interface を広げ忘れると**コンパイルが通らない**。

> 既存の `Launcher` / `UserMcpServer` は `src/components/launchers.ts` などに
> 「mirrors the server's X」と書かれた手写しコピーが残っている。今回はそれを増やさない
> 方針にしたが、既存分の解消は本 PR のスコープ外（#828 系の別作業）。

### フィルタはホスト側

`quickCommandsForAgent(commands, agent)` が純粋関数として絞り込み、**`agents` を落として**
`{label, text}` だけ返す。スマホは「渡されたものを並べる」だけでよく、セッション種別という
概念を持たなくて済む（`githubUrl` と同じ方針）。

種別が **unknown（null）** のセッション（再起動をまたいで tmux にだけ残っているもの）には
**スコープ付きのエントリを出さない**。「git status」を実は Claude だったセッションに出すより、
出さない方がマシ。スコープ無しは出す。

### `SessionScreenMeta` ではなく `SessionScreen` に置く

`definedScreenMeta` は値に `.trim()` を掛けるので**文字列前提**。配列を meta に入れると壊れる。
`quickCommands` は常に存在する配列（該当なしは `[]`）とし、スマホ側の存在チェックを不要にした。

## 実装

| ファイル | 変更 |
|---|---|
| `common/sessionAgent.ts`（新規） | `SESSION_AGENTS` / `SessionAgent` を `terminalScreen.ts` から移動 |
| `common/quickCommands.ts`（新規） | `QuickCommand` |
| `server/config/config-schema.ts` | `quickCommandSchema`（`satisfies` で共有型と一致を強制） |
| `server/config/app-config.ts` | `AppConfig.quickCommands` + `sanitizeQuickCommands` |
| `server/config/config-body.ts` | `ARRAY_FIELDS` に追加 |
| `server/config/config-routes.ts` | `getQuickCommands()` |
| `server/backends/remoteHost/quickCommands.ts`（新規） | 純粋なフィルタ + `QuickCommandChip` |
| `server/backends/remoteHost/terminalScreen.ts` | `SessionScreen.quickCommands` + `CaptureScreenDeps.quickCommandsOf` |
| `server/index.ts` | 配線。`agentOfSession` を切り出し（同じ式が既に2箇所にあった） |
| `src/composables/useAppConfig.ts` | `quickCommands` + `saveQuickCommands` |
| `src/components/settingsValidators.ts` | `canAddQuickCommand` |
| `src/components/SettingsModal.vue` | 編集 UI（label / text / 種別チェックボックス） |
| `src/components/AppSettingsModal.vue` | 配線 |

### `config-body.ts` の `ARRAY_FIELDS` を忘れないこと

同ファイルのコメントが理由を明記している：merge は「present なら置換」で、sanitizer は
非配列に空配列を返す。よって `{"quickCommands": {}}` は 400 ではなく**保存済みリストの
消去**として通ってしまう。

## テスト

- `test/server/backends/remoteHost/quickCommands.spec.ts` — スコープ規則8ケース
- `test/server/config/app-config.spec.ts` — `sanitizeQuickCommands` 5ケース（trim/重複/junk、
  `agents` の重複除去、空 `agents` の畳み込み、存在しない種別の拒否、長さ・件数の上限）
- `terminalScreen.spec.ts` — `SessionScreen` の完全一致アサーションを更新

### ミューテーション確認

| 壊し方 | 結果 |
|---|---|
| 未知の種別にスコープ付きも出すようにする | 1件赤 |
| 「スコープ無し＝全種別」を外す | 4件赤 |
| 空の `agents` を unscoped に畳まない | 1件赤 |

`agent !== null` を外す変異は**赤にならなかった**。`includes(null)` は常に false なので
挙動は変わらず、あれは**型を通すためのガード**だった。テストが弱いのではないと確認したうえで、
実際に挙動が変わる変異で測り直している。

## 対象外

- スマホ側のチップ描画（receptron/mulmoserver#112）
- 既存の `Launcher` / `UserMcpServer` の手写しコピー解消
