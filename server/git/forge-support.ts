// What this app can actually do with a working directory's repository — as opposed to what forge
// it is on, which is forge-host.ts's question (#981).
import { forgeOf, projectPath, type RemoteForge } from "./forge-host.js";
import { resolveRemoteForge } from "./gitRemote.js";

const LISTABLE: ReadonlySet<string> = new Set(["github", "gitlab"]);

/** What a working directory's `origin` names. */
export interface DirRepo {
  forge: RemoteForge;
  /** `owner/repo` when this app can act on that forge, else null — a repository we can see but not
   *  work with. Every dir-derived caller has always used exactly this value; keeping it null for an
   *  unsupported forge is what makes this change behaviour-preserving (#981 step 2b). */
  repo: string | null;
}

// `repo` is set for every forge this app can ACT on, and carries the host unless it is GitHub.
// A bare `owner/repo` would make a GitHub and a GitLab project of the same path indistinguishable.
const actionableRepo = (forge: RemoteForge): string | null => {
  const project = LISTABLE.has(forge.kind) ? projectPath(forge) : null;
  if (!project) return null;
  return forge.kind === "github" ? project : `${forge.host}/${project}`;
};

const dirRepo = (forge: RemoteForge | null): DirRepo | null => (forge ? { forge, repo: actionableRepo(forge) } : null);

/** The repository a remote URL names, or null when the string is not a remote at all. */
export const repoForRemote = (remoteUrl: string): DirRepo | null => dirRepo(forgeOf(remoteUrl));

/** The repository a directory's `origin` names, or null when it has no readable remote.
 *
 *  One place decides this for all of it: five call sites each wrote
 *  `repoFromWebUrl(await resolveGithubUrl(dir))`, which answers null both for "no remote" and for
 *  "a remote we do not support" — and the callers then report the second as the first.
 */
export const repoForDir = async (dir: string): Promise<DirRepo | null> => dirRepo(await resolveRemoteForge(dir));

/** Why a directory named no repository this app can act on.
 *
 *  Two answers, not one: `repo` is null both for a forge we cannot act on and for a remote on a
 *  forge we CAN that does not name a project (`github.com/onlyone`). Collapsing them is the exact
 *  mistake this module exists to undo, and the second is not the host's fault (Codex review).
 */
export const missingRepoReason = (found: DirRepo | null): "no-repo" | "unsupported-forge" =>
  found && found.repo === null && found.forge.kind !== "github" ? "unsupported-forge" : "no-repo";
