# feat(remote-host): スマホから、今見ているターミナルの dir で新規ターミナルを起動する

Issue: #831 / スマホ側: receptron/mulmoserver#114

## 調査で判明した制約（設計案が素直には通らなかった）

issue の設計案は「リモートハンドラを足して起動する」だったが、**サーバ側から grid セッションを
作る経路が存在しない**。

- `markDevTerminalSession()` の呼び出しは **`server/routes/ws-routes.ts` の3箇所だけ**。
  同ファイルのコメントが "the single choke point for every grid attach" と明記している。
  つまりセッションが「グリッドのセル」になるのは**ブラウザが WebSocket を開いたとき**だけ。
- グリッドのセル一覧（`gridTabs.ts` の `GridState`）は**ブラウザの状態**で、サーバは持たない。
- しかもこれは**スマホ自身の一覧にも効く** — `listTerminalSessions` は
  `isGridSession: (id) => devTerminalSessions.has(id)` で絞っている。

つまり「サーバが直接 spawn する」を選ぶと、**PC の grid に出ないセッション**ができる。

## 決めたこと（ユーザ確認済み）

| 論点 | 決定 |
|---|---|
| 方式 | **ブラウザに依頼（pubsub）**。grid にもスマホにも正しく出る。ブラウザ不在時は起動不可 |
| 起動対象 | **shell / codex / claude の3つ固定** |
| cwd | **今見ているセッションの dir 固定**。スマホからパスは受け取らない（後述） |
| 認可 | 既存ハンドラと同じ（remote-host 接続済みユーザ）。後述の根拠あり |
| 簡易版の範囲 | worktree 作成・モデル選択は**落とす** |

### cwd をスマホから受け取らない理由

スマホが送るのは **`sessionId` だけ**で、cwd はホストが `ptys.get(id)?.cwd` から引く。
パス文字列を受け付けると、リモートから任意ディレクトリでプロセスを起動できてしまう。
issue の推奨（自由入力は許さない）をさらに進め、**パスを一切受け取らない**形にした。

### 認可を既存ハンドラと同じにした根拠

`sendTerminalInput` は既に**任意のテキストを Claude セッションに打ち込める**。エージェントは
そのテキストに従って任意のコマンドを実行しうるので、「既存セッションの dir で shell を開く」は
権限の格上げにならない。よって追加のゲートは設けない。

## 設計

### ブラウザ側の継ぎ目は既にある

`src/composables/useNewTerminal.ts` が **"A seam for opening a new grid terminal cell from
anywhere"** として存在し、グリッド未マウント時のキュー＋画面遷移まで持っている。今は $SHELL
固定なので、`agent` を運べるように広げる。

セルの形は3種類とも既存の型で表現できる（`gridTabs.ts` の `Cell`）:

| 対象 | Cell |
|---|---|
| shell | `launcher: { shell: true, label: "shell" }`（= 既存の `shellCell`） |
| claude | 何も付けない（Claude が既定） |
| codex | `agent: "codex"` |

### ブラウザ不在をスマホに伝える

pubsub は socket.io の room なので、`io.sockets.adapter.rooms.get(channel)?.size` で
**購読者数が取れる**。0 ならハンドラがエラーを返し、スマホは「PC でブラウザを開いてください」と
出せる。publish しっぱなしで無言になるのが最悪なので、ここは明示する。

## 実装

| ファイル | 変更 |
|---|---|
| `server/infra/pubsub.ts` | `subscriberCount(channel)` を追加 |
| `common/launchAgent.ts`（新規） | `LAUNCH_AGENTS` / `LaunchAgent`（サーバもUIも読む） |
| `server/backends/remoteHost/launchTerminal.ts`（新規） | 純粋な判定（対象の検証・cwd 解決の可否） |
| `server/backends/remoteHost/handlers.ts` | `launchTerminal` ハンドラ |
| `server/index.ts` | 配線 |
| `src/composables/useNewTerminal.ts` | `agent` を運ぶ |
| `src/components/GridView.vue` | `agent` ごとにセルを作る／pubsub 購読 |

## 対象外

- スマホ側の起動画面（別 issue）
- worktree 作成・モデル選択
- `MAX_TERMINALS`(81) 到達時の扱い — ブラウザ側 `insertCellAfter` が既に上限で無変更を返す
  ので**黙って何も起きない**。スマホへの通知は pubsub が一方向なので今回は入れない（要検討）

## 実装中に判明したこと（追記）

### 購読は App.vue に置く（GridView ではない）

最初 GridView に購読を置いたが、`App.vue` は
`<KeepAlive><GridView v-if="isGrid" /></KeepAlive>` なので **一度も `/terminals` を開いて
いないと GridView は存在しない**。その状態ではブラウザが開いていても「開いていない」と
判定されてしまう。

`useNewTerminal.openTerminalAt` は「グリッド未マウントならキューして `/terminals` へ遷移」を
既に持っているので、常時マウントされる `App.vue` で購読して `openTerminalAt` を呼ぶのが正しい。

### `Publisher` 型を切り出した

`subscriberCount` を足したことで、**publish しか使わない `fileChange.ts` / `notifier.ts` と
そのテスト偽物にも実装を強制**してしまった。`publish` だけの `Publisher` を切り出して両者を
そちらに向けた。今後 pubsub にメソッドが増えても波及しない。

### ミューテーション確認

| 壊し方 | 結果 |
|---|---|
| listener 数のガードを外す | 1件赤 |
| cwd 不明のガードを外す | 1件赤 |
