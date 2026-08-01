// Which FORGE a git remote points at — the layer between "what the URL says" (remote-ref.ts, pure
// git) and "what we can do with it" (the gh-backed features). #981 step 1.
//
// It exists because `parseGithubWebUrl` answers one question with `string | null`, which collapses
// two very different situations into the same value: "this is a GitLab repo" and "this directory
// has no origin at all". Every feature downstream reads that null as "no GitHub here" and removes
// itself, so a GitLab user gets silence rather than an explanation — and the surface doing that
// keeps growing (three more `gh` call sites arrived after #981 was written).
//
// Nothing here decides what to SHOW. Splitting the question from the answer is the point: the
// showing is a separate decision, and one this repo has not made yet.
import { parseRemoteRef, topSegments } from "./remote-ref.js";

export type ForgeKind = "github" | "gitlab" | "unknown";

export interface RemoteForge {
  /** Lower-cased hostname the remote points at. */
  host: string;
  kind: ForgeKind;
  /** The repository path, whole. How many segments name a project is the host's rule, not git's. */
  path: string;
  /** The repository's web page, or null when the kind is not one we know how to address. */
  webUrl: string | null;
}

export const GITHUB_HOST = "github.com";
const GITLAB_HOST = "gitlab.com";

// Only the hosts we can name from the URL alone. A self-hosted GitLab at `git.example.com` is
// indistinguishable from anything else here and comes out `unknown` — declaring those needs config,
// which belongs with the GitLab implementation that would read it rather than ahead of it.
const KNOWN_HOSTS: Readonly<Record<string, ForgeKind>> = { [GITHUB_HOST]: "github", [GITLAB_HOST]: "gitlab" };

// GitHub: a project is exactly `owner/repo`, so a deeper path is truncated to it.
const GITHUB_PATH_SEGMENTS = 2;

// GitLab nests groups (`group/subgroup/project`), so the whole path names the project and there is
// no segment count to apply.
function webUrlFor(kind: ForgeKind, host: string, path: string): string | null {
  if (kind === "github") {
    const repo = topSegments(path, GITHUB_PATH_SEGMENTS);
    return repo ? `https://${host}/${repo}` : null;
  }
  if (kind === "gitlab") return `https://${host}/${path}`;
  return null;
}

/** What forge a remote URL points at, or null when it is not a remote URL we can read at all. */
export function forgeOf(remoteUrl: string): RemoteForge | null {
  const ref = parseRemoteRef(remoteUrl);
  if (!ref) return null;
  return forgeAt(ref.host, ref.path);
}

const forgeAt = (host: string, path: string): RemoteForge => {
  const kind = KNOWN_HOSTS[host] ?? "unknown";
  return { host, kind, path, webUrl: webUrlFor(kind, host, path) };
};

// A `prRepos` entry names a repository directly rather than as a URL, and the host is optional:
// `owner/repo` is GitHub (which is what every existing config holds) and `gitlab.com/group/project`
// says otherwise. A leading segment containing a DOT is the host — GitHub user and organisation
// names may only hold alphanumerics and hyphens, so the two forms cannot be confused.
const HOST_SEGMENT = /\./;

// Every forge here names a project as namespace + name, so one segment is never a repository — it
// is a bare owner, or a host with nothing after it.
const NAMESPACED = 2;

/** A configured repository entry as a forge, or null when it does not UNAMBIGUOUSLY name one.
 *
 *  Only the two forms are accepted, and a hostless entry must be exactly `owner/repo`. `a/b/c` is
 *  rejected rather than read as a GitHub path, because `gh --repo` takes `[HOST/]OWNER/REPO` and
 *  would treat the same string as host `a` — so accepting it would mean this parser and the CLI it
 *  feeds disagreeing about which server to talk to (Codex review).
 */
export function forgeFromRepoEntry(entry: string): RemoteForge | null {
  const segments = entry.trim().split("/");
  // An empty segment is a doubled, leading or trailing slash. Dropping them here would let
  // `owner//repo` parse as `owner/repo` while the entry is STORED verbatim and handed to
  // `gh --repo` with the extra slash still in it, which is a parse error there (Codex review).
  if (segments.some((segment) => segment === "")) return null;
  if (!HOST_SEGMENT.test(segments[0])) {
    return segments.length === NAMESPACED ? forgeAt(GITHUB_HOST, segments.join("/")) : null;
  }
  const path = segments.slice(1);
  return path.length >= NAMESPACED ? forgeAt(segments[0].toLowerCase(), path.join("/")) : null;
}
