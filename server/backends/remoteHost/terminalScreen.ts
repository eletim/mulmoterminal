// The session picker + screen read behind the phone's remote terminal view (#435).
//
// Both entry points are dependency-injected and free of server/index.ts internals, so the
// join rules and the capture fallback are unit-testable without a live PTY or tmux.
import { parseStyledRows, rowsToScreen, suggestionFromRows, type ScreenRow } from "../../session/screen-rows.js";

// What is running in a session, so the phone can offer input that suits it: shell
// command suggestions are useful in zsh and meaningless to an agent that reads prose
// (mulmoserver#84). Null when the host cannot tell — a session that outlived a restart
// exists only in tmux, and nothing recorded what launched it.
export type SessionAgent = "claude" | "codex" | "shell";

// Map a tmux pane's current command onto the kinds the phone knows. Anything else is a
// shell or a one-off program the phone has no special input for — "shell" is the right
// answer for both, since that is where typed commands belong.
const AGENT_COMMANDS: Record<string, SessionAgent> = { claude: "claude", codex: "codex" };

export const agentFromPaneCommand = (command: string | null): SessionAgent | null => {
  if (!command) {
    return null;
  }
  return AGENT_COMMANDS[command] ?? "shell";
};

export interface TerminalSessionSummary {
  id: string;
  title: string;
  cwd: string;
  // A PTY is attached in THIS server process. False means the session exists only in tmux
  // (it outlived a restart) — still viewable, since capture-pane doesn't need our process.
  live: boolean;
  // What is running in it, or null when unknown (see SessionAgent). A tmux-only
  // session is always null: the process that knew is gone.
  agent: SessionAgent | null;
}

export interface SessionDetail {
  // Empty when the host has no name for this session — neither an AI-generated title
  // nor a recorded one. Such a session is dropped unless it is live (see below).
  title: string;
  cwd: string;
  agent: SessionAgent | null;
}

export interface SessionListInput {
  liveIds: readonly string[];
  tmuxIds: readonly string[];
  // Excludes sessions an orphan cleanup would reap — without it the picker fills with
  // long-dead tmux shells (66 of them on the author's machine when this was written).
  isResumable: (id: string) => boolean;
  // Keeps only multi-terminal GRID sessions (the dev-terminal set). The phone drives the
  // grid's cells, so the single-view chat session and any tmux shell that was never a grid
  // cell are excluded — even while they are live and resumable.
  isGridSession: (id: string) => boolean;
  detailOf: (id: string) => SessionDetail;
}

// Live sessions first, then by title, so the phone's list is stable across polls.
const byLiveThenTitle = (a: TerminalSessionSummary, b: TerminalSessionSummary): number =>
  a.live === b.live ? a.title.localeCompare(b.title) : Number(b.live) - Number(a.live);

// Resumable is the right rule for "don't reap this", but too weak for "offer this":
// it keeps every session with a transcript on disk, which on a working machine is
// dozens of long-finished ones the host can no longer name. A row showing nothing but
// a UUID is not a choice the user can make, so a nameless session earns its place only
// by being live — where the id at least identifies something currently running.
export function buildSessionList({ liveIds, tmuxIds, isResumable, isGridSession, detailOf }: SessionListInput): TerminalSessionSummary[] {
  const live = new Set(liveIds);
  const ids = [...new Set([...liveIds, ...tmuxIds])].filter(isResumable).filter(isGridSession);
  return ids
    .map((id) => ({ id, ...detailOf(id), live: live.has(id) }))
    .filter((session) => session.title !== "" || session.live)
    .map((session) => ({ ...session, title: session.title || session.id }))
    .sort(byLiveThenTitle);
}

export interface ScreenSource {
  buffer: string;
  cols: number;
  rows: number;
}

export interface CaptureScreenDeps {
  captureStyledPane: (id: string) => string | null;
  sourceOf: (id: string) => ScreenSource | undefined;
  render: (input: ScreenSource) => Promise<ScreenRow[]>;
  // What the grid cell's header shows for this session, for the phone to head the screen
  // with (#786). Optional: a host that can't answer any of it just sends the screen.
  metaOf?: (id: string) => Promise<SessionScreenMeta>;
}

// The session's identity around the screen — the dir it runs in, that dir's git branch, the
// AI summary of the session, and the prompt that started the latest turn (mulmoserver#107).
// Every field is optional: a session that outlived a restart has no PTY left, so the host
// knows none of them.
export interface SessionScreenMeta {
  cwd?: string;
  branch?: string;
  summary?: string;
  prompt?: string;
  // The dir's page on GitHub, so the phone can link out to it (#832). Absent for every dir
  // the host can't place there — not a repo, no origin, or an origin that isn't github.com
  // — which is why the phone only ever has to decide "link or no link".
  githubUrl?: string;
}

export interface SessionScreen extends SessionScreenMeta {
  screen: string;
  // The follow-up prompt the agent is offering as dim ghost text, "" when it offers none.
  // The phone cannot press Tab to accept it, so it is handed over as its own value for
  // the phone to offer as a chip (#563).
  suggestion: string;
}

// A field the host can't answer is dropped entirely rather than sent as "": the response is
// written to a Firestore command doc, which rejects an `undefined` value outright, and the
// phone renders each field it receives as its own labelled row — an empty one would read as
// "this session has no branch" instead of "not known".
export function definedScreenMeta(meta: SessionScreenMeta): SessionScreenMeta {
  return Object.fromEntries(Object.entries(meta).filter(([, value]) => value !== undefined && value.trim() !== ""));
}

// tmux first: it renders the real screen, works while detached, and survives a restart.
// Falling back to the in-process buffer covers the tmux-less host, the non-persistent
// spawn, AND the race where the session ends between listing and reading.
const screenRowsOf = async (id: string, { captureStyledPane, sourceOf, render }: CaptureScreenDeps): Promise<ScreenRow[]> => {
  const captured = captureStyledPane(id);
  if (captured !== null) return parseStyledRows(captured);
  const source = sourceOf(id);
  if (!source) throw new Error(`terminal session '${id}' not found`);
  return render(source);
};

// The metadata decorates the screen, so a failure reading it (a git call that blew up, a dir
// that has since been deleted) costs those fields — never the terminal output itself.
const screenMetaOf = async (id: string, metaOf: CaptureScreenDeps["metaOf"]): Promise<SessionScreenMeta> => {
  if (!metaOf) return {};
  try {
    return definedScreenMeta(await metaOf(id));
  } catch {
    return {};
  }
};

export async function captureSessionScreen(id: string, deps: CaptureScreenDeps): Promise<SessionScreen> {
  // Concurrently: the meta read shells out to git, which is otherwise pure latency added to
  // every screen the phone pulls.
  const [rows, meta] = await Promise.all([screenRowsOf(id, deps), screenMetaOf(id, deps.metaOf)]);
  return { screen: rowsToScreen(rows).trimEnd(), suggestion: suggestionFromRows(rows), ...meta };
}
