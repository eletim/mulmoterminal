# feat — PR 本文の末尾に作業クローン名を書く (#872 提案A)

PR から「どのターミナル（どのクローン）の作業か」を辿れるようにする。`mulmoclaude`,
`mulmoclaude2`, `mulmoclaude3` … と suffix 付きのクローンを並べて使っているので、PR 本文の
末尾に `work in mulmoclaude3` の 1 行があれば足りる。

#872 の提案B（mulmoterminal 側の PR 一覧で branch からセッションを解決する）は今回やらない。

## 決定事項

| 項目 | 決定 |
|---|---|
| 既定 | **ON** |
| opt out | `~/.mulmoterminal/config.json` の `prWorkdirFooter: false` |
| 文言 | `work in <クローン名>` |
| 対象 | mulmoterminal が**新規作成した** PR のみ |

既定 ON は「入れておきたい」という要望そのままの挙動。切りたい人だけが 1 行書く。

## 名前をどこから取るか

`worktrees.ts` の `repoRoot()` が `git worktree list --porcelain` の**先頭エントリ**を返す。
これは main の作業ツリーなので、managed worktree
(`~/.mulmoterminal/worktrees/<repo>-<hash>/<task>`) の中から呼んでも `mulmoclaude3` 側の
パスが返る。`createOrOpenPR` は既にこれを呼んでいるので、`path.basename()` するだけでよい。

worktree 名（= branch 名）は書かない。branch は PR 自体が持っているので冗長。

## `--fill` を壊さずに追記する

現在は `gh pr create --base <base> --head <branch> --fill` でタイトルと本文をコミットから
生成している。ここに `--body` を足すと **fill の内容を上書きする**（`gh pr create --help` が
明記）。したがって

1. 従来どおり `--fill` で作成する
2. `gh pr view <url> --json body --jq .body` で生成された本文を読む
3. `gh pr edit <url> --body <本文 + footer>` で差し替える

の順にする。**2 か 3 が失敗しても PR 作成は成功として返す** — footer は付加情報であって、
ここで失敗を伝播させると「PR は出来ているのにエラーが返る」という最悪の報告になる。

## 追記しないケース

- **既存 PR を開いたとき**（`gh pr list --head` の経路）。ボタンを押し直すたびに footer が
  増えるのを防ぐ。追記は新規作成の直後だけ
- **compare URL のフォールバック**。PR がまだ存在しない
- `prWorkdirFooter: false` のとき

さらに `withFooter()` 自体を冪等にする（同じ footer 行が既に本文にあれば何もしない）。上の
経路分けと二重になるが、片方が将来変わっても本文が壊れないため。

## 変更するファイル

- `server/git/pr-footer.ts`（新規・純粋関数）— `workdirFooter()` と `withFooter()`
- `server/git/worktree-pr.ts` — 作成成功後に追記
- `server/config/app-config.ts` — `prWorkdirFooter` を追加。`emptyConfig` / `sanitizeAppConfig` /
  更新経路 / **`toPublicAppConfig`** の 4 箇所。`toPublicAppConfig` は `saveAppConfig` が書き出す
  形そのものなので、ここに入れ忘れると**設定画面から何かを保存した瞬間にキーが消える**
- `server/config/config-routes.ts` — `getPrWorkdirFooter()`
- `test/server/git/pr-footer.spec.ts`（新規）、`test/server/config/app-config.spec.ts` に既定 ON と
  opt out のケース
- `README.md` の設定表、`docs/guide/{en,ja}/config.md`

## 実装中に足したもの

- `run()` を `Runner` 型にして `appendWorkdirFooter` の引数（既定は `run`）にした。gh を叩く
  部分をテストから駆動できるようにするため。「読めなかった／書けなかったときに throw しない」
  という一番大事な性質は、これがないと固定できない
- 本文が変わらないとき（既に footer がある）は `gh pr edit` を呼ばない。`withFooter` は
  変更不要なら入力をそのまま返すので、`body === viewed.stdout` が正確な判定になる
- `mergeConfigUpdate` の 15 個の三項演算子を `updated()` ヘルパーに寄せた。キーを 1 個足した
  ことで cognitive-complexity の lint 上限を超えたため（結果として重複も消えた）

## 既定 ON の sanitize

既存の boolean キーは `input === true`（既定 OFF）。今回は逆で、**`false` が明示されたときだけ
無効**にする必要があるため `input !== false` を使う。`emptyConfig()` の初期値も `true` にする。
