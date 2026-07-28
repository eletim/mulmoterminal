// Removing the transcripts the rate-limit probe causes claude to write (#1010).
//
// Hiding them was only ever half an answer: `/api/sessions` is ours to filter, but `claude
// --resume` lists `~/.claude/projects/<cwd>/<id>.jsonl` itself. To keep a probe out of THAT, the
// file has to go.
//
// Two kinds, and only one of them can be named:
//
//   - Probes since the id fix carry an id we chose, so the file is addressed directly. No guessing.
//   - Probes before it let claude mint the id, so nothing about the NAME distinguishes them and
//     the content has to. That is a deletion driven by a guess, which is why the guess is narrow:
//     measured over 7711 transcripts, "contains the probe prompt" matched 6 real conversations
//     (one of them 974 messages long — it merely discussed the string), while "has exactly one
//     user message, and it IS the prompt" matched 83 files and nothing else.
//
// The guess cannot be made perfect, and it is worth saying why rather than implying otherwise: the
// probe types its prompt into the real TUI, so claude records it as `origin: human`,
// `promptSource: typed` — byte for byte what a person typing the same thing produces. No field
// separates them (Codex review on #1030). What bounds the risk instead is TIME: the sweep is for
// files written before this version existed, so it runs ONCE, ever. After that a person can type
// the probe's exact words and nothing will touch it.

import { mkdir, readdir, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { forEachJsonlLine } from "../infra/jsonl-file.js";
import { projectSessionsDir } from "../session/project-dir.js";
import { isProbeSessionId } from "./probe-session.js";
import { PROBE_PROMPT } from "./rate-limit-probe.js";

// Every probe transcript measured came in at 87-91KB. The cap is an order of magnitude above that
// so a future, chattier claude still fits, and it exists to keep the sweep from reading a 14MB
// conversation in full. Erring high only ever means leaving litter behind, never deleting work.
export const PROBE_TRANSCRIPT_MAX_BYTES = 1_000_000;

const messageContent = (entry: unknown): { type: string; content: unknown } | null => {
  if (typeof entry !== "object" || entry === null) return null;
  const record = entry as Record<string, unknown>;
  if (typeof record.type !== "string") return null;
  const message = record.message;
  if (typeof message !== "object" || message === null) return { type: record.type, content: null };
  return { type: record.type, content: (message as Record<string, unknown>).content };
};

const textOf = (content: unknown): string | null => {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return null;
  const texts = content.filter(
    (part): part is { text: string } => typeof part === "object" && part !== null && typeof (part as { text?: unknown }).text === "string",
  );
  return texts.length > 0 ? texts.map((part) => part.text).join("") : null;
};

const usesTools = (content: unknown): boolean =>
  Array.isArray(content) &&
  content.some((part) => typeof part === "object" && part !== null && ["tool_use", "tool_result"].includes(String((part as { type?: unknown }).type)));

/** Whether a transcript's CONTENT says a probe wrote it. Pure, so the boundary between "delete
 *  this" and "this is someone's work" is pinned by tests rather than by trying it on a disk.
 *
 *  Deliberately not a substring test: a real conversation that merely QUOTES the prompt has other
 *  user messages, and that is the whole difference. A probe also never reaches for a tool — true
 *  of all 84 probe transcripts measured — so a one-turn conversation that did is somebody's work. */
export function isProbeTranscript(jsonl: string): boolean {
  return probeVerdict(jsonl.split("\n"));
}

/** The same decision over a line SOURCE rather than one string, so a caller that streams a file
 *  never has to hold it — a transcript on a working machine reaches 585 MB, past the point where
 *  `readFile(…, "utf8")` throws outright (#998). */
const probeVerdict = (lines: Iterable<string>): boolean => {
  let userText: string | null = null;
  let userCount = 0;
  for (const line of lines) {
    const found = probeEvidenceIn(line);
    if (found === null) continue;
    if (found === "tool") return false;
    if (++userCount > 1) return false; // a conversation, whatever it quotes
    userText = found.said;
  }
  return userCount === 1 && userText === PROBE_PROMPT;
};

/** What one transcript line contributes to the decision: a user's words, the fact that a tool was
 *  used, or nothing worth counting. */
const probeEvidenceIn = (line: string): "tool" | { said: string } | null => {
  if (line.trim() === "") return null;
  let entry: unknown;
  try {
    entry = JSON.parse(line);
  } catch {
    return null; // a truncated last line is normal for a file still being written
  }
  const message = messageContent(entry);
  if (message === null) return null;
  if (usesTools(message.content)) return "tool";
  if (message.type !== "user") return null;
  const said = textOf(message.content);
  return said === null ? null : { said };
};

/** Delete one probe's own transcript, addressed by the id we gave it. Returns whether a file went.
 *
 *  Refuses any id that is not shaped like a probe's, so the function cannot be turned into a
 *  "delete this user's session" by a future caller passing the wrong variable. */
export async function removeProbeTranscript(cwd: string, sessionId: string): Promise<boolean> {
  if (!isProbeSessionId(sessionId)) return false;
  try {
    await rm(path.join(projectSessionsDir(cwd), `${sessionId}.jsonl`));
    return true;
  } catch {
    return false; // never written, or already gone
  }
}

/** Sweep transcripts left by probes that ran before ids identified them. Returns how many went.
 *
 *  Scoped to ONE project directory because that is where a probe can have written — widening the
 *  scan finds nothing more and puts more of the user's history in front of a delete. */
export async function sweepLegacyProbeTranscripts(cwd: string): Promise<number> {
  const dir = projectSessionsDir(cwd);
  let names: string[];
  try {
    names = (await readdir(dir)).filter((name) => name.endsWith(".jsonl"));
  } catch {
    return 0; // no transcripts for this project yet
  }
  const removed = await Promise.all(names.map((name) => removeIfProbe(path.join(dir, name))));
  return removed.filter(Boolean).length;
}

/** The sweep, run at most once on this machine — see the note at the top of this file. `marker` is
 *  the file whose existence means "already done". Returns the count, or null when it had already
 *  run (or when the right to run could not be claimed).
 *
 *  The marker is claimed BEFORE anything is deleted, and its directory is created first. Both
 *  matter for the same reason: if the claim is written afterwards and fails — a fresh install has
 *  no `~/.mulmoterminal` yet, and the caller cannot do anything with the error — the files are
 *  already gone AND the sweep runs again next boot, which is precisely the permanent deletion
 *  window this design exists to close (Codex review on #1030). Failing to claim means doing
 *  nothing; a crash mid-sweep leaves litter, which is the harmless direction. */
export async function sweepLegacyProbeTranscriptsOnce(cwd: string, marker: string): Promise<number | null> {
  try {
    await stat(marker);
    return null;
  } catch {
    // not swept yet
  }
  try {
    await mkdir(path.dirname(marker), { recursive: true });
    await writeFile(marker, JSON.stringify({ sweptAt_ms: Date.now() }), "utf8");
  } catch {
    return null; // cannot record that we swept, so do not sweep
  }
  return await sweepLegacyProbeTranscripts(cwd);
}

const removeIfProbe = async (file: string): Promise<boolean> => {
  try {
    if ((await stat(file)).size > PROBE_TRANSCRIPT_MAX_BYTES) return false;
    // Streamed rather than read whole, like every other transcript reader here (#998): the size
    // check above already excludes the giants, so this is belt and braces — but a reader that
    // takes the whole file is exactly the bug that made the longest sessions look empty.
    const lines: string[] = [];
    await forEachJsonlLine(file, (line) => lines.push(line));
    if (!probeVerdict(lines)) return false;
    await rm(file);
    return true;
  } catch {
    return false;
  }
};
