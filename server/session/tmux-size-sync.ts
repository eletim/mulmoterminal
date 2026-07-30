// A tmux window that fell out of step with its client never recovers on its own.
//
// tmux learns a client's size from SIGWINCH, and the kernel raises SIGWINCH only when the size
// actually CHANGES — so re-sending the size the pty already holds is silent. That was every
// repair the product had: the browser's ResizeObserver re-fits to the same size, a reload
// re-attaches and sends it again from `onopen`, and `tmuxRedrawClient` (#1073) repaints
// faithfully at the size tmux still believes in. What the user sees is content in the top-left
// corner and blank columns and rows everywhere else, with no way out but resizing the browser
// window by hand (#957).
//
// Measured on tmux 3.6a against a live disagreement (our client 120x40, the window 80x24): the
// re-send and `refresh-client` both left it at 80x24; shrinking the pty by a row and putting it
// straight back restored 120x40. `resize-window` also works and is deliberately NOT used — it
// switches that window to `window-size manual`, after which it stops following the client for
// good, which trades a rare bug for a permanent one.

export interface TerminalSize {
  cols: number;
  rows: number;
}

export type SizeSyncEvent =
  /** About to nudge: tmux and the client disagree. */
  | { kind: "repairing"; id: string; wanted: TerminalSize; seen: TerminalSize }
  /** The nudge did not take — the gap has a mechanism we don't know about yet. */
  | { kind: "still-wrong"; id: string; wanted: TerminalSize; seen: TerminalSize };

export interface TmuxSizeSyncDeps {
  /** What tmux says the window is, or null when it can't say. */
  windowSizeOf: (id: string) => Promise<TerminalSize | null>;
  /** Resize the session's pty. Called twice for one nudge; a no-op for a session that has gone. */
  resizePty: (id: string, size: TerminalSize) => void;
  /** Reported so a recurrence is attributable — this bug has been hard to pin down precisely
   *  because it leaves no trace of its own. */
  onEvent: (event: SizeSyncEvent) => void;
  settleMs?: number;
  nudgeMs?: number;
}

// Long enough that a splitter drag or a window resize costs one probe rather than one per frame,
// short enough that a reload's blank screen is repaired before the user reaches for the mouse.
const DEFAULT_SETTLE_MS = 250;
// Holding the intermediate size briefly keeps the two ioctls genuinely distinct, so the repair
// does not depend on how the kernel coalesces signals. Measured on tmux 3.6a, three attempts at
// each of 0/10/25/50/100/150ms: every gap repaired every time, so this is picked for margin
// rather than necessity — and it is short enough that the app's reflow is not seen.
const DEFAULT_NUDGE_MS = 50;

export const sizesAgree = (a: TerminalSize, b: TerminalSize): boolean => a.cols === b.cols && a.rows === b.rows;

/** One row in whichever direction exists. A one-row terminal can only grow. */
export const nudgedSize = ({ cols, rows }: TerminalSize): TerminalSize => ({ cols, rows: rows > 1 ? rows - 1 : rows + 1 });

export function createTmuxSizeSync(deps: TmuxSizeSyncDeps) {
  const settleMs = deps.settleMs ?? DEFAULT_SETTLE_MS;
  const nudgeMs = deps.nudgeMs ?? DEFAULT_NUDGE_MS;
  const pending = new Map<string, ReturnType<typeof setTimeout>>();
  // A check is several awaits long, so clearing a timer cannot reach one that has already started.
  // Each request takes a ticket, and every step past an await asks whether it still holds the
  // newest — otherwise a nudge would put the pty back to a size the client abandoned mid-flight,
  // which is the very disagreement this file exists to close.
  const generation = new Map<string, number>();
  // The newest size the client asked for, so an in-flight nudge lands on THAT rather than on the
  // size it captured when it started.
  const wanted = new Map<string, TerminalSize>();
  const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
  // Bumped rather than deleted: a cancel followed by a new request would otherwise reissue a
  // ticket number an in-flight check is still holding.
  const nextTicket = (id: string): number => {
    const ticket = (generation.get(id) ?? 0) + 1;
    generation.set(id, ticket);
    return ticket;
  };
  const holdsNewest = (id: string, ticket: number): boolean => generation.get(id) === ticket;

  async function nudge(id: string, target: TerminalSize, seen: TerminalSize, ticket: number): Promise<void> {
    deps.onEvent({ kind: "repairing", id, wanted: target, seen });
    deps.resizePty(id, nudgedSize(target));
    await wait(nudgeMs);
    // The pty must never be left behind the client, so the restore uses the newest size rather
    // than the one captured above: a resize frame that landed mid-nudge has already set the real
    // size, and putting the captured one back would undo it.
    deps.resizePty(id, wanted.get(id) ?? target);
    if (!holdsNewest(id, ticket)) return; // a newer check owns the verification now
    await wait(nudgeMs);
    const after = await deps.windowSizeOf(id);
    if (after && !sizesAgree(after, target)) deps.onEvent({ kind: "still-wrong", id, wanted: target, seen: after });
  }

  async function check(id: string, target: TerminalSize, ticket: number): Promise<void> {
    const seen = await deps.windowSizeOf(id);
    if (!holdsNewest(id, ticket)) return;
    if (!seen || sizesAgree(seen, target)) return;
    await nudge(id, target, seen, ticket);
  }

  /** Drop a settling check, and abandon one that has already started. */
  function cancel(id: string): void {
    const timer = pending.get(id);
    if (timer !== undefined) clearTimeout(timer);
    pending.delete(id);
    nextTicket(id);
  }

  /** Call on every resize frame; only the last of a burst is acted on. */
  function requestCheck(id: string, target: TerminalSize): void {
    const timer = pending.get(id);
    if (timer !== undefined) clearTimeout(timer);
    wanted.set(id, target);
    const ticket = nextTicket(id);
    pending.set(
      id,
      setTimeout(() => {
        pending.delete(id);
        // A probe that throws must not take the process down with it — the session is still fine,
        // it just keeps the screen it has until the next resize.
        check(id, target, ticket).catch(() => {});
      }, settleMs),
    );
  }

  return { requestCheck, cancel };
}

export type TmuxSizeSync = ReturnType<typeof createTmuxSizeSync>;
