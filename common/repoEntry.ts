// Reading a configured repository entry — `owner/repo`, or `host/owner/repo` for one that is not
// on GitHub (#981).
//
// In `common/` because BOTH sides decide from it: the server turns an entry into a forge to know
// which CLI to run, and the browser needs the same answer to say why a control is off. Written
// twice it would drift, and the two answers disagreeing is precisely the failure this abstraction
// is undoing.

export const GITHUB_HOST = "github.com";

// A leading segment containing a DOT is the host. GitHub user and organisation names may hold only
// alphanumerics and hyphens, so `owner/repo` and `host/owner/repo` cannot be confused.
const HOST_SEGMENT = /\./;

export interface RepoEntry {
  host: string;
  /** The segments after the host — how many of them name a project is the HOST's rule, not this. */
  path: string[];
  /** True when the entry spelled the host out. `owner/repo` implies github.com without saying it. */
  declared: boolean;
}

/** Split an entry into host and path, or null when it is not one.
 *
 *  Null for an empty segment — a doubled, leading or trailing slash. Forgiving those would let
 *  `owner//repo` parse as `owner/repo` while the entry is STORED verbatim and handed to a CLI with
 *  the extra slash still in it, which is a parse error there.
 */
export function parseRepoEntry(entry: string): RepoEntry | null {
  const segments = entry.trim().split("/");
  if (segments.some((segment) => segment === "")) return null;
  const declared = segments.length > 1 && HOST_SEGMENT.test(segments[0]);
  return declared ? { host: segments[0].toLowerCase(), path: segments.slice(1), declared } : { host: GITHUB_HOST, path: segments, declared };
}

/** Whether an entry names a repository on github.com — the only host work can be STARTED on. */
export const isGithubRepoEntry = (entry: string): boolean => parseRepoEntry(entry)?.host === GITHUB_HOST;
