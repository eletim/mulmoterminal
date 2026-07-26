# Contributing to MulmoTerminal

**日本語は[こちら](#コントリビュートについて日本語)。**

Thanks for your interest in MulmoTerminal. Please read this before sending a pull request.

## Please open an issue with a plan — we don't take outside pull requests

**We do not accept pull requests from outside the development team, regardless of size.**
Unsolicited ones are commented on and closed automatically. **Issues are a different story —
bug reports and feature requests are always welcome, and they are the way to get a change in.**

The flow we ask for:

1. **Open a GitHub issue** describing the problem and a proposed plan. A few paragraphs are
   enough: what's wrong (or what's missing), the approach you have in mind, the files you
   expect to touch, and any open questions. The files under [`plans/`](plans/) show the level
   of detail we work at.
2. **Discuss the plan in the issue thread.** We may suggest scope adjustments, point out
   existing helpers or in-flight refactors that overlap, or surface constraints that are hard
   to see from outside — security boundaries, the tmux persistence model, Windows behaviour.
   This is usually a short back-and-forth.
3. **A maintainer writes the pull request.** Once the plan is agreed, one of us turns it into
   a PR. You're welcome to follow the work, comment on the implementation, and flag anything
   that diverges from the agreed plan.

### How to write the issue

Maintainer review time is the bottleneck. These rules keep that time productive:

- **Put a summary in the first three lines.** A maintainer decides whether to engage from
  those lines alone. Save the longer rationale for the rest of the body.
- **One issue covers exactly one topic.** Two unrelated proposals means two issues. A combined
  issue is hard to scope and tends to stall on whichever half is harder.
- **Keep it short.** Long issues don't get read carefully. If your draft doesn't fit on two
  screens, it's probably two issues.
- **Be specific.** Instead of "the grid is slow", write "the cell header re-renders on every
  PTY chunk in `src/components/…`". Instead of "fix the config", name the key.
- **Spell things out.** Avoid project-internal abbreviations that don't already appear in the
  [README](README.md) or the [user guide](https://receptron.github.io/mulmoterminal/).

For **bug reports**, include your OS, the MulmoTerminal version, the browser, and the exact
steps that reproduce it. Mask anything from your environment you wouldn't post publicly —
paths, repository names, tokens.

### Why we don't take outside pull requests

AI coding assistants make it easy to generate a large, polished-looking diff in minutes. The
catch is that reviewing such a pull request cold takes far longer than writing it, and even
when the code reads cleanly, verifying that no subtle behavioural, security, or data-handling
regression slipped in is genuinely hard for a reviewer who didn't help shape the design.
MulmoTerminal runs coding agents against a user's real machine and repositories; we can't
responsibly merge code we can't fully audit.

This isn't about screening out AI-assisted work — the maintainer who writes the PR is usually
using an agent too. The point is that **the plan is what we agree on, and the resulting code is
owned by whoever lands it**. Fixing that ownership boundary at the plan keeps responsibility
clear and review focused on the parts that need human judgement.

### Automated triage

[`.github/workflows/pr_triage.yaml`](.github/workflows/pr_triage.yaml) enforces the rule
mechanically on every pull request:

- PRs from maintainers and allowlisted bots pass through untouched. The current allowlist is
  `isamu`, `snakajima`, `ystknsh`, `dependabot[bot]`, `coderabbitai[bot]`, `sourcery-ai[bot]`.
- Every other PR gets a comment linking back to this document and is closed. There is no
  small-diff exemption.

Adding a maintainer means editing the `MAINTAINERS` list in the workflow **and** the bullet
above, in the same commit.

---

## コントリビュートについて（日本語）

MulmoTerminal に興味を持っていただきありがとうございます。pull request を送る前に、この文書を読んでください。

## まず issue でプランを — 開発チーム外からの pull request はお受けしていません

**開発チーム外からの pull request は、規模によらずお受けしていません。**
送られてきた場合は自動的にコメントを付けてクローズされます。**一方で issue は歓迎です** — バグ報告も
機能要望も、変更を取り込む唯一の入口が issue です。

お願いしている流れ:

1. **GitHub issue を立てて**、問題と実装プランを説明してください。数段落で十分です: 何が壊れている（何が
   足りない）のか、どういう方針で直すのか、どのファイルを触ることになりそうか、未決の論点は何か。
   粒度の参考として [`plans/`](plans/) 以下のファイルを見てください。
2. **issue のスレッドでプランを議論します。** スコープの調整、再利用できる既存のヘルパー、進行中の
   リファクタとの重複、外からは見えにくい制約（セキュリティ境界、tmux 永続化の設計、Windows での挙動）
   などをこちらから提示します。たいていは短いやり取りで終わります。
3. **合意できたら、メンテナが pull request を書きます。** 実装を追いかけてコメントするのは歓迎ですし、
   合意したプランから外れている点があれば指摘してください。

### issue の書き方

ボトルネックはメンテナのレビュー時間です。次のルールがその時間を有効にします。

- **最初の 3 行を要約にしてください。** メンテナはその 3 行だけで着手するかを判断します。詳しい背景は
  その後ろに書いてください。
- **1 つの issue につき 1 つの話題。** 無関係な提案が 2 つあるなら issue も 2 つに。混ざっているとスコープを
  切れず、難しい方に引きずられて止まります。
- **短く。** 長い issue は丁寧に読まれません。2 画面に収まらないなら、たぶん 2 つの issue です。
- **具体的に。** 「グリッドが重い」ではなく「PTY のチャンクごとにセルヘッダが再描画される（`src/components/…`）」。
  「設定がおかしい」ではなく、該当するキー名を書いてください。
- **省略語を使わない。** [README](README.md) や[ユーザーガイド](https://receptron.github.io/mulmoterminal/guide/ja/)に
  出てこない内部用語は避けてください。

**バグ報告**には、OS・MulmoTerminal のバージョン・ブラウザ・再現手順を含めてください。パス、リポジトリ名、
トークンなど、公開したくない環境情報はマスクしてください。

### なぜ外部からの pull request を受け付けないのか

AI コーディングアシスタントのおかげで、大きく整って見える diff を数分で作れるようになりました。問題は、
設計に関わっていない人間がそれを cold でレビューすると、書くよりも遥かに時間がかかることです。コードが
きれいに読めても、挙動・セキュリティ・データの取り扱いに微妙なリグレッションが混じっていないことを
確かめるのは本当に難しい。MulmoTerminal はユーザーの実機とリポジトリに対してコーディングエージェントを
走らせるソフトウェアです。完全に監査しきれないコードを責任を持ってマージすることはできません。

これは AI 支援の成果物を排除するためのルールではありません — PR を書くメンテナ自身もエージェントを
使っています。ポイントは、**合意するのはプランであり、出来上がったコードはそれを着地させた人が持つ**という
ことです。所有権の境界をプランの時点で引いておくと、責任の所在がはっきりし、レビューは人間の判断が
必要な部分に集中できます。

### 自動トリアージ

[`.github/workflows/pr_triage.yaml`](.github/workflows/pr_triage.yaml) が、このルールを機械的に適用します。

- メンテナと許可された bot からの PR はそのまま通ります。現在の許可リストは `isamu`, `snakajima`,
  `ystknsh`, `dependabot[bot]`, `coderabbitai[bot]`, `sourcery-ai[bot]`。
- それ以外の PR には、この文書へのリンク付きコメントが投稿され、クローズされます。行数による例外は
  ありません。

メンテナを追加するときは、ワークフローの `MAINTAINERS` と上の箇条書きを**同じコミットで**更新してください。
