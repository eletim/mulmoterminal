import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import CellLaunchForm from "../../../src/components/CellLaunchForm.vue";
import type { LaunchAgent } from "../../../common/launchAgent";

// The launcher's two "there is already a session here" surfaces, mounted directly: a worktree row
// (one branch, one session) and a resume row. Both used to hand a running agent's terminal to a
// second cell — the worktree row by starting a second agent in the same working tree, the resume
// row by confirming its way past a badge that could not see another tab or another process
// (#1207).

type WorktreeRow = { path: string; branch: string | null; task: string; dirty: boolean; session?: unknown };
type SessionRow = { id: string; title: string; mtime: number; attached?: boolean };

function mockFetch(worktrees: WorktreeRow[] = [], sessions: SessionRow[] = []) {
  globalThis.fetch = vi.fn(async (url: string) => {
    const u = String(url);
    if (u.includes("/api/worktrees")) return { ok: true, json: async () => ({ isGit: true, base: "main", worktrees }) };
    if (u.includes("/api/sessions")) return { ok: true, json: async () => ({ cwd: "/repo", sessions }) };
    return { ok: true, json: async () => ({}) };
  }) as unknown as typeof fetch;
}

const mountForm = (openSessionIds: string[] = [], over: { dir?: string; presets?: { label: string; path: string }[]; target?: LaunchAgent } = {}) =>
  mount(CellLaunchForm, {
    props: { dir: "/repo", target: "claude" as LaunchAgent, choice: null, defaultCwd: "/repo", presets: [], openSessionIds, ...over },
    global: { stubs: { ModelPicker: true } },
  });

const worktree = (over: Partial<WorktreeRow> = {}): WorktreeRow => ({ path: "/wt/fix-login", branch: "fix-login", task: "fix-login", dirty: false, ...over });

beforeEach(() => mockFetch());

describe("a worktree row", () => {
  it("starts a session when the worktree has none", async () => {
    mockFetch([worktree({ session: null })]);
    const w = mountForm();
    await flushPromises();
    const row = w.find('[data-testid="worktree-reuse"]');
    expect(row.find('[data-testid="wt-resume"]').exists()).toBe(false);
    expect(row.find('[data-testid="wt-busy"]').exists()).toBe(false);
    await row.trigger("click");
    await flushPromises();
    expect(w.emitted("start")?.[0]).toEqual(["/wt/fix-login"]);
    expect(w.emitted("resume")).toBeUndefined();
  });

  // The one-session rule in action: continuing the worktree's own conversation rather than opening
  // a second agent beside it. The agent travels so the cell connects the endpoint that session IS.
  it("resumes the worktree's session when nobody is holding it", async () => {
    mockFetch([worktree({ session: { id: "s-1", attached: false, agent: "codex" } })]);
    const w = mountForm();
    await flushPromises();
    const row = w.find('[data-testid="worktree-reuse"]');
    expect(row.find('[data-testid="wt-resume"]').exists()).toBe(true);
    await row.trigger("click");
    await flushPromises();
    expect(w.emitted("resume")?.[0]).toEqual([{ id: "s-1", cwd: "/wt/fix-login", agent: "codex" }]);
    expect(w.emitted("start")).toBeUndefined();
  });

  it("refuses a worktree whose session is open in another terminal", async () => {
    mockFetch([worktree({ session: { id: "s-1", attached: true, agent: "claude" } })]);
    const w = mountForm();
    await flushPromises();
    const row = w.find('[data-testid="worktree-reuse"]');
    expect(row.find('[data-testid="wt-busy"]').exists()).toBe(true);
    expect(row.attributes("disabled")).toBeDefined();
    expect(row.attributes("title")).toContain("open in another terminal");
    await row.trigger("click");
    await flushPromises();
    expect(w.emitted("resume")).toBeUndefined();
    expect(w.emitted("start")).toBeUndefined();
  });

  // A page left open across an upgrade gets rows with no `session` at all. It must behave as every
  // worktree row did before this shipped, not refuse them all.
  it("starts when the server sent no session field", async () => {
    mockFetch([worktree()]);
    const w = mountForm();
    await flushPromises();
    await w.find('[data-testid="worktree-reuse"]').trigger("click");
    await flushPromises();
    expect(w.emitted("start")?.[0]).toEqual(["/wt/fix-login"]);
  });

  it("says why a worktree only ever has one session", async () => {
    mockFetch([worktree()]);
    const w = mountForm();
    await flushPromises();
    expect(w.find('[data-testid="wt-note"]').text()).toContain("one agent session");
  });
});

// A worktree is reachable without its row — the field takes any path, and launching in a worktree
// records it as a recent directory, so its chip appears too. Refusing only the row would leave the
// one-session rule holding on whichever way in the user did not take.
describe("a worktree reached without its row", () => {
  const taken = (attached = true) => worktree({ session: { id: "s-1", attached, agent: "claude" } });

  it("refuses the play button when the directory field IS a running worktree", async () => {
    mockFetch([taken()]);
    const w = mountForm([], { dir: "/wt/fix-login" });
    await flushPromises();
    expect(w.find('[data-testid="cell-dir-go"]').attributes("disabled")).toBeDefined();
    expect(w.find('[data-testid="cell-dir-busy"]').text()).toContain("open in another terminal");
    await w.find('[data-testid="cell-dir-input"]').trigger("keydown.enter");
    expect(w.emitted("start")).toBeUndefined();
  });

  // One session, not one RUNNING session: a worktree whose agent nobody is watching still has its
  // conversation, and the row is how it is continued. Starting beside it is the second session the
  // rule exists to prevent.
  it("refuses the field for a worktree whose session is merely there", async () => {
    mockFetch([taken(false)]);
    const w = mountForm([], { dir: "/wt/fix-login" });
    await flushPromises();
    expect(w.find('[data-testid="cell-dir-go"]').attributes("disabled")).toBeDefined();
    expect(w.find('[data-testid="cell-dir-busy"]').text()).toContain("resume it from its row");
    await w.find('[data-testid="cell-dir-input"]').trigger("keydown.enter");
    expect(w.emitted("start")).toBeUndefined();
  });

  // Codex, reviewing #1208: the comparison was `===`, so a path spelled another way walked past the
  // guard and started a second session in a worktree marked `in use`.
  it.each([["/wt/fix-login/"], ["/wt/./fix-login"], ["/repo/../wt/fix-login"], ["/wt//fix-login"]])(
    "refuses the same worktree spelled %s",
    async (spelling) => {
      mockFetch([taken()]);
      const w = mountForm([], { dir: spelling });
      await flushPromises();
      expect(w.find('[data-testid="cell-dir-go"]').attributes("disabled")).toBeDefined();
      await w.find('[data-testid="cell-dir-input"]').trigger("keydown.enter");
      expect(w.emitted("start")).toBeUndefined();
    },
  );

  it("still launches from the field for a worktree with no session", async () => {
    mockFetch([worktree({ session: null })]);
    const w = mountForm([], { dir: "/wt/fix-login" });
    await flushPromises();
    expect(w.find('[data-testid="cell-dir-go"]').attributes("disabled")).toBeUndefined();
    expect(w.find('[data-testid="cell-dir-busy"]').exists()).toBe(false);
    await w.find('[data-testid="cell-dir-input"]').trigger("keydown.enter");
    expect(w.emitted("start")?.[0]).toEqual(["/wt/fix-login"]);
  });

  // The limit is on AGENTS sharing one working tree. A shell is not one — dir-session.ts leaves
  // shells out of the answer for the same reason — so it can still be opened there.
  it("lets a shell open in a worktree an agent is in", async () => {
    mockFetch([taken()]);
    const w = mountForm([], { dir: "/wt/fix-login", target: "shell" });
    await flushPromises();
    expect(w.find('[data-testid="cell-dir-go"]').attributes("disabled")).toBeUndefined();
    await w.find('[data-testid="cell-dir-input"]').trigger("keydown.enter");
    expect(w.emitted("start")?.[0]).toEqual(["/wt/fix-login"]);
  });

  // The chip fills the field instead of launching, which is what puts the reason on screen — a
  // play button that silently does nothing reads as a broken app.
  it("fills the field rather than launching when a chip points at a taken worktree", async () => {
    mockFetch([taken()]);
    const w = mountForm([], { presets: [{ label: "fix-login", path: "/wt/fix-login" }] });
    await flushPromises();
    await w.find('[data-testid="cell-chip-launch"]').trigger("click");
    expect(w.emitted("start")).toBeUndefined();
    expect(w.emitted("update:dir")?.at(-1)).toEqual(["/wt/fix-login"]);
  });

  // The refused chip is the one case a screen-reader user cannot fall back on the greyed-out field
  // below to explain itself, so the reason has to be on the control (CodeRabbit).
  it("tells a screen reader why the chip will not launch", async () => {
    mockFetch([taken()]);
    const w = mountForm([], { presets: [{ label: "fix-login", path: "/wt/fix-login" }] });
    await flushPromises();
    const label = w.find('[data-testid="cell-chip-launch"]').attributes("aria-label") ?? "";
    expect(label).toContain("fix-login");
    expect(label).toContain("open in another terminal");
  });

  it("launches from a chip on an ordinary directory", async () => {
    mockFetch([taken()]);
    const w = mountForm([], { presets: [{ label: "repo", path: "/repo" }] });
    await flushPromises();
    await w.find('[data-testid="cell-chip-launch"]').trigger("click");
    expect(w.emitted("start")?.[0]).toEqual(["/repo"]);
  });
});

describe("a resume row", () => {
  const row = (over: Partial<SessionRow> = {}): SessionRow => ({ id: "s-9", title: "fix the parser", mtime: 1, ...over });

  it("resumes a session nobody is holding", async () => {
    mockFetch([], [row()]);
    const w = mountForm();
    await flushPromises();
    await w.find('[data-testid="cell-resume-item"]').trigger("click");
    expect(w.emitted("resume")?.[0]).toEqual([{ id: "s-9", cwd: "/repo" }]);
  });

  // The case the grid's own list is blind to: the other viewer is a second browser tab or a second
  // mulmoterminal process, so only the server can say.
  it("refuses a session the server reports as attached, even with an empty grid list", async () => {
    mockFetch([], [row({ attached: true })]);
    const w = mountForm();
    await flushPromises();
    const item = w.find('[data-testid="cell-resume-item"]');
    expect(item.find('[data-testid="ri-open"]').exists()).toBe(true);
    expect(item.attributes("disabled")).toBeDefined();
    await item.trigger("click");
    expect(w.emitted("resume")).toBeUndefined();
  });

  // An older server sends no `attached`, and the cell's own knowledge of its grid is then the only
  // thing standing between a second cell and a live session.
  it("still refuses a session this grid has open when the server said nothing", async () => {
    mockFetch([], [row()]);
    const w = mountForm(["s-9"]);
    await flushPromises();
    const item = w.find('[data-testid="cell-resume-item"]');
    expect(item.attributes("disabled")).toBeDefined();
    await item.trigger("click");
    expect(w.emitted("resume")).toBeUndefined();
  });
});

// A write into the user's Claude Code config that fails has to SAY so — the checkbox goes back and
// the row reads "failed", with the reason on the hover. The branch and the hover read the same
// accessor since #1339 (the hover used to assert non-null what the branch had just tested), so
// what is pinned here is that the message still arrives at the title.
describe("an MCP group row whose write failed", () => {
  it("puts the checkbox back and carries the reason on the hover", async () => {
    globalThis.fetch = vi.fn(async (url: string, init?: RequestInit) => {
      const u = String(url);
      if (u.includes("/api/gui-mcp-groups")) {
        if (init?.method === "POST") return { ok: false, status: 500, json: async () => ({}) };
        return { ok: true, json: async () => ({ groups: [] }) };
      }
      if (u.includes("/api/worktrees")) return { ok: true, json: async () => ({ isGit: true, base: "main", worktrees: [] }) };
      if (u.includes("/api/sessions")) return { ok: true, json: async () => ({ cwd: "/repo", sessions: [] }) };
      return { ok: true, json: async () => ({}) };
    }) as unknown as typeof fetch;

    const w = mountForm();
    await flushPromises();
    const toggle = w.find<HTMLInputElement>('[data-testid="cell-mcp-toggle-render"]');
    await toggle.setValue(true);
    await flushPromises();

    const failed = w.findAll("span.text-err-text");
    expect(failed).toHaveLength(1);
    expect(failed[0].text()).toBe("failed");
    expect(failed[0].attributes("title")).toBe("HTTP 500");
    expect(toggle.element.checked).toBe(false);
  });
});
