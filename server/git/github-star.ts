// Backs the header's "star this project on GitHub" button. The user's own `gh` login is the
// auth, exactly as for the cross-repo PR and issue views — this server never holds a token.
import { runGh } from "./gh.js";
import { createTtlCache } from "./ttl-cache.js";
import { STAR_API_PATH } from "../../common/githubRepo.js";
import type { GhResult } from "./gh.js";

// Both windows exist for the same reason: the read is a GET, so the app-wide same-origin gate
// does not cover it — it cannot, since a cross-site request and a legitimate one look identical
// to an origin check — and uncached, any page the user happens to visit could loop the endpoint
// and spawn `gh` on their machine without bound.
//
// They differ in length because they hold different things. A real answer is stable, and a
// minute is still short enough that starring on github.com retires the button within a page
// load or two. An unknown means `gh` is broken *right now* and the user may be fixing it, so it
// is held only long enough to stop a loop — a few seconds, not a minute of stale "cannot tell".
const ANSWER_TTL_MS = 60_000;
const UNKNOWN_TTL_MS = 5_000;
const CACHE_KEY = "star";

const answers = createTtlCache<boolean>();
const unknowns = createTtlCache<true>();

export interface StarDeps {
  runGh?: typeof runGh;
  now?: () => number;
  ttlMs?: number;
  unknownTtlMs?: number;
}

const resolveDeps = (deps: StarDeps) => ({
  run: deps.runGh ?? runGh,
  now: deps.now ?? Date.now,
  ttlMs: deps.ttlMs ?? ANSWER_TTL_MS,
  unknownTtlMs: deps.unknownTtlMs ?? UNKNOWN_TTL_MS,
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
  const { run, now, ttlMs, unknownTtlMs } = resolveDeps(deps);
  const answer = answers.get(CACHE_KEY, now, ttlMs);
  if (answer !== undefined) return answer;
  if (unknowns.get(CACHE_KEY, now, unknownTtlMs)) return null;
  const state = interpretStarCheck(await run(["api", STAR_API_PATH]));
  if (state === null) unknowns.set(CACHE_KEY, true, now);
  else answers.set(CACHE_KEY, state, now);
  return state;
}

export async function starRepo(deps: StarDeps = {}): Promise<boolean> {
  const { run, now } = resolveDeps(deps);
  const { ok } = await run(["api", "-X", "PUT", STAR_API_PATH]);
  if (ok) answers.set(CACHE_KEY, true, now);
  return ok;
}
