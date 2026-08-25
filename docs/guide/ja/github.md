---
title: GitHub / GitLab の PR リンク
layout: default
parent: 日本語
nav_order: 9
description: Terminal Session の現在ブランチに紐づく Pull Request / Merge Request を開く仕組み。
---

# GitHub / GitLab の PR リンク
{: .no_toc }

- TOC
{:toc}

MulmoTerminal には横断的な PR / Issue ダッシュボードはありません。PR 連携は
Terminal Session 単位です。セルは、その Session が作業している現在ブランチの PR / MR を
表示・オープンできます。

## 残っているもの

- worktree / session ヘッダーから、現在ブランチの PR / MR を開く
- cockpit roster に PR phase を表示する: draft、CI failing、changes requested、ready、
  merged、closed、none
- worktree セルから push して PR / MR を作成・オープンする Git 操作
- `issueWorkComments` が有効な場合の Session / worktree に紐づく issue コメント

`/prs` route、ツールバーの Pull requests 一覧、集約用の `prRepos` / `repoDirs` 設定はありません。

## GitHub

GitHub 連携は、ホスト側でログイン済みの `gh` CLI を使います。セル自身の `origin` から
repository を解決し、その Session の現在ブランチについて `gh` に問い合わせます。

## GitLab

`gitlab.com` と、宣言済みの自前 GitLab ホストでは、同じ Session 単位の操作に `glab` を使います。

自前 GitLab の場合は `~/.mulmoterminal/config.json` にホストを宣言し、サーバを再起動します。

```json
{
  "gitlabHosts": ["gitlab.example.com"]
}
```

そのうえでログインしてください。

```sh
glab auth login --hostname gitlab.example.com
```

この宣言は、remote がどの forge かを MulmoTerminal に伝えるためのものです。横断PR一覧を
作る設定ではありません。
