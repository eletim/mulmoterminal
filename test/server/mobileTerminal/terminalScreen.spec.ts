// @vitest-environment node
import { describe, it, expect, vi } from "vitest";

import {
  SCREEN_HISTORY_ROWS,
  buildScreenMeta,
  buildSessionList,
  captureSessionScreen,
  definedScreenMeta,
  screenWindow,
  sessionFallbackTitle,
  type CaptureScreenDeps,
  type ScreenMetaSources,
  type SessionListCoreSession,
  type SessionListInput,
} from "../../../server/mobileTerminal/terminalScreen.js";
import { homedir } from "node:os";
import type { ScreenRow } from "../../../server/session/screen-rows.js";
import { sessionDisplayName } from "../../../common/sessionMemo.js";

const ESC = String.fromCharCode(0x1b);
const undefinedPaths = (value: unknown, path = "$"): string[] => {
  if (value === undefined) return [path];
  if (Array.isArray(value)) return value.flatMap((entry, index) => undefinedPaths(entry, `${path}[${index}]`));
  if (!value || typeof value !== "object") return [];
  return Object.entries(value).flatMap(([key, entry]) => undefinedPaths(entry, `${path}.${key}`));
};

const coreSession = (id: string, over: Partial<SessionListCoreSession> = {}): SessionListCoreSession => ({
  id,
  exited: false,
  title: id,
  cwd: "/w",
  agent: "shell",
  ...over,
});

const listInput = (over: Partial<SessionListInput> = {}): SessionListInput => ({ sessions: [], ...over });

describe("buildSessionList", () => {
  it("returns nothing when there are no sessions", () => {
    expect(buildSessionList(listInput())).toEqual([]);
  });

  // The phone offers shell command suggestions only where they make sense, so it has
  // to be able to tell a zsh session from an agent — and to tell "unknown" apart from
  // both (mulmoserver#84).
  it("carries what each session is running, and null when the host cannot tell", () => {
    const sessions = buildSessionList(listInput({ sessions: [coreSession("a"), coreSession("b", { agent: "claude" }), coreSession("c", { agent: null })] }));
    expect(sessions.map((session) => [session.id, session.agent])).toEqual([
      ["a", "shell"],
      ["b", "claude"],
      ["c", null],
    ]);
  });

  it("cannot create or change Core rows from viewer occupancy", () => {
    const viewerIds = new Set(["a", "viewer-only"]);
    const sessions = buildSessionList(listInput({ sessions: [coreSession("a"), coreSession("b")] }));
    expect(sessions).toEqual([
      { id: "a", title: "a", cwd: "/w", live: true, inputAvailable: true, agent: "shell" },
      { id: "b", title: "b", cwd: "/w", live: true, inputAvailable: true, agent: "shell" },
    ]);
    expect(viewerIds.has("a")).toBe(true);
    expect(sessions.some((session) => session.id === "viewer-only")).toBe(false);
  });

  it("derives input capability from Core native lifecycle, not viewer presence", () => {
    const sessions = buildSessionList(
      listInput({
        sessions: [coreSession("running-viewed"), coreSession("running-detached"), coreSession("exited", { exited: true })],
      }),
    );
    expect(sessions.map((session) => [session.id, session.live, session.inputAvailable])).toEqual([
      ["running-detached", true, true],
      ["running-viewed", true, true],
      ["exited", false, false],
    ]);
  });

  it("keeps every Core member even when presentation metadata is nameless", () => {
    const sessions = buildSessionList(listInput({ sessions: [coreSession("nameless", { exited: true, title: "", cwd: "", agent: null })] }));
    expect(sessions).toEqual([{ id: "nameless", title: "terminal session", cwd: "", live: false, inputAvailable: false, agent: null }]);
  });

  // Live earns a row regardless: the fallback names what is running and where, without exposing
  // the UUID as the title.
  it("keeps a nameless live shell labelled by agent and home-derived directory, not by its id", () => {
    const id = "11111111-1111-1111-1111-111111111111";
    const cwd = `${homedir()}/DevEnv/dev/mulmoterminal`;
    const sessions = buildSessionList(listInput({ sessions: [coreSession(id, { title: "", cwd })] }));
    expect(sessions).toEqual([{ id, title: "shell DevEnv", cwd, live: true, inputAvailable: true, agent: "shell" }]);
  });

  it("uses a last prompt title for a live session instead of falling back to its id", () => {
    const id = "11111111-1111-1111-1111-111111111111";
    const sessions = buildSessionList(
      listInput({
        sessions: [coreSession(id, { title: sessionDisplayName(null, null, "fix the login bug", undefined), cwd: "/repo", agent: "claude" })],
      }),
    );
    expect(sessions[0]).toMatchObject({ id, title: "fix the login bug" });
  });

  it("does not replace a known non-empty title with the fallback", () => {
    const id = "11111111-1111-1111-1111-111111111111";
    const sessions = buildSessionList(listInput({ sessions: [coreSession(id, { title: "Known title", cwd: `${homedir()}/DevEnv/app`, agent: "codex" })] }));
    expect(sessions[0]).toMatchObject({ id, title: "Known title" });
  });

  // A session that outlived a host restart keeps its recorded title, so it stays offerable.
  it("keeps a named session that is no longer live", () => {
    const sessions = buildSessionList(listInput({ sessions: [coreSession("survivor", { exited: true, title: "Overnight build", agent: null })] }));
    expect(sessions.map((session) => session.title)).toEqual(["Overnight build"]);
  });

  it("orders live sessions first, then by title", () => {
    const titles: Record<string, string> = { z: "zulu", a: "alpha", m: "mike" };
    const sessions = buildSessionList(
      listInput({
        sessions: [
          coreSession("z", { title: titles.z }),
          coreSession("a", { exited: true, title: titles.a }),
          coreSession("m", { exited: true, title: titles.m }),
        ],
      }),
    );
    expect(sessions.map((s) => s.title)).toEqual(["zulu", "alpha", "mike"]);
  });

  it("carries the per-session title and cwd through", () => {
    const sessions = buildSessionList(listInput({ sessions: [coreSession("a", { title: "Fix the parser", cwd: "/repo" })] }));
    expect(sessions[0]).toMatchObject({ title: "Fix the parser", cwd: "/repo" });
  });
});

describe("sessionFallbackTitle", () => {
  it("uses the first directory under HOME as the fallback path name", () => {
    expect(sessionFallbackTitle("shell", "/home/eletim/DevEnv/dev/mulmoterminal", "/home/eletim")).toBe("shell DevEnv");
    expect(sessionFallbackTitle("codex", "/home/eletim/napoleon_ws/worktrees/foo", "/home/eletim")).toBe("codex napoleon_ws");
  });

  it("uses ~ when the cwd is HOME itself", () => {
    expect(sessionFallbackTitle("shell", "/home/eletim", "/home/eletim")).toBe("shell ~");
  });

  it("does not fall back to a UUID-shaped title when cwd is unknown", () => {
    expect(sessionFallbackTitle("shell", "", "/home/eletim")).toBe("shell session");
  });

  it("uses and truncates the display path outside HOME", () => {
    const out = sessionFallbackTitle("codex", "/srv/very/long/customer/workspaces/product/backend/services/auth/handlers", "/home/eletim", 32);
    expect(out).toMatch(/^codex …/);
    expect(out).toHaveLength(32);
    expect(out.endsWith("services/auth/handlers")).toBe(true);
  });

  it("does not treat a HOME-prefix lookalike as being inside HOME", () => {
    expect(sessionFallbackTitle("shell", "/home/eletim-other/project", "/home/eletim")).toBe("shell /home/eletim-other/project");
  });
});

const plainRows = (texts: readonly string[]): ScreenRow[] => texts.map((text) => ({ text, dim: "" }));

// The window the phone is shown: the newest SCREEN_HISTORY_ROWS rows, under a byte ceiling.
// Both capture paths hand their rows through this, so tmux and the fallback renderer answer
// the same session identically (mulmoserver#139).
describe("screenWindow", () => {
  it("keeps a short screen whole", () => {
    expect(screenWindow(plainRows(["one", "two", "three"])).map((row) => row.text)).toEqual(["one", "two", "three"]);
  });

  // Oldest-first, because the live prompt, the ghost text and any menu are all at the bottom.
  it("drops the oldest rows once the history is longer than the window", () => {
    const rows = screenWindow(plainRows(Array.from({ length: SCREEN_HISTORY_ROWS + 50 }, (_, index) => `line-${index}`)));
    expect(rows).toHaveLength(SCREEN_HISTORY_ROWS);
    expect(rows[0].text).toBe("line-50");
    expect(rows.at(-1)?.text).toBe(`line-${SCREEN_HISTORY_ROWS + 49}`);
  });

  // The blanks below the last line are the unused part of the pane. Counting them would spend
  // the window on emptiness — a session using two rows of a 40-row pane would lose 38 real ones.
  it("spends the window on content rather than on the pane's empty rows", () => {
    const rows = screenWindow(plainRows([...Array.from({ length: SCREEN_HISTORY_ROWS + 10 }, (_, index) => `line-${index}`), ...Array(38).fill("")]));
    expect(rows).toHaveLength(SCREEN_HISTORY_ROWS);
    expect(rows.at(-1)?.text).toBe(`line-${SCREEN_HISTORY_ROWS + 9}`);
  });

  // The mobile screen response still needs a byte ceiling. Only an unusually wide pane can reach
  // this — 300 rows of a 200-column pane is well under it.
  it("stops at the byte ceiling even when the row count would allow more", () => {
    const wide = "あ".repeat(2000); // 6 KB per row: 300 of them would be 1.8 MB
    const rows = screenWindow(plainRows(Array.from({ length: SCREEN_HISTORY_ROWS }, (_, index) => `${index}:${wide}`)));
    expect(rows.length).toBeLessThan(SCREEN_HISTORY_ROWS);
    expect(rows.reduce((bytes, row) => bytes + Buffer.byteLength(row.text, "utf8") + 1, 0)).toBeLessThanOrEqual(256 * 1024);
    // Truncated from the top: the newest row is the one that must survive.
    expect(rows.at(-1)?.text.startsWith(`${SCREEN_HISTORY_ROWS - 1}:`)).toBe(true);
  });

  // A row too big for the ceiling on its own must END the window, not be skipped over — the
  // rows above it would leave the phone a window with a hole in the middle of it.
  it("stops at an oversized row instead of stepping over it", () => {
    const rows = screenWindow(plainRows(["ancient", "あ".repeat(256 * 1024), "newest"]));
    expect(rows.map((row) => row.text)).toEqual(["newest"]);
  });

  it("survives a session with nothing on screen at all", () => {
    expect(screenWindow(plainRows(["", "", ""]))).toEqual([]);
    expect(screenWindow([])).toEqual([]);
  });
});

const captureDeps = (over: Partial<CaptureScreenDeps> = {}): CaptureScreenDeps => ({
  captureStyledPane: () => "core screen",
  ...over,
});

describe("captureSessionScreen", () => {
  it("renders the Core/tmux screen even while detached", async () => {
    const captured = await captureSessionScreen("a", captureDeps({ captureStyledPane: () => "from tmux\n\n" }));
    expect(captured.screen).toBe("from tmux");
  });

  it("reports not-found when Core/tmux has no session, regardless of viewer replay state", async () => {
    const depsWithLegacyViewerFallback = {
      ...captureDeps({ captureStyledPane: () => null }),
      sourceOf: () => ({ buffer: "viewer replay", cols: 80, rows: 24 }),
      render: async () => [{ text: "must not render", dim: "" }],
    };
    await expect(captureSessionScreen("gone", depsWithLegacyViewerFallback)).rejects.toThrow(/'gone' not found/);
  });

  // An empty pane is a real Core answer, not a miss.
  it("treats an empty tmux capture as authoritative", async () => {
    expect((await captureSessionScreen("a", captureDeps({ captureStyledPane: () => "" }))).screen).toBe("");
  });

  // The phone has no Tab key, so the agent's ghost text has to arrive as its own value.
  it("hands the agent's dim suggestion over beside the screen", async () => {
    const styled = `${ESC}[38;5;246m────${ESC}[39m\n${ESC}[39m❯ ${ESC}[2mwrite the tests${ESC}[0m\n${ESC}[38;5;246m────${ESC}[39m`;
    const captured = await captureSessionScreen("a", captureDeps({ captureStyledPane: () => styled }));
    expect(captured).toEqual({ screen: "────\n❯ write the tests\n────", suggestion: "write the tests", quickCommands: [] });
  });

  it("reports no suggestion when the Core screen has none", async () => {
    expect((await captureSessionScreen("a", captureDeps())).suggestion).toBe("");
  });

  // The phone's per-session view heads the screen with the same four things the grid cell
  // shows (#786) — read for the session being captured, and only for that one.
  it("carries the session's cwd, branch, summary and prompt beside the screen", async () => {
    const metaOf = vi.fn(async () => ({ cwd: "/repo", branch: "feat/786", summary: "Adding meta", prompt: "add branch to the phone view" }));
    const captured = await captureSessionScreen("a", captureDeps({ metaOf }));
    expect(captured).toEqual({
      screen: "core screen",
      suggestion: "",
      quickCommands: [],
      cwd: "/repo",
      branch: "feat/786",
      summary: "Adding meta",
      prompt: "add branch to the phone view",
    });
    expect(metaOf).toHaveBeenCalledWith("a");
  });

  // The user's own note travels BESIDE the AI summary rather than in place of it (#1110). The
  // picker's row overwrites `title` with the memo because a row there is one line, but the
  // header draws each field as its own labelled row — a memo shown as the AI's summary is
  // mislabelled, so the asymmetry between the two routes is the point, not an oversight.
  it("carries the user's memo alongside the AI summary", async () => {
    const captured = await captureSessionScreen(
      "a",
      captureDeps({ metaOf: async () => ({ summary: "Adding meta to the phone view", memo: "ask Tom before merging" }) }),
    );
    expect(captured.memo).toBe("ask Tom before merging");
    expect(captured.summary).toBe("Adding meta to the phone view");
  });

  // A session with no note is the common case, and it must look exactly like a host built
  // before #1110: no `memo` key at all, so the phone draws no empty memo row.
  it("drops the memo row for a session the user never wrote a note on", async () => {
    const captured = await captureSessionScreen("a", captureDeps({ metaOf: async () => ({ summary: "Adding meta", memo: "" }) }));
    expect(Object.hasOwn(captured, "memo")).toBe(false);
    expect(captured.summary).toBe("Adding meta");
  });

  // A host that answers nothing looks exactly like one built before #786 — the phone
  // renders the screen alone.
  it("sends only the screen when the host has no metadata to add", async () => {
    const captured = await captureSessionScreen("a", captureDeps({ metaOf: async () => ({ cwd: "", branch: "", memo: "", summary: "", prompt: "" }) }));
    expect(captured).toEqual({ screen: "core screen", suggestion: "", quickCommands: [] });
  });

  it("sends only the screen when no metadata reader is wired at all", async () => {
    expect(await captureSessionScreen("a", captureDeps())).toEqual({ screen: "core screen", suggestion: "", quickCommands: [] });
  });

  // Metadata decorates the screen: a git call that blew up or a dir that has since been
  // deleted must not cost the phone the terminal output it asked for.
  it("still returns the screen when reading the metadata throws", async () => {
    const metaOf = vi.fn(async () => {
      throw new Error("git exploded");
    });
    expect(await captureSessionScreen("a", captureDeps({ metaOf }))).toEqual({ screen: "core screen", suggestion: "", quickCommands: [] });
  });
});

// The phone renders one labelled row per field it receives, so fields with no value must disappear
// rather than arrive as `undefined`.
describe("definedScreenMeta", () => {
  it("keeps the fields the host could answer", () => {
    const meta = { cwd: "/repo", branch: "main", memo: "ask Tom first", summary: "Fix the parser", prompt: "fix it" };
    expect(definedScreenMeta(meta)).toEqual(meta);
  });

  it("drops a field the host has no value for, key and all", () => {
    expect(definedScreenMeta({ cwd: "/repo", branch: undefined, summary: "", prompt: "   " })).toEqual({ cwd: "/repo" });
    expect(Object.keys(definedScreenMeta({ cwd: "/repo", branch: undefined }))).toEqual(["cwd"]);
  });

  it("returns nothing for an empty read", () => {
    expect(definedScreenMeta({})).toEqual({});
  });

  // The phone's whole rule for the GitHub link is "render it if the key is there" (#832), so
  // a dir that isn't a GitHub repo must lose the key rather than arrive as "".
  // The value is the repository ROOT, never a /tree/<branch>: a branch URL 404s whenever the
  // branch is gone from GitHub, which the host cannot see — refs/remotes/origin/* is a local
  // cache that outlives a branch deleted at merge time.
  it("drops githubUrl for a dir the host can't place on GitHub, and keeps a real one", () => {
    expect(definedScreenMeta({ cwd: "/repo", githubUrl: "" })).toEqual({ cwd: "/repo" });
    expect(definedScreenMeta({ cwd: "/repo", githubUrl: "https://github.com/o/r" })).toEqual({
      cwd: "/repo",
      githubUrl: "https://github.com/o/r",
    });
  });

  // Emptiness is judged on the trimmed value, but the value itself is passed through as-is:
  // a prompt's own leading spaces are the user's text, not ours to edit.
  it("passes a value with surrounding whitespace through unchanged", () => {
    expect(definedScreenMeta({ prompt: "  fix it  " })).toEqual({ prompt: "  fix it  " });
  });
});

// The join behind the phone's header. Injected sources rather than the server's tables, so the
// ORDER of the reads is assertable — which is the part a reader cannot verify by looking at the
// answer (CodeRabbit asked for this on #1112).
describe("buildScreenMeta", () => {
  const sources = (over: Partial<ScreenMetaSources> = {}): ScreenMetaSources => ({
    cwdOf: () => "/repo",
    branchOf: async () => "feat/1110",
    githubUrlOf: async () => "https://github.com/o/r",
    memoOf: () => "ask Tom before merging",
    summaryOf: () => "Adding meta to the phone view",
    promptOf: () => "add the memo",
    memosHydrated: Promise.resolve(),
    ...over,
  });

  it("heads the screen with everything the host could answer", async () => {
    expect(await buildScreenMeta("a", sources())).toEqual({
      cwd: "/repo",
      branch: "feat/1110",
      memo: "ask Tom before merging",
      summary: "Adding meta to the phone view",
      prompt: "add the memo",
      githubUrl: "https://github.com/o/r",
    });
  });

  // THE regression this seam exists for. The memo lives only in the server's map, and that map is
  // filled by a boot read of the append log: reading it first answers "" for every session, which
  // the phone cannot tell apart from the user having erased the note.
  it("reads the memo only after the memo store has hydrated", async () => {
    const order: string[] = [];
    let hydrate = () => {};
    const memosHydrated = new Promise<void>((resolve) => {
      hydrate = () => {
        order.push("hydrated");
        resolve();
      };
    });
    const pending = buildScreenMeta(
      "a",
      sources({
        memosHydrated,
        memoOf: () => {
          order.push("memoOf");
          return "ask Tom before merging";
        },
      }),
    );
    // A full turn of the event loop, not one microtask: every other source here resolves
    // immediately, so without the barrier the memo would already have been read by now — which
    // is what makes this assertion fail if the await is ever dropped.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(order).toEqual([]);
    hydrate();
    expect((await pending).memo).toBe("ask Tom before merging");
    expect(order).toEqual(["hydrated", "memoOf"]);
  });

  // The branch lookup shells out to git, and so does the GitHub remote read. Sequencing them
  // would double the latency of a screen the phone polls.
  it("runs the two git reads concurrently", async () => {
    const order: string[] = [];
    await buildScreenMeta(
      "a",
      sources({
        branchOf: async () => {
          order.push("branch:start");
          await Promise.resolve();
          order.push("branch:end");
          return "main";
        },
        githubUrlOf: async () => {
          order.push("github:start");
          return null;
        },
      }),
    );
    expect(order).toEqual(["branch:start", "github:start", "branch:end"]);
  });

  // A session that outlived a restart has no PtyEntry, so the host has no dir for it. Spawning
  // git against "" would ask about THIS process's cwd — an answer from the wrong repository.
  it("asks git nothing when the host has no directory for the session", async () => {
    const branchOf = vi.fn(async () => "main");
    const githubUrlOf = vi.fn(async () => "https://github.com/o/r");
    expect(await buildScreenMeta("a", sources({ cwdOf: () => "", branchOf, githubUrlOf }))).toEqual({
      memo: "ask Tom before merging",
      summary: "Adding meta to the phone view",
      prompt: "add the memo",
    });
    expect(branchOf).not.toHaveBeenCalled();
    expect(githubUrlOf).not.toHaveBeenCalled();
  });

  // A detached HEAD has no branch name, and a session with no note has no memo: both lose the
  // key rather than arriving as "", which the phone would draw as an empty labelled row.
  it("drops what the host could not answer, key and all", async () => {
    const meta = await buildScreenMeta("a", sources({ branchOf: async () => null, memoOf: () => "", githubUrlOf: async () => null }));
    expect(meta).toEqual({ cwd: "/repo", summary: "Adding meta to the phone view", prompt: "add the memo" });
    expect(Object.hasOwn(meta, "memo")).toBe(false);
    expect(Object.hasOwn(meta, "branch")).toBe(false);
  });
});

// The regression itself (#1042). `expect(s.work).toBeUndefined()` passes for BOTH shapes, so it
// has to be `Object.hasOwn` — the broken form is a present key HOLDING undefined, which would
// leak an invalid shape rather than just omitting that field.
//
// Asserted against core's own `undefinedPaths` because core is what guards this write now (#1064):
// the check and the shipping guard are then the same code, not two descriptions of one rule.
describe("buildSessionList — defined JSON shape (#1042)", () => {
  const WORK = { pr: 987, issue: 979, phase: "ready" as const, headline: "hi" };

  const listWith = (work: Map<string, typeof WORK>) =>
    buildSessionList({
      sessions: ["with-work", "without-work"].map((id) => {
        const summary = work.get(`/work/${id}`);
        return { id, exited: false, title: `session ${id}`, cwd: `/work/${id}`, agent: "claude" as const, ...(summary ? { work: summary } : {}) };
      }),
    });

  it("omits the key entirely for a session with no work item", () => {
    const bare = listWith(new Map([["/work/with-work", WORK]])).find((session) => session.id === "without-work");
    expect(bare).toBeDefined();
    expect(bare && Object.hasOwn(bare, "work")).toBe(false);
  });

  it("still carries the work item for the session that has one", () => {
    expect(listWith(new Map([["/work/with-work", WORK]])).find((session) => session.id === "with-work")?.work).toEqual(WORK);
  });

  // The end-to-end statement: whatever the mix, the reply contains no undefined values.
  it("produces a list core's guard finds nothing to strip in", () => {
    expect(undefinedPaths({ sessions: listWith(new Map([["/work/with-work", WORK]])) })).toEqual([]);
    expect(undefinedPaths({ sessions: listWith(new Map()) })).toEqual([]);
  });
});
