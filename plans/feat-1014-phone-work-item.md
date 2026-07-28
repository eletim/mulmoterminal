# スマホのセッション一覧に issue / PR を載せる（ホスト側）

Issue: #1014（表示側は receptron/mulmoserver の別 issue）

## いまある土台

- `phaseForRepoBranch()`（`server/git/prPhase.ts`）が cwd + ブランチ → PR 番号 / フェーズ / issue 番号
  を解決。`(repo, branch)` の 30 秒 TTL キャッシュつき
- `remoteHostListTerminalSessions()`（`server/index.ts:401`）がスマホへ 1 セッションずつ
  `title` / `cwd` / `agent` / `live` を返している

足りないのは **タイトル**と、一覧への同梱だけ。

## 変更

1. **`WorkItem` にタイトルを 2 つ足す** — `prTitle` / `issueTitle`（common/prPhase.ts）。
   - PR タイトルは `gh pr list --json` に `title` を足すだけ（追加の gh 呼び出しなし）
   - issue タイトルは `gh issue view --json number,title` から。**ブランチ由来の存在確認と同じ呼び出しに
     フィールドを足す**ので、そこは増えない。PR 本文の `Fixes #N` 由来のときだけ 1 回増える
2. **一覧に載せる** — `TerminalSessionSummary` に `work?: WorkItemSummary` を足す。
   `{ pr, issue, phase, title }`。**`title` は issue のタイトルがあればそれ、無ければ PR のタイトル**。
   スマホで見たいのは「どの依頼に対応中か」なので、目的が書いてある側を優先する。
3. `detailOf` は同期なので、work item は**一覧を組む前に cwd 単位でまとめて解決**して渡す。
   セル 20 枚でも repo/branch が同じなら 1 回で済む（キャッシュ）。

## 決めたこと

- **スマホ側の表示は作らない。** 行に何を出して何を畳むかは実機の幅を見て決めるべきで、
  それは mulmoserver の issue に分ける。ここはデータを送るところまで。
- **プライバシーの追加論点は無い。** 一覧は既に `cwd`（フルパス）とセッションタイトルを送っている。
  issue / PR のタイトルは同じ機微度。

## テスト

- タイトルの選択: issue タイトルがあればそれ / 無ければ PR タイトル / どちらも無ければ undefined
- `gh` の呼び出し回数: PR 本文から issue が解決したときに issue タイトルの取得が 1 回増えること、
  ブランチ由来のときは**存在確認と同じ 1 回で済む**こと
- 一覧: work item を持たないセッション（repo でない cwd）は `work` を持たない
- 既存の一覧の形（title / cwd / agent / live と並び順）が変わらないこと
