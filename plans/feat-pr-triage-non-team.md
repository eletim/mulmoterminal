# feat — 開発チーム外からの PR を自動でコメント＋クローズする (#867)

mulmoclaude と同じ「外部からの pull request は受け付けない、issue でプランを合意する」方針を
mulmoterminal にも導入する。方針を `CONTRIBUTING.md` に明文化し、`pull_request_target` の
ワークフローで機械的に運用する。

## 決定事項

| 項目 | 決定 | mulmoclaude との差 |
|---|---|---|
| 許可リスト | `isamu` / `snakajima` / `ystknsh` ＋ `dependabot[bot]` / `coderabbitai[bot]` / `sourcery-ai[bot]` | `yuki0627` は mulmoterminal に PR 実績がないので入れない |
| 行数の例外 | **なし**。規模によらず全部クローズ | mulmoclaude は 10 行以下を通す |
| 方針の置き場所 | ルートの `CONTRIBUTING.md`（日英併記） | mulmoclaude は `docs/developer.md` の一節 |
| 対象ブランチ | 制限しない | mulmoclaude は `branches: [main]` |

許可リストは receptron org のメンバー（= このリポジトリの collaborator）そのもの。

`CONTRIBUTING.md` をルートに置くのは、GitHub が PR / issue の作成画面でこのファイルへの導線を
自動的に出すため。PR を書き始める前に読まれる可能性が一番高い場所になる。docs/ は Jekyll の
ユーザーガイド用サイトで、対象読者が違う。

対象ブランチを絞らないのは、`dev_tool` など main 以外の長命ブランチ宛の PR も同じくレビュー
不能だから。mulmoclaude は `branches: [main]` に絞っている都合で「別ブランチ宛で開いて後から
main に付け替える」抜け道があり、それを `edited` で塞いでいる。最初から絞らなければその穴自体が
生じない。

## 実装

### `.github/workflows/pr_triage.yaml`

`pull_request_target` / `types: [opened, reopened, edited]`。permissions は `contents: read`,
`issues: write`, `pull-requests: write`。

`pull_request` ではなく `pull_request_target` を使う理由は、fork からの PR では
`pull_request` の `GITHUB_TOKEN` が read-only になり、コメントもクローズもできないため。
PR のコードを `actions/checkout` しないので、`pull_request_target` の典型的な危険（攻撃者の
コードが昇格した権限で走る）は成立しない。PR 由来の値（作者ログイン、PR 番号）はすべて `env:`
経由で渡し、シェル本体では `${VAR}` として参照する。スクリプト本文への `${{ }}` 展開はしない。

処理:

1. 作者が許可リストに一致（`grep -Fxq` = 完全一致、`[bot]` を正規表現として解釈させない）→ 何もしない
2. `gh pr view --json state` で **live の状態**を取得。OPEN でなければ終了
3. 既存コメントに triage マーカー（`<!-- mulmoterminal-pr-triage -->`）があれば、コメントせず
   クローズだけして終了
4. それ以外 → 日英併記のテンプレートコメントを投稿してクローズ

### 二重コメントを防ぐ 2 段のガード

`gh pr comment` は冪等ではない。mulmoclaude #1869 では、クローズ直後に届いた `synchronize` と、
CodeRabbit のタイトル編集による `edited` が同じワークフローを再実行し、90 秒間に同一のクローズ
コメントが 3 通投稿された。mulmoclaude はイベントペイロードの `state == 'open'` でガードして
いるが、ペイロードの state は**イベント生成時点**のもので、クローズ直前に生成されたイベントには
まだ `open` が入っている。

ここでは:

- **live state** を API から取り直す（ペイロードを信用しない）
- コメント本文に埋め込んだ**マーカー**を検索する（イベントの順序に依存しない）

の 2 段にする。

マーカーの検索は、`gh api | grep -qF` のパイプではなく、いったん変数に受けてから
`grep -qF <<< "$COMMENTS"` で照合する。パイプ版は**動いているように見えて壊れている**:
`grep -q` は最初の一致で即座に終了するので、まだ書き込み中の `gh`（Go バイナリ）が SIGPIPE で
死んで 141 を返す。`pipefail` がそれをパイプライン全体の終了ステータスとして伝播し、`if` は
「マーカーなし」と読む——つまり、このガードが防ぐはずの二重コメントを、このガード自身が
引き起こす。コメントが少ないうちは `gh` が先に書き終わるので再現せず、スレッドが伸びてから
初めて壊れる。

reopen されたケース（state は OPEN、コメントは既にある）は、**誰が reopen したか**で分ける。
メンテナが開け直したなら、それはこのワークフローを意図的に上書きしているので何もしない
（そうしないと、以降のタイトル編集のたびに閉じ直してしまい、メンテナが外部 PR を引き取れない）。
それ以外なら close をやり直す。判定には `github.event.sender.login` を使う。

### コメント本文の組み立て

クォートした heredoc (`<<'EOF'`) に入れる。シェルの展開が一切走らないので、本文中のバック
クォートや `$` が evaluate されない。唯一必要な変数（`DOC_LINK`）は、本文中の `__DOC_LINK__` を
bash のパラメータ展開 `${BODY//__DOC_LINK__/${DOC_LINK}}` で置換して埋める。`$(...)` を使わない
ので注入経路がない。

## 検証

ワークフローを実際に発火させて確かめることはできない（このワークフローは main に載るまで
dispatch できないし、外部アカウントの PR も用意できない）。代わりに、YAML から `run:` の
スクリプトを取り出し、`gh` をスタブに差し替えて 5 経路をローカルで実行した:

| 経路 | 期待 | 結果 |
|---|---|---|
| 許可リストの作者 | 何もせず exit 0 | pass through |
| 外部の作者・PR は OPEN・コメントなし | コメント＋クローズ | 本文が正しく生成され close が呼ばれた |
| 外部の作者・PR は既に CLOSED | 何もしない | `already CLOSED` |
| 外部の作者・マーカー既存・作者が reopen | コメントせずクローズ | `already triaged` → close のみ |
| 外部の作者・マーカー既存・メンテナが reopen | 何もしない | `standing down` |

`grep -Fxq` の部分一致も確認（`isamux` と `i` はどちらも許可されない）。

### 検証環境の落とし穴

最初この検証を**手元の zsh で**回して「パイプ版でも問題なし」という結果を得ていた。GitHub
Actions の `run:` は **bash** で実行される。zsh は SIGPIPE と `pipefail` の扱いが違うため、
上記の 141 が再現せず、テストが嘘をついた。スタブ側にも同じ罠がある: `gh` の代わりが bash
スクリプトだと、組み込みの `echo` は EPIPE でエラーを返すだけで死なないので、やはり再現しない。
外部コマンド（`seq`）に書かせて初めて再現する。**`run:` の中身をローカルで検証するときは
明示的に `bash` で実行し、外部プロセスの挙動が問題になるならスタブも外部コマンドで書く。**

## 効果範囲

ワークフローは新規イベントにしか反応しないので、**現在オープン中の外部 PR（#861 / #862 / #863）は
自動クローズされない**。従来どおり手動で扱う。
