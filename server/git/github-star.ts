// Backs the header's "star this project on GitHub" button. The user's own `gh` login is the
// auth, exactly as for the cross-repo PR and issue views — this server never holds a token.
import { runGh } from "./gh.js";
import { createTtlCache } from "./ttl-cache.js";
import { STAR_API_PATH } from "../../common/githubRepo.js";
import type { GhResult } from "./gh.js";

// Bounds the read to one `gh` subprocess per window. The read is a GET, so the app-wide
// same-origin gate does not cover it — it cannot, since a cross-site request and a legitimate
// one look identical to an origin check — and uncached, any page the user happens to visit
// could loop the endpoint and spawn processes on their machine. A minute is also short enough
// that starring on github.com retires the button within a page load or two.
const STAR_TTL_MS = 60_000;
const CACHE_KEY = "star";

const cache = createTtlCache<boolean>();

export interface StarDeps {
  runGh?: typeof runGh;
  now?: () => number;
  ttlMs?: number;
}

const resolveDeps = (deps: StarDeps) => ({
  run: deps.runGh ?? runGh,
  now: deps.now ?? Date.now,
  ttlMs: deps.ttlMs ?? STAR_TTL_MS,
});

// `gh api /user/starred/<repo>` answers 204 when starred and 404 when not, and BOTH the 404 and
// every setup failure (no `gh`, not logged in, offline) exit non-zero. Only the 404 is an answer.
// Match `HTTP 404` rather than gh's "Not Found" prose: our own missing-binary message reads "gh
// not found", which a looser match would read as a confident "not starred".
export function interpretStarCheck(result: GhResult): boolean | null {
  if (result.ok) return true;
  return /HTTP 404/.test(result.stderr) ? false : null;
}

export async function readStarState(deps: StarDeps = {}): Promise<boolean | null> {
  const { run, now, ttlMs } = resolveDeps(deps);
  const hit = cache.get(CACHE_KEY, now, ttlMs);
  if (hit !== undefined) return hit;
  const state = interpretStarCheck(await run(["api", STAR_API_PATH]));
  // Cache only a real answer. Holding a gh failure would keep the button a plain link for the
  // whole window even though the user may be running `gh auth login` right now.
  if (state !== null) cache.set(CACHE_KEY, state, now);
  return state;
}

export async function starRepo(deps: StarDeps = {}): Promise<boolean> {
  const { run, now } = resolveDeps(deps);
  const { ok } = await run(["api", "-X", "PUT", STAR_API_PATH]);
  if (ok) cache.set(CACHE_KEY, true, now);
  return ok;
}
