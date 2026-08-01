# feat(#1184): スマホから issue 起点で作業を始める（ホスト側 API まで）

#1026 の段階4のうち「スマホ」の入口。表示は別レポ（`receptron/mulmoserver`）で、
ここは **ホストが答えるコマンドを用意するところまで**（#1014 と同じ切り方）。

## 前提はもう揃っている

issue 本文が「これを呼べばよい」と書いていたものは、#1171 / #1172 / #1173 で 3.x に入っている。

| 部品 | 場所 |
| --- | --- |
| `startIssueWork(repo, issue, dir, deps)` | `server/git/issue-work.ts` |
| デスクトップの `POST /api/issues/start`（`dir` を検証して spawn） | `server/routes/issue-work-routes.ts` |
| repo → クローン候補 ＋ 記録された primary | `server/git/repo-dirs.ts` |
| 開始可否の判定（`no-clone` / `ready` / `choose`） | `src/composables/issueStartPlan.ts` |

残るのは **コマンド2本と、dir をどう決めるか** だけ。

## 決めたこと

### 1. `dir` は受け取らない。記録された primary を使い、無ければ始めない

プロトコルの規則（`docs/remote-host-protocol.md`）:

> The phone never sends a path. **Apply this to anything new that touches the filesystem.**

なので `startIssueWork` コマンドの引数は `repo` と `issue` だけ。作業ディレクトリは
`repoDirsFromPresets()` が返す `primary`。**クローンが1つだけならその1つで始める**
（記録が無くても答えは1つしかない）。複数あって未記録のときは **始めずに拒否**する。

拒否は throw する — プロトコルの「A handler that throws turns into the phone's error message.
That is the intended way to refuse — the phone shows the sentence, so write it for a person.」に従う。

候補一覧を返してスマホに選ばせる案は採らない。エージェントがどのツリーで走り出すかは
取り消しの効かない決定で、スマホには「どのクローンに落ちたか」を見る手段が無い。

### 2. 判定は `issueStartPlan()` を両ホストで共有する（`common/` へ移す）

同じ「このリポで作業を始められるか」を、デスクトップの行ボタンとスマホの2箇所が決める。
CLAUDE.md の「両方が決めるものは `common/`」に従い `src/composables/issueStartPlan.ts` を
`common/issueStartPlan.ts` へ移動する。ロジックを2つ持って「同期を保つ」形にはしない。

### 3. `listIssues` は「開始できるか」まで答える

`{ repos: RepoIssues[] }` の各行に `canStart: boolean` と、false のときだけ `startBlocked: string`。
プロトコルの「The host decides; the phone renders」と、`githubUrl` と同じ「あれば描く」規則に合わせる。
これが無いと、スマホはタップして初めて拒否を知ることになる。

### 4. グリッドへの現れ方は既存の unplaced 経路に乗る（新規の仕組みは要らない）

issue が「決めたいこと」に挙げていた点は、issue が書かれた後に入った #1189 / #1204 が答えている。
`markUnplacedSession()`（`server/session/registry.ts`）のコメントは *"an agent calling
spawnBackgroundChat, a scheduled task, **or the phone**"* とスマホを名指ししており、
`GridView.vue` は `sessions` の `created` push でも掃引する。つまり:

- デスクトップのタブが開いていれば **その場でセルが生える**
- 開いていなければ、**次にグリッドを開いたときに拾われる**

`launchTerminal` の「タブが開いていないと失敗する」制約には当たらない。spawn 自体はブラウザ無しでできる。

## 変更するファイル

1. `common/issueStartPlan.ts` — `src/composables/` から移動（importer 2つとテストのパスを追従）
2. `server/backends/remoteHost/handlers/issueWork.ts` — 新規。`listIssues` / `startIssueWork`
3. `server/backends/remoteHost/handlers/deps.ts` — `spawnIssueDraft` を追加
4. `server/backends/remoteHost/handlers/index.ts` — テーブルに登録
5. `server/index.ts` — `spawnIssueDraft` を配線（spawn ＋ `markUnplacedSession`）
6. `docs/remote-host-protocol.md` — コマンド表 ＋ 「dir を受け取らない」理由 ＋ 現れ方
7. spec — `server/backends/remoteHost/issueWork.spec.ts`、`handlers.spec.ts` の deps 追従

## テストで固定すること

- **`dir` を渡しても無視して記録されたクローンで始める** — これがプロトコル規則そのもの
- 複数クローン ＋ 未記録 → **spawn せずに** 拒否。文にデスクトップで選ぶことが書いてある
- クローン無し → 拒否
- クローン1つ ＋ 未記録 → 始まる
- `listIssues` の `canStart` / `startBlocked` が上の3状態と一致する
- 不正な `repo` / `issue` は spawn せずに拒否

## やらないこと

- **スマホ側の UI** — `receptron/mulmoserver`。ここはデータと操作を届けるまで（#1014 と同じ）
- **クローン選択の対話をスマホに持ち込むこと** — 上の決定1
- **同じ issue で2つ目の worktree を防ぐこと** — 現状は連番で別ブランチができる。#1207 の
  「1 worktree 1 セッション」とは別の話で、必要なら別 issue
