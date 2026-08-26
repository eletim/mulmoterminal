// Reading turn boundaries out of a codex rollout as it is appended to. codex has no
// hook mechanism — claude reports its own turns via `--settings` hooks, and there is no
// equivalent flag to pass codex (see docs/codex-vs-claude.md) — so the rollout is the
// only place a codex turn announces that it started or finished.
//
// Everything here is pure: the tailing itself lives in session/codex-activity-watch.ts.

import { isRecord } from "../../common/isRecord.js";
import { activityHookEffects, pushKindFor, type ActivityEffect } from "../session/activity-hook.js";
import type { PushKind } from "../../common/pushKinds.js";

export type CodexTurnBoundary = "started" | "completed";

// codex boundaries are routed through the SAME effect table as claude's hooks, so what a
// turn boundary does to the working / attention flags is defined once rather than per
// agent. codex never reports being blocked on input — its approval prompt is drawn in the
// TUI and never reaches the rollout — so there is deliberately no Notification here.
export const HOOK_EVENT_FOR: Record<CodexTurnBoundary, string> = {
  started: "UserPromptSubmit",
  completed: "Stop",
};

// Where to read next, or null when there is nothing new. A file SMALLER than the offset
// restarted underneath us (truncated, or the id was reused): reading from the stale
// offset would slice mid-record, so the read starts over from the beginning.
export function nextReadRange(offset: number, size: number): { from: number; to: number } | null {
  if (size < offset) return { from: 0, to: size };
  return size > offset ? { from: offset, to: size } : null;
}

// A poll can land mid-record, so the trailing fragment is carried to the next tick rather
// than parsed as a line. Text ending in a newline leaves nothing pending.
export function takeCompleteLines(pending: string, chunk: string): { lines: string[]; pending: string } {
  const parts = (pending + chunk).split("\n");
  return { lines: parts.slice(0, -1).filter((line) => line.trim()), pending: parts[parts.length - 1] ?? "" };
}

// A rollout record, or null for malformed JSON / non-object rows.
function parseLine(line: string): Record<string, unknown> | null {
  try {
    const doc: unknown = JSON.parse(line);
    return isRecord(doc) ? doc : null;
  } catch {
    return null; // a row that isn't JSON — codex writes none, but a torn file could
  }
}

// The `event_msg` payload type of a line, or null for anything else. A `turn_context` row
// carries a turn_id but no payload.type, so matching on the payload alone would misread it.
function eventType(line: string): string | null {
  const doc = parseLine(line);
  if (!doc || doc.type !== "event_msg" || !isRecord(doc.payload)) return null;
  return typeof doc.payload.type === "string" ? doc.payload.type : null;
}

const trimmedString = (value: unknown): string | null => (typeof value === "string" && value.trim() ? value.trim() : null);

const INPUT_TEXT_JOINER = "\n\n";
const ENVIRONMENT_CONTEXT_RE = /^<environment_context>[\s\S]*<\/environment_context>$/;

function isCodexGeneratedUserText(text: string): boolean {
  return ENVIRONMENT_CONTEXT_RE.test(text.trim());
}

function legacyUserPrompt(doc: Record<string, unknown>): string | null {
  if (doc.type !== "event_msg" || !isRecord(doc.payload) || doc.payload.type !== "user_message") return null;
  const message = trimmedString(doc.payload.message);
  return message && !isCodexGeneratedUserText(message) ? message : null;
}

function responseItemUserPrompt(doc: Record<string, unknown>): string | null {
  if (doc.type !== "response_item" || !isRecord(doc.payload)) return null;
  if (doc.payload.type !== "message" || doc.payload.role !== "user" || !Array.isArray(doc.payload.content)) return null;

  const texts = doc.payload.content.flatMap((item): string[] => {
    if (!isRecord(item) || item.type !== "input_text") return [];
    const text = trimmedString(item.text);
    return text ? [text] : [];
  });
  if (texts.length === 0 || isCodexGeneratedUserText(texts.join(INPUT_TEXT_JOINER))) return null;

  const prompt = texts
    .filter((text) => !isCodexGeneratedUserText(text))
    .join(INPUT_TEXT_JOINER)
    .trim();
  return prompt && !isCodexGeneratedUserText(prompt) ? prompt : null;
}

function userPrompt(line: string): string | null {
  const doc = parseLine(line);
  if (!doc) return null;
  return legacyUserPrompt(doc) ?? responseItemUserPrompt(doc);
}

// User prompts appended to a codex rollout tail. They are not turn boundaries, so the
// watcher must surface them separately from task_started/task_complete or a prompt-only
// poll would never update the header.
export function codexUserPrompts(lines: string[]): string[] {
  const prompts: string[] = [];
  let previousPrompt: string | null = null;
  for (const line of lines) {
    const prompt = userPrompt(line);
    if (!prompt) {
      previousPrompt = null;
      continue;
    }
    if (prompt !== previousPrompt) prompts.push(prompt);
    previousPrompt = prompt;
  }
  return prompts;
}

// The event_msg payload types that END a turn. `task_complete` is the normal finish;
// `turn_aborted` is what an INTERRUPTED turn writes (Esc / steer) — verified against real
// rollouts, where an aborted turn logs task_started … turn_aborted with NO task_complete.
// An "error" turn still gets task_complete, so only interrupts rely on turn_aborted. Miss
// it and the working flag set at task_started never clears: the spinner spins forever and no
// "finished" push fires. This affects display/notification state only.
const TURN_END_TYPES = new Set(["task_complete", "turn_aborted"]);

// The turn boundaries in these lines, oldest first. A turn that both starts and finishes
// within one poll yields both, in order, so no transition is collapsed away.
export function turnBoundaries(lines: string[]): CodexTurnBoundary[] {
  return lines.flatMap((line) => {
    const type = eventType(line);
    if (type === "task_started") return ["started" as const];
    return type !== null && TURN_END_TYPES.has(type) ? ["completed" as const] : [];
  });
}

// What a boundary does: the flag changes, and whether the phone should hear about it.
// Both come from claude's tables so the two agents cannot drift apart — a codex turn that
// finishes has to notify exactly as a claude Stop does, or half the grid stays silent.
export interface BoundaryOutcome {
  effects: ActivityEffect[];
  push: PushKind | null;
}

export function boundaryOutcome(boundary: CodexTurnBoundary, active: boolean): BoundaryOutcome {
  const event = HOOK_EVENT_FOR[boundary];
  return { effects: activityHookEffects(event, active), push: pushKindFor(event) };
}
