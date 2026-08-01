// What this app can actually do with a configured repository — as opposed to what forge it is on,
// which is forge-host.ts's question (#981).
//
// Only GitHub is implemented. Saying so is the point: a repository on another forge used to produce
// an empty section with no explanation, because every lookup went through a GitHub-shaped helper
// that answered null. The cross-repo lists already carry a per-repo `error`, so the answer reaches
// the screen through the channel a failing `gh` call already uses — no new UI.
import { forgeFromRepoEntry, type RemoteForge } from "./forge-host.js";

export interface SupportedRepo {
  /** The entry as configured, which is what the row is labelled with. */
  entry: string;
  forge: RemoteForge;
}

export type RepoSupport = SupportedRepo | { entry: string; error: string };

export const isSupported = (r: RepoSupport): r is SupportedRepo => "forge" in r;

// Named rather than "unsupported": a reader of the row needs to know it is the HOST that is not
// handled, not their repository or their credentials — those are the two things a bare "failed"
// would send them off to check.
const notImplemented = (host: string): string => `${host} is not supported yet — MulmoTerminal reads pull requests and issues from github.com only`;

/** Whether a configured `prRepos` entry can be listed, and why not when it cannot. */
export function repoSupport(entry: string): RepoSupport {
  const forge = forgeFromRepoEntry(entry);
  if (!forge) return { entry, error: `${entry} is not a repository — expected owner/repo, or host/owner/repo` };
  if (forge.kind !== "github") return { entry, error: notImplemented(forge.host) };
  return { entry, forge };
}
