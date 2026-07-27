# docs #893 — 導入ドキュメントに前提ツールを一通り書く

## 問題

README の「Install & run」に載っているのは Node / `claude` / `tmux` / `gh` / `codex`、
ガイドの「まずは起動」に至っては Node / `claude` / `tmux` だけ。実際にコードが叩く
ツールと一致していない。

コードが実際に spawn しているもの（`server/`, `bin/` を走査した結果）:

| ツール | 呼び出し箇所 | 効かなくなる機能 |
|---|---|---|
| `git` | `server/git/worktrees.ts:120`, `server/git/gitRemote.ts:44` ほか `server/git/` 全体 | worktree 分離、セルヘッダのブランチ / dirty / 差分、PR フッター |
| `gh` | `server/git/gh.ts:13` | PR / Issue 横断ビュー、ワンクリック PR |
| `tmux` | `server/infra/tmux.ts` | セッション永続化 |
| `codex` | `server/` 全体（Codex バックエンド） | Codex セッション |
| `docker` | `server/infra/sandbox.ts:69` ほか | Docker サンドボックス |
| `ollama` | `bin/claude-ollama.js:96` | `claude-ollama` |
| `ffmpeg` | `server/backends/mulmoscript.ts:50` | mulmoscript の動画 / beat レンダリング |

`git` と `ffmpeg` はドキュメントに一度も出てこない。`ffmpeg` を要求する
mulmoscript プラグインは `plugins/plugins.json` でデフォルト有効なので、
「デフォルトで有効な機能の前提が無記載」という状態になっている。

## 区分（ユーザ判断）

開発者向けツールなので:

- **必須** — Node ≥ 22.9, `claude`, `git`, `gh`
- **推奨** — `tmux`
- **任意（機能単位）** — `codex`, `docker`, `ollama`, `ffmpeg`

## 変更

1. **README.md**「Install & run」— 上の 3 区分の表に置き換える。各行に「何に効くか」と
   OS 別インストールコマンド（brew / apt / dnf / Windows）。
2. **`docs/guide/{en,ja}/index.md`** の「Get started / まずは起動」— 同じ表を両言語で。
   詳細は README とガイド各ページに任せ、ここは前提の一覧に絞る。
3. **`docs/index.md`**（サイトのトップ・日英併記）の Quick start — 1 行版の前提リストを
   同じ区分に更新し、ガイドの表へリンク。
4. **`bin/mulmoterminal.js`** のドクター（`npx mulmoterminal init`）— 現状 `tmux` / `gh` /
   `codex` の 3 つしか見ていないので、`git` / `docker` / `ffmpeg` / `ollama` を追加。必須の
   ものは欠けていたら `✗`、任意は `○`（既存の記法を踏襲）。表と 1:1 に対応させ、README の
   「init が表の全コマンドを見る」という記述を成立させる。

日本語見出しは kramdown の自動 ID が当てにならないので、リンク先の見出しには明示 ID を
付ける（`{#keyboard-zoom-switch}` と同じ既存の作法）: 新設の `{#cli-tools}` と、
`basics.md` の Claude/Codex 見出しへの `{#claude-and-codex}`。

## 確認

- `yarn format` / `yarn lint` / `yarn typecheck`
- `node bin/mulmoterminal.js init --dry-run` 相当でドクター出力を目視
- ガイドの内部リンクが解決すること（en / ja 両方）
