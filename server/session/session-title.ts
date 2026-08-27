// The session's AI-generated title: when it is due, generating it without letting two
// triggers race, and voiding a result that a /clear made stale. Split from index.ts
// (#548 step 3f) — the rules for WHETHER to (re)generate already live in
// config/header-title.ts; this is the bookkeeping around them.
//
// Four guards do the real work and are easy to lose in a rewrite: an epoch that drops a
// title generated across a /clear, the cleared-transcript mark that stops the NEXT turn
// generating one from that same pre-clear file, an in-flight set so a Stop hook and a roster
// view do not both summarize, and a retry floor so a viewed-but-failing session is not
// re-summarized on every poll.
import path from "node:path";
import { conversationTurnsFromParsed, isTrivialPrompt, type ConversationTurn } from "./transcript.js";
import { forEachJsonlRecord } from "../infra/jsonl-file.js";
import { shouldFreshenViewedTitle, shouldRegenerateTitle, TITLE_REGEN_EVERY_TURNS, VIEW_TITLE_REGEN_TURNS } from "../config/header-title.js";
import { clearedTranscripts } from "./cleared-transcripts.js";
import { projectSessionsDir } from "./project-dir.js";

// Process-local title generation state, owned and cleaned entirely by this module.
export const titleTurnCounts = new Map<string, number>();
export const titlePending = new Set<string>();
export const titleInFlight = new Set<string>();
export const titleEpoch = new Map<string, number>();
export const lastTitledUserTurns = new Map<string, number>();
export const lastTitleAttemptMs = new Map<string, number>();

// How long a viewed session that failed to summarize waits before being tried again, so a
// roster poll cannot spawn a summarizer per request.
const VIEW_TITLE_RETRY_MS = 30_000;

export interface TitleDeps {
  /** Push the Core title change to subscribers without mirroring it in Backend state. */
  publishTitle: (id: string, title: string | null) => void;
  /** Injected so the retry floor can be tested without waiting out 30 seconds. */
  now: () => number;
  /** Summarize a transcript into a title. Injected because the real one shells out to
   *  the claude CLI, which a unit test must never do. */
  // Turns, not the raw transcript: the file reaches 585 MB here and cannot be held as a string
  // at all (#998). The title only reads the last few turns anyway.
  generateTitle: (turns: ConversationTurn[]) => Promise<string | null>;
  /** Read/write the sole live title source: Core metadata. History-only ids return false. */
  hasTitle: (id: string) => Promise<boolean>;
  persistTitle: (id: string, title: string) => Promise<boolean>;
  clearTitle: (id: string) => Promise<boolean>;
}

function forgetSessionTitle(sessionId: string): void {
  titleTurnCounts.delete(sessionId);
  titlePending.delete(sessionId);
  titleEpoch.set(sessionId, (titleEpoch.get(sessionId) ?? 0) + 1);
}

/** Drop process-local title guards when their owning agent process ends or is deleted.
 * Core title metadata is intentionally untouched. */
export function cleanupSessionTitleState(sessionId: string): void {
  forgetSessionTitle(sessionId);
  titleInFlight.delete(sessionId);
  lastTitledUserTurns.delete(sessionId);
  lastTitleAttemptMs.delete(sessionId);
}

const viewedTitleIsStale = (sessionId: string, currentUserTurns: number): boolean =>
  shouldFreshenViewedTitle({
    lastTitledUserTurns: lastTitledUserTurns.get(sessionId) ?? null,
    currentUserTurns,
    regenEveryTurns: VIEW_TITLE_REGEN_TURNS,
  });

export function createTitleManager(deps: TitleDeps) {
  // Drop all AI-title bookkeeping for a session (on /clear or teardown). Bumping the epoch
  // voids any in-flight generation started before this reset — its (now pre-clear) title
  // must not resurface after the header was cleared.
  async function forgetTitle(sessionId: string): Promise<void> {
    forgetSessionTitle(sessionId);
    if (await deps.clearTitle(sessionId)) deps.publishTitle(sessionId, null);
  }

  // Count a user turn and flag the session for a title (re)generation at the next Stop when
  // one is due (no title yet, a trivial/stale-inducing ack, or every N turns).
  async function noteTitleTurn(sessionId: string, prompt: string): Promise<void> {
    const turnsSinceTitle = (titleTurnCounts.get(sessionId) ?? 0) + 1;
    titleTurnCounts.set(sessionId, turnsSinceTitle);
    const due = shouldRegenerateTitle({
      hasTitle: await deps.hasTitle(sessionId),
      promptIsTrivial: isTrivialPrompt(prompt),
      turnsSinceTitle,
      maxTurns: TITLE_REGEN_EVERY_TURNS,
    });
    if (due) titlePending.add(sessionId);
  }

  // Read the transcript, summarize its recent turns into a title, and store + publish it.
  // Epoch-guarded: a /clear or teardown mid-generation bumps the epoch, so the now-stale
  // result is dropped. In-flight-guarded so overlapping triggers (a Stop hook and a roster
  // view) don't both summarize. Never throws — a failed/timed-out CLI just leaves the prior title.
  async function generateAndStoreTitle(sessionId: string, cwd: string, transcriptId = sessionId): Promise<void> {
    if (titleInFlight.has(sessionId)) return;
    // A cleared session has no transcript to title from: claude moved to a new one and ours is
    // frozen on the conversation the user just ended, so this is where the pre-clear title kept
    // coming back — forgetTitle makes the next turn think a title is DUE, and the only turns on
    // disk are the ended ones (#1085). No title beats the wrong one; the header falls back to the
    // live prompt.
    if (clearedTranscripts.has(sessionId)) return;
    titleInFlight.add(sessionId);
    const epoch = titleEpoch.get(sessionId) ?? 0;
    try {
      // One streamed pass yields both what the title needs (the turns) and what the bookkeeping
      // needs (how many user turns there were), so the transcript is never held as a string.
      const turns: ConversationTurn[] = [];
      let read = true;
      await forEachJsonlRecord(path.join(projectSessionsDir(cwd), `${transcriptId}.jsonl`), (record) => {
        turns.push(...conversationTurnsFromParsed([record]));
      }).catch(() => (read = false));
      const title = read && turns.length ? await deps.generateTitle(turns) : null;
      if (title && (titleEpoch.get(sessionId) ?? 0) === epoch) {
        const stored = await deps.persistTitle(sessionId, title).catch(() => false);
        if (!stored) return;
        // `/clear` may have landed while the Core metadata write was in flight. Its incremented
        // epoch wins; remove the stale write before anything can publish it.
        if ((titleEpoch.get(sessionId) ?? 0) !== epoch) {
          await deps.clearTitle(sessionId);
          return;
        }
        titleTurnCounts.set(sessionId, 0);
        lastTitledUserTurns.set(sessionId, turns.filter((t) => t.role === "user").length);
        deps.publishTitle(sessionId, title);
      }
    } finally {
      titleInFlight.delete(sessionId);
    }
  }

  // At Stop (the assistant's reply is now on disk), regenerate a pending title from the
  // recent turns and publish it. Fire-and-forget; a failure leaves the last prompt showing.
  async function maybeGenerateTitle(sessionId: string, cwd: string | undefined, transcriptId = sessionId): Promise<void> {
    if (!cwd || !titlePending.has(sessionId) || titleInFlight.has(sessionId)) return;
    titlePending.delete(sessionId);
    await generateAndStoreTitle(sessionId, cwd, transcriptId);
  }

  // The roster also summarizes sessions whose hook path did not run.
  function freshenRosterTitle(sessionId: string, cwd: string, currentUserTurns: number): void {
    if (titleInFlight.has(sessionId)) return;
    if (!viewedTitleIsStale(sessionId, currentUserTurns)) return;
    const now = deps.now();
    if (now - (lastTitleAttemptMs.get(sessionId) ?? 0) < VIEW_TITLE_RETRY_MS) return;
    lastTitleAttemptMs.set(sessionId, now);
    void generateAndStoreTitle(sessionId, cwd);
  }
  return { forgetTitle, noteTitleTurn, maybeGenerateTitle, freshenRosterTitle };
}
