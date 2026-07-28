// Removing the transcripts the rate-limit probe causes claude to write (#1010).
//
// Hiding them was only ever half an answer: `/api/sessions` is ours to filter, but `claude
// --resume` lists `~/.claude/projects/<cwd>/<id>.jsonl` itself. To keep a probe out of THAT, the
// file has to go.
//
// Two kinds, and only one of them can be named:
//
//   - Probes since 2.5.3 carry an id we chose, so the file is addressed directly. No guessing.
//   - Probes before it let claude mint the id, so nothing about the NAME distinguishes them and
//     the content has to. That is a deletion driven by a guess, which is why the guess is narrow:
//     measured over 7711 transcripts, "contains the probe prompt" matched 6 real conversations
//     (one of them 974 messages long — it merely discussed the string), while "has exactly one
//     user message, and it IS the prompt" matched 83 files and nothing else.

import { readdir, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { projectSessionsDir } from "../session/project-dir.js";
import { PROBE_PROMPT } from "./rate-limit-probe.js";

const userMessageText = (entry: unknown): string | null => {
  if (typeof entry !== "object" || entry === null) return null;
  const record: Record<string, unknown> = { ...entry };
  if (record.type !== "user") return null;
  const message = record.message;
  if (typeof message !== "object" || message === null) return null;
  const content = (message as Record<string, unknown>).content;
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return null;
  const texts = content.filter(
    (part): part is { text: string } => typeof part === "object" && part !== null && typeof (part as { text?: unknown }).text === "string",
  );
  return texts.length > 0 ? texts.map((part) => part.text).join("") : null;
};

/** Whether a transcript's CONTENT says a probe wrote it. Pure, so the boundary between "delete
 *  this" and "this is someone's work" is pinned by tests rather than by trying it on a disk.
 *
 *  Deliberately not a substring test: a real conversation that merely QUOTES the prompt has other
 *  user messages, and that is the whole difference. */
export function isProbeTranscript(jsonl: string): boolean {
  const userTexts = jsonl
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line) => {
      try {
        return userMessageText(JSON.parse(line));
      } catch {
        return null; // a truncated last line is normal for a file still being written
      }
    })
    .filter((text): text is string => text !== null);
  return userTexts.length === 1 && userTexts[0] === PROBE_PROMPT;
}

/** Delete one probe's own transcript, addressed by the id we gave it. Returns whether a file went. */
export async function removeProbeTranscript(cwd: string, sessionId: string): Promise<boolean> {
  const file = path.join(projectSessionsDir(cwd), `${sessionId}.jsonl`);
  try {
    await rm(file);
    return true;
  } catch {
    return false; // never written, already gone, or not ours to remove
  }
}

/** Sweep transcripts left by probes that ran before ids identified them. Returns how many went.
 *
 *  Scoped to ONE project directory because that is where a probe can have written — widening the
 *  scan finds nothing more and puts more of the user's history in front of a delete. */
export async function sweepLegacyProbeTranscripts(cwd: string): Promise<number> {
  const dir = projectSessionsDir(cwd);
  let files: string[];
  try {
    files = (await readdir(dir)).filter((name) => name.endsWith(".jsonl"));
  } catch {
    return 0; // no transcripts for this project yet
  }
  const removed = await Promise.all(files.map((name) => removeIfProbe(path.join(dir, name))));
  return removed.filter(Boolean).length;
}

const removeIfProbe = async (file: string): Promise<boolean> => {
  try {
    if (!isProbeTranscript(await readFile(file, "utf8"))) return false;
    await rm(file);
    return true;
  } catch {
    return false;
  }
};
