// Backs the header's "star this project on GitHub" button. The user's own `gh` login is the
// auth, exactly as for the cross-repo PR and issue views — this server never holds a token.
import { runGh, type GhResult } from "./gh.js";
import { STAR_API_PATH } from "../../common/githubRepo.js";

// `gh api /user/starred/<repo>` answers 204 when starred and 404 when not, and BOTH the 404 and
// every setup failure (no `gh`, not logged in, offline) exit non-zero. Only the 404 is an answer.
// Match `HTTP 404` rather than gh's "Not Found" prose: our own missing-binary message reads "gh
// not found", which a looser match would read as a confident "not starred".
export function interpretStarCheck(result: GhResult): boolean | null {
  if (result.ok) return true;
  return /HTTP 404/.test(result.stderr) ? false : null;
}

// Cached once true and never re-checked: an unstar happens on github.com, and re-offering the
// button then is not worth a subprocess on every page load. A false or null stays re-checkable —
// the user may star in another tab, or run `gh auth login` after this server booted.
let starred = false;

export async function readStarState(): Promise<boolean | null> {
  if (starred) return true;
  const state = interpretStarCheck(await runGh(["api", STAR_API_PATH]));
  if (state === true) starred = true;
  return state;
}

export async function starRepo(): Promise<boolean> {
  const { ok } = await runGh(["api", "-X", "PUT", STAR_API_PATH]);
  if (ok) starred = true;
  return ok;
}
