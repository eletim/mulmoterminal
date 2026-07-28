// Where the decision digest lives and when it is rewritten (#1015).
//
// Under ~/.mulmoterminal rather than inside the project: the file is derived data that changes on
// a timer, and writing it into someone's repository would put it in their diffs and eventually in
// a commit. Agents get at it through the API, so nothing has to know this path by heart.
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { getDecisionDigestEnabled } from "../config/config-routes.js";
import { decisionDigestMarkdown } from "./decision-digest.js";
import { decisionsForCwd } from "./decision-scan.js";
import { encodeProjectDirName } from "./project-dir.js";

// Enough to characterise how a project decides without turning the file into a transcript.
const DIGEST_DECISION_LIMIT = 200;

export const decisionDigestDir = (): string => path.join(os.homedir(), ".mulmoterminal", "decisions");

/** One file per project, named the way Claude names the transcript directory it was read from —
 *  so the two can be matched up by eye when something looks wrong. */
export const decisionDigestPath = (cwd: string): string => path.join(decisionDigestDir(), `${encodeProjectDirName(path.resolve(cwd))}.md`);

/** Write (or rewrite) the digest for one project. Returns the path written, or null when the
 *  feature is off — checked here rather than at the call sites so a toggle takes effect on the
 *  next tick without a restart. */
export async function writeDecisionDigest(cwd: string, now: Date): Promise<string | null> {
  if (!getDecisionDigestEnabled()) return null;
  const { decisions } = await decisionsForCwd(cwd, DIGEST_DECISION_LIMIT);
  const file = decisionDigestPath(cwd);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, decisionDigestMarkdown(decisions, cwd, now.toISOString()), "utf8");
  return file;
}

/** Three answers, never two: "switched off" and "on but I could not read it" send a reader in
 *  opposite directions. Collapsing them was the bug — a failed read would have reported the
 *  feature as off, and the skill would have skipped this project's history believing the user
 *  never asked for it (Codex review). */
export type DigestRead = { state: "disabled" } | { state: "ok"; markdown: string } | { state: "error"; message: string };

/** The digest as text, generating it if it isn't on disk yet — what the skill reads. */
export async function readDecisionDigest(cwd: string, now: Date): Promise<DigestRead> {
  if (!getDecisionDigestEnabled()) return { state: "disabled" };
  const file = decisionDigestPath(cwd);
  try {
    return { state: "ok", markdown: await fs.readFile(file, "utf8") };
  } catch {
    // Not written yet (first run after switching it on) — build it now, and report a failure to
    // build as a failure rather than as an absence.
    try {
      await writeDecisionDigest(cwd, now);
      return { state: "ok", markdown: await fs.readFile(file, "utf8") };
    } catch (e) {
      return { state: "error", message: e instanceof Error ? e.message : String(e) };
    }
  }
}
