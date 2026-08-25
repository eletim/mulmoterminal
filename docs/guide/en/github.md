---
title: GitHub and GitLab PR links
layout: default
parent: English
nav_order: 9
description: How MulmoTerminal links a terminal session to the pull request or merge request for its current branch.
---

# GitHub and GitLab PR links
{: .no_toc }

- TOC
{:toc}

MulmoTerminal no longer has a cross-repository PRs & Issues dashboard. Pull request integration is
session-scoped: a terminal cell can show and open the PR or MR for the branch that session is
working on.

## What Remains

- A worktree/session header can open the PR or MR for its current branch.
- The cockpit roster can show the branch's PR phase: draft, CI failing, changes requested, ready,
  merged, closed, or none.
- Git actions from a worktree cell can still push and open/create a PR or MR.
- Issue-work comments remain tied to the session/worktree when that option is enabled.

There is no `/prs` route, no toolbar-wide Pull requests view, and no `prRepos` or `repoDirs`
configuration for aggregating repositories.

## GitHub

GitHub support uses the `gh` CLI already logged in on the host. A cell resolves its own repository
from `origin`, then asks `gh` about the current branch.

## GitLab

`gitlab.com` repositories and declared self-hosted GitLab hosts use `glab` for the same
session-scoped operations.

For a self-hosted GitLab, declare the host in `~/.mulmoterminal/config.json` and restart the
server:

```json
{
  "gitlabHosts": ["gitlab.example.com"]
}
```

Then log in with:

```sh
glab auth login --hostname gitlab.example.com
```

The declaration only tells MulmoTerminal which forge a remote belongs to. It does not create a
cross-repository dashboard.
