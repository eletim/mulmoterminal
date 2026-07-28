// GET /api/decisions — the decisions a human was asked to make in this project, newest first.
//
// Read-only, and it writes nothing of its own: the record already exists in Claude's transcripts
// (server/session/decisions.ts explains the shape). This route only makes 7,000-odd JSONL files
// answerable as a question — "what have I been asked, and what did I choose" (#997).
import type { Express, Request, Response } from "express";
import { createReadStream } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import readline from "node:readline";
import type { DecisionRecord, DecisionsResponse } from "../../common/decisionLog.js";
import { existingWorkspaceFromQuery } from "../config/workspace.js";
import { byNewest, createDecisionScan } from "../session/decisions.js";
import { createFileCache, type FileStamp } from "../session/file-cache.js";
import { projectSessionsDir } from "../session/project-dir.js";
import { safeReaddir } from "../session/session-reads.js";

// A project accumulates a transcript per session, so the newest N is a cap on work per request,
// not a filter anyone would notice: decisions are read newest-first anyway. `scanned` in the
// response says how many were actually read, so a truncated scan is visible rather than implied.
const MAX_TRANSCRIPTS = 200;
const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 500;

// Parsing a transcript is the expensive part and the file is append-only, so the extraction is
// memoised on (mtime, size) exactly like the session summary it sits next to.
const cache = createFileCache<DecisionRecord[]>();

const clampLimit = (raw: unknown): number => {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.min(Math.floor(n), MAX_LIMIT) : DEFAULT_LIMIT;
};

interface Transcript {
  file: string;
  sessionId: string;
  stamp: FileStamp;
}

async function transcriptsNewestFirst(dir: string): Promise<Transcript[]> {
  const names = safeReaddir(dir).filter((f) => f.endsWith(".jsonl"));
  const stated = await Promise.all(
    names.map(async (name): Promise<Transcript | null> => {
      const file = path.join(dir, name);
      try {
        const s = await fs.stat(file);
        return { file, sessionId: name.slice(0, -".jsonl".length), stamp: { mtimeMs: s.mtimeMs, size: s.size } };
      } catch {
        return null; // deleted between readdir and stat
      }
    }),
  );
  return stated
    .filter((t): t is Transcript => t !== null)
    .sort((a, b) => b.stamp.mtimeMs - a.stamp.mtimeMs)
    .slice(0, MAX_TRANSCRIPTS);
}

// Line by line, never as one string: a transcript on this machine is 585 MB, which is past what
// a JS string can hold, and reading it whole would drop exactly the longest sessions (#998).
async function scanTranscript(transcript: Transcript): Promise<DecisionRecord[]> {
  const scan = createDecisionScan();
  const input = createReadStream(transcript.file, "utf8");
  const lines = readline.createInterface({ input, crlfDelay: Infinity });
  try {
    for await (const line of lines) scan.addLine(line);
  } finally {
    lines.close();
    input.destroy();
  }
  return scan.finish(transcript.sessionId);
}

// A transcript that could not be read is reported, not silently treated as one with no decisions:
// the caller cannot otherwise tell a quiet project from a partial answer (Codex review).
async function decisionsIn(transcript: Transcript): Promise<DecisionRecord[] | null> {
  const hit = cache.get(transcript.file, transcript.stamp);
  if (hit) return hit;
  try {
    const found = await scanTranscript(transcript);
    cache.set(transcript.file, transcript.stamp, found);
    return found;
  } catch {
    return null;
  }
}

// Each scan holds an open read stream, so a cold pass over a project with hundreds of sessions
// would open hundreds at once and can hit the process's file-descriptor limit — where the failure
// lands in the catch above and quietly costs decisions. A small pool keeps the cold pass fast
// (measured: 200 transcripts in ~120ms) without ever holding more than this many descriptors.
const SCAN_CONCURRENCY = 8;

async function mapWithLimit<T, R>(items: T[], limit: number, run: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const worker = async (): Promise<void> => {
    for (let i = next++; i < items.length; i = next++) results[i] = await run(items[i]);
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

export async function decisionsForCwd(cwd: string, limit: number): Promise<DecisionsResponse> {
  const transcripts = await transcriptsNewestFirst(projectSessionsDir(cwd));
  const perFile = await mapWithLimit(transcripts, SCAN_CONCURRENCY, decisionsIn);
  const read = perFile.filter((found): found is DecisionRecord[] => found !== null);
  return {
    decisions: read.flat().sort(byNewest).slice(0, limit),
    scanned: read.length,
    unreadable: perFile.length - read.length,
  };
}

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
}
