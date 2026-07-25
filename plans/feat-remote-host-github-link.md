# feat(remote-host): スマホの画面から GitHub へリンクする

Issue: #832 / スマホ側: receptron/mulmoserver#110

## やること

スマホのリモートターミナル画面が表示している dir が GitHub リポジトリなら、GitHub へ飛べる
URL を一緒に渡す。`SessionScreenMeta` に `githubUrl?: string` を足すだけで、ハンドラは無改造。

## リンク先の決定ルール（結論：常にリポジトリのトップ）

> **2026-07-26 追記 — `/tree/<branch>` は撤回した。** サーバをデプロイして実機で確認したところ、
> tree のリンクが 404 になった。原因は下の「なぜブランチリンクを諦めたか」。以下の
> upstream 判定は**すべて削除済み**で、`githubUrl` はリポジトリのトップだけを返す。
> 記録として残すのは、同じ設計を再度書き起こさないため。

当初の案：**ブランチが origin 上にあれば `/tree/<branch>`、無ければリポジトリのトップ。**

`/tree/<branch>` を無条件に使えない理由は、**GitHub に無いブランチが 404 になる**ため。managed
worktree は `agent/<slug>` を切った直後で、そのブランチはローカルにしか存在しない。

`git-status.ts` の `aheadBehind` が既に `upstream` を持っていたが private かつ ahead/behind の
カウントまで計算するので、1 git 呼び出しの述語を切り出して export した。

### 「upstream の有無」では不十分だった（レビューで発見・実測で確認）

最初の実装は `rev-parse --verify --quiet @{upstream}` で「upstream があるか」を見ていたが、
これは **origin 以外のリモートを追跡するブランチを true にしてしまう**。`resolveGithubUrl` は
`remote.origin.url` を読むので、リンクは「origin のリポジトリ + origin に無いブランチ名」に
なり 404 する — チェックが防ぐはずだった失敗そのもの。fork 運用（origin=fork / upstream=本家）や
2つ目の push 先がある構成で普通に踏む。

`rev-parse --abbrev-ref --symbolic-full-name @{upstream}` に変更し、出力が `origin/` で
始まるかを見る。**1回の git 呼び出しのまま**、以下すべてを false にできる（実測で確認）:

| ケース | 結果 |
|---|---|
| upstream 未設定 / 未 push | コマンドが非ゼロ → false |
| `other/feature/x` を追跡 | `origin/` で始まらない → false |
| 設定は残るが tracking ref が消えている | コマンドが非ゼロ → false |
| detached HEAD | コマンドが非ゼロ → false |
| `origin2` という別リモート | `origin2/...` は `origin/` で始まらない → false |

`aheadBehind` の `upstream`（どのリモートでも true）は**意図的に別の問い**なので変更しない。
ahead/behind は追跡先が何であれ意味がある。この非対称はコメントで明記した。

### なぜブランチリンクを諦めたか（実機で 404、原因を実測）

上の判定を全部通しても **404 は消えなかった**。`refs/remotes/origin/*` は **ローカルの
キャッシュ**であり、GitHub 側でブランチが消えても `git fetch --prune` するまで残るため。

そして**このアプリが作るブランチは、まさにその消え方をする** — PR をマージする時に
`--delete-branch` するので、マージ直後のセッションは「ローカルには追跡 ref があるが GitHub
には無いブランチ」の上にいる。

実測（マージ済みの `feat/remote-host-github-link` で確認）:

| 確認 | 結果 |
|---|---|
| ローカル `refs/remotes/origin/feat/remote-host-github-link` | 存在する |
| `git ls-remote --heads origin feat/remote-host-github-link` | 0 件 |
| `https://github.com/receptron/mulmoterminal/tree/feat/remote-host-github-link` | **404** |
| `https://github.com/receptron/mulmoterminal` | 200 |

**ローカルの情報だけでは「GitHub に今もあるか」は原理的に判定できない。** 唯一の局所的な解は
ポーリングのたびに `git ls-remote`（ネットワーク往復）で、スマホが繰り返し引く画面には重すぎる。
よって `/tree/<branch>` は撤回し、常にリポジトリのトップを返す。

再挑戦するなら、必要なのは upstream の判定強化ではなく **GitHub に問い合わせる手段**
（`ls-remote` のキャッシュ付き、または GitHub API）である。

## 実装

| ファイル | 変更 |
|---|---|
| `server/git/githubBranchUrl.ts`（新規） | 純粋関数。`(repoUrl, branch, branchIsOnOrigin) -> string \| null` |
| `server/git/git-status.ts` | `tracksOriginBranch(cwd)` を追加・export |
| `server/backends/remoteHost/terminalScreen.ts` | `SessionScreenMeta.githubUrl?: string` |
| `server/index.ts` | `remoteHostSessionScreenMeta` で3つの git 読みを `Promise.all` |

判断（ルール）は純粋関数に閉じ込め、I/O は呼び出し側に残す。ハンドラは既存コメントどおり
`SessionScreen` が wire shape なので触っていない。

### ブランチ名のエンコード

`agent/foo` の `/` は GitHub 上のパス区切りなので**残さなければならない**。
`encodeURIComponent("agent/foo")` は `agent%2Ffoo` になり 404 する。セグメントごとに
エンコードして `/` で繋ぐ。

### レイテンシ

`remoteHostSessionScreenMeta` は git を spawn する。今回 `resolveGithubUrl` と
`tracksOriginBranch` が増えて 1 → 3 になるので、`Promise.all` で並列化し、
**待ち時間は spawn 1回分に保つ**。
`captureSessionScreen` が screen 読みと meta 読みを既に `Promise.all` している意図を壊さない。

remote URL は dir ごとにまず変わらないので `server/git/ttl-cache.ts` でキャッシュする余地があるが、
リンクに陳腐化の窓が生まれるうえ計測もしていないので今回は入れない。

## 対象外

- **GitHub Enterprise** — `parseGithubWebUrl` は github.com 決め打ち。広げるとホスト許可リストの
  設定項目が要る（今は設定不要で動くのが利点）。別 issue。
- **grid 側** — `header-config.ts:45` に "Open on GitHub" が既にある。

## テスト

- `test/server/git/githubBranchUrl.spec.ts` — ルール8ケース（origin 上か・detached・空・
  `/` を保つ・その他のエスケープ・非 GitHub）
- `test/server/git/tracksOriginBranch.spec.ts` — **実 git**。bare リポジトリをローカルに作るので
  ネットワーク不要。未 push / push 済み / push 済みリポの新規ローカルブランチ / detached /
  **worktree（push 前後）** / **origin 以外を追跡** / **tracking ref だけ消えた状態** /
  **`origin2` という紛らわしいリモート名** / 非リポジトリ
- `terminalScreen.spec.ts` — 非 GitHub で `githubUrl` のキーごと落ちること

### ミューテーション確認（すべて赤になることを確認済み）

1. origin ガードを外す → 1件赤
2. ブランチ名全体を `encodeURIComponent` → 2件赤
3. `tracksOriginBranch` を常に `true` → 5件赤
4. `tracksOriginBranch` をレビュー前の「upstream があるか」に戻す → 2件赤
