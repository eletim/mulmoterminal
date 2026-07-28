# Separate "what a remote URL says" from "is it GitHub"

Part of #981.

## Why

The survey in #981 found that the git-only features (worktrees, diff, status, the `work in <clone>`
footer) are already host-neutral, and only the ones that call a host's API are GitHub-specific. One
thing sat on the wrong side of that line: **the remote-URL parser itself**.

`parseGithubWebUrl` did two jobs in one function — decode the URL forms git accepts (scp-like SSH,
`ssh://` with a port, `https://` with credentials, `git://`), and apply GitHub's rules (the host,
and that a project is `owner/repo`). The first is a property of **git**, and every forge uses the
same forms. Left as it was, adding a host later means either a second copy of that parsing or a
rewrite of a function twelve tests already pin.

The same line was crossed a second way in `repoFromWebUrl`, which recovered `owner/repo` by
splitting the string on `"github.com/"` — the host name doing work that has nothing to do with it.

## What

`server/git/remote-ref.ts` — `parseRemoteRef(url) → { host, path } | null`, plus `topSegments` for
"how many segments identify a project". No opinion about which host.

`parseGithubWebUrl` is now the two GitHub rules on top of it, and `repoFromWebUrl` parses instead
of string-splitting.

**Behaviour is unchanged, deliberately.** `repoFromWebUrl` still returns null for a non-GitHub URL,
which an existing test pins — `${repo}` is interpolated into `https://github.com/${repo}` by the
default header button, so a path from another host would build a link to the wrong site. Widening
that belongs to the forge work in #981, not to moving the parsing.

`path` is kept whole rather than split into owner/repo, because GitLab nests groups
(`group/subgroup/project`) and how many segments identify a project is the host's rule.

## Tests

`remote-ref.spec.ts` states every URL form against a **non-GitHub host as well**, which is the
property that makes this worth extracting: a future host should need a rule about `host`, not a
second parser. Also nested groups, host case-folding, normalisation (whitespace, trailing and
repeated slashes, `.GIT`), single-segment paths, and the null cases — including `file://`, which is
a real local remote with no host to attribute.

One case was wrong on the first pass: `https:///owner/repo` was expected to be null, but the URL
parser absorbs the extra slash and reads `owner` as the host. That is not a remote anyone has, so
it was replaced with `file://`, which is.
