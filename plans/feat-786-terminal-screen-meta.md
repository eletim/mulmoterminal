# feat: getTerminalScreen に cwd / branch / summary / prompt を足す (#786)

受け側は mulmoserver#107（スマホの個別セッション画面）。画面の上に「どのディレクトリの・どの
ブランチで・何をやっている・直前のプロンプト」を出したいが、`getTerminalScreen` の応答が
`{ screen, suggestion }` だけなので出せない。

## 変更

### 1. ワイヤ型（`server/backends/remoteHost/terminalScreen.ts`）

```ts
export interface SessionScreenMeta {
  cwd?: string;
  branch?: string;
  summary?: string; // aiTitle
  prompt?: string;  // lastPrompt
}
export interface SessionScreen extends SessionScreenMeta {
  screen: string;
  suggestion: string;
}
```

すべて optional ＝ 後方互換。**値が無いキーは `undefined` を入れず落とす**（`definedScreenMeta`）:

- 応答は Firestore の command ドキュメントに書かれる。`undefined` を含むオブジェクトは
  Firestore が拒否するので、「無い」は「キーごと無い」で表す。
- 受け側もラベル付きの行をフィールド単位で出すので、空文字だと「ブランチが無い」ではなく
  「ラベルだけの空行」に見えてしまう。

### 2. 依存の注入

`CaptureScreenDeps` に optional な `metaOf(id)` を追加。terminalScreen.ts は PTY もタイトル表も
知らないままで、実際の読み出しは server/index.ts（テーブルがある場所）が渡す。

- **画面取得と並行**に実行（`Promise.all`）。branch は git を叩くので直列だと素で遅くなる。
- **metaOf が失敗しても画面は返す**。メタは画面の装飾で、git の失敗や消えた dir で
  ターミナル表示ごと落とすのは割に合わない。

### 3. 値の出どころ（`server/index.ts`）

`listTerminalSessions` の `detailOf` と同じテーブルを読む:

| フィールド | 出どころ |
| --- | --- |
| cwd | `ptys.get(id)?.cwd` |
| branch | `currentBranch(cwd)`（`server/git/git-status.ts` から export） |
| summary | `aiTitles.get(id)` |
| prompt | `lastPrompts.get(id)` |

branch は `gitStatus()` 全部（git 4 プロセス）ではなく `currentBranch()` だけを使う
（symbolic-ref 1 回、detached でも失敗しない）。dirty / ahead / behind はスマホ個別画面では
使わないので取らない。再起動をまたいだ tmux-only セッションは `ptys` に無く cwd が空 →
git も呼ばず、4 フィールドとも落ちる。

## テスト

`test/server/backends/remoteHost/terminalScreen.spec.ts` に追加:

- `definedScreenMeta`: 空文字 / 空白のみ / undefined を落とす、前後の空白は値としては保つ、
  空オブジェクト。
- `captureSessionScreen`: metaOf の 4 値が応答に載る／空の値はキーごと落ちる／
  `metaOf` 未指定なら `{ screen, suggestion }` のまま（後方互換）／`metaOf` が throw しても
  画面は返る。
