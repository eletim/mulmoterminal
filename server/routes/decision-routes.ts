// GET /api/decisions — the decisions a human was asked to make in this project, newest first.
//
// Read-only, and it writes nothing of its own: the record already exists in Claude's transcripts
// (server/session/decisions.ts explains the shape, server/session/decision-scan.ts reads them).
// This route only makes 7,000-odd JSONL files answerable as a question — "what have I been asked,
// and what did I choose" (#997).
import type { Express, Request, Response } from "express";
import type { DecisionsResponse } from "../../common/decisionLog.js";
import { existingWorkspaceFromQuery } from "../config/workspace.js";
import { readDecisionDigest } from "../session/decision-digest-file.js";
import { decisionsForCwd } from "../session/decision-scan.js";

const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 500;

const clampLimit = (raw: unknown): number => {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.min(Math.floor(n), MAX_LIMIT) : DEFAULT_LIMIT;
};

/** Same shape, no decisions: the requested directory is gone or was never one. A route that
 *  REPORTS ON a directory must not fall back to the default workspace — the caller would render
 *  another project's decisions under this one's name, and a stale preset (a project since
 *  deleted) is exactly when that happens. */
export const NO_DECISIONS: DecisionsResponse = { decisions: [], scanned: 0, unreadable: 0 };

export function mountDecisionRoutes(app: Express): void {
  app.get("/api/decisions", async (req: Request, res: Response) => {
    const cwd = existingWorkspaceFromQuery(req.query.cwd);
    res.json(cwd ? await decisionsForCwd(cwd, clampLimit(req.query.limit)) : NO_DECISIONS);
  });

  // The digest an agent reads before asking something similar (#1015). Markdown rather than JSON
  // because the reader is a language model, and `enabled: false` is a different answer from an
  // empty digest — the skill must be able to say "this is switched off" rather than "nothing has
  // ever been decided here".
  app.get("/api/decisions/digest", async (req: Request, res: Response) => {
    const cwd = existingWorkspaceFromQuery(req.query.cwd);
    if (!cwd) return res.status(400).json({ enabled: null, error: "cwd must be an existing directory" });
    const markdown = await readDecisionDigest(cwd, new Date());
    if (markdown === null) return res.json({ enabled: false, markdown: null });
    res.json({ enabled: true, markdown });
  });
}
