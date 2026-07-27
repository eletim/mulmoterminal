# feat #908 — `--add-dir` で関連ディレクトリを渡す

複数ディレクトリを横断して AI に指示するために VS Code の `.code-workspace` ＋ Claude 拡張を
使っていたが、拡張はメモリを食う。Claude Code 自体の `--add-dir` で同じことがターミナルから
できるので、MulmoTerminal から渡せるようにする。

## CLI の形（実機で確認）

```
--add-dir <directories...>   Additional directories to allow tool access to
```

claude 2.1.220。**可変長**なので `--add-dir a b c` が正規の形。引数列の**末尾**に置けば、
後続の値を飲み込む心配がない。

## 置き場所

`<dir>/.mulmoterminal.json` の `addDirs`。`.code-workspace` に一番近く、UI を増やさない。
`provider` / `model` / `skills` が既に同じ形で入っているので枠も既存のもの。

```json
{ "addDirs": ["../shared-lib", "/abs/path/to/docs"] }
```

起動フォームでの都度指定（issue の案 B）は今回やらない。

## 相対パスの基準は「設定ファイルのあるディレクトリ」

managed worktree のセッションは cwd が `~/.mulmoterminal/worktrees/<repo>-<hash>/<task>` に
なる。設定は `.mulmoterminal.json` の側にあるので、**そのファイルのあるディレクトリを基準に
解決する**。cwd 基準にすると、worktree のときだけ別の場所を指す。

`loadDirConfig(cwd)` は cwd の設定ファイルを読むので、基準 = その cwd。worktree のセッションは
worktree 内の設定を読む（リポジトリ側の設定は worktree には無い）ため、実質どちらでも同じだが、
**基準を明文化して解決を1箇所に閉じる**。

## サンドボックスでは mount も足す

サンドボックスは cwd を**同じ絶対パスで** bind mount する（`buildDockerRunArgs` の
`-v ${cwd}:${cwd}`）。追加ディレクトリを mount しないと、フラグは付いているのにコンテナ内に
そのパスが無い —「動いているように見えて何も読めない」といういちばん気づきにくい壊れ方をする。

同じ形で `-v ${dir}:${dir}` を足す。サンドボックスの境界を広げることになるが、`addDirs` は
利用者自身が設定ファイルに書いたものなので、`--add-dir` を渡すこと自体と同じ信頼レベル。
ドキュメントにその旨を書く。

## codex には渡さない

`--add-dir` は Claude Code のフラグ。`buildCodexArgs` は触らない。設定されていても codex
セッションでは無視される（起動を壊さないことが最優先）。

## 検証

- 存在しないパスは**起動時ではなく設定読み込み時に落とす**（起動してから気づくのは遅い）
- 相対パスは cwd 基準で絶対化してから渡す（CLI にもコンテナの `-v` にも絶対パスが要る）
- 件数上限を設ける（tmux の `new-session` はコマンド長に上限があり、既にプロンプトで踏んでいる）
- cwd 自身が含まれていたら落とす（mount が重複し、意味も無い）

## resume でも毎回渡す

`buildClaudeArgs` は resume と新規で分岐している。`--add-dir` は**両方に**付ける。CLI が resume
時に記憶するかは未確認だが、毎回渡して困ることはない（同じディレクトリを二重に許可するだけ）。

## 変更するファイル

- `server/config/config-schema.ts` — `dirAddDirsField`
- `server/config/dir-config.ts` — `addDirs` の読み出し（絶対化はここで1回だけ）
- `server/agents/claude-args.ts` — 引数列の末尾に `--add-dir …`
- `server/session/spawn-claude.ts` — `loadDirConfig` の値を渡す
- `server/infra/sandbox.ts` / `server/session/pty-spawn.ts` — mount を足す
- テストとドキュメント（README の設定表、`docs/guide/{en,ja}/config.md`）
