// Session PR phase still needs GitHub's statusCheckRollup collapsed into one UI state.
// The old cross-repo PR listing lived here too; Issue #136 removed that route and UI.
import type { CiState } from "../../common/ghItems.js";
import { isRecord } from "../../common/isRecord.js";
import { readString } from "../../common/readString.js";

const FAIL = new Set(["FAILURE", "TIMED_OUT", "CANCELLED", "ACTION_REQUIRED", "STARTUP_FAILURE"]);
const OK = new Set(["SUCCESS", "NEUTRAL", "SKIPPED"]);

// Collapse a PR's statusCheckRollup (mixed CheckRun {status,conclusion} + StatusContext
// {state}) into one glanceable state: any failure wins, else any not-yet-successful
// check → pending, else passing. Empty rollup → none.
export function rollupCiState(checks: unknown): CiState {
  if (!Array.isArray(checks) || checks.length === 0) return "none";
  let anyPending = false;
  for (const c of checks) {
    if (!isRecord(c)) continue;
    const o = c;
    const conclusion = readString(o.conclusion).toUpperCase();
    const state = readString(o.state).toUpperCase();
    if (FAIL.has(conclusion) || state === "FAILURE" || state === "ERROR") return "failing";
    if (!(OK.has(conclusion) || state === "SUCCESS")) anyPending = true;
  }
  return anyPending ? "pending" : "passing";
}
