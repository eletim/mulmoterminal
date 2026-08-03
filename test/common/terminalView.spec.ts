import { describe, expect, it } from "vitest";
import { isTerminalSessionScreen, isTerminalSessionSummary, isTerminalSessionsResponse, resumeTargetForSessionAgent } from "../../common/terminalView";

const ID = "123e4567-e89b-12d3-a456-426614174000";

describe("terminal view wire guards", () => {
  it("accepts a valid roster response with a server-chosen resume target", () => {
    expect(
      isTerminalSessionsResponse({
        sessions: [{ id: ID, title: "shell", cwd: "/repo", live: true, agent: "shell", resume: { kind: "launcher", shell: true } }],
      }),
    ).toBe(true);
  });

  it("rejects invalid ids, unknown agents, invalid resume targets and malformed quick commands", () => {
    expect(
      isTerminalSessionSummary({ id: "not-a-uuid", title: "x", cwd: "/repo", live: true, agent: "shell", resume: { kind: "launcher", shell: true } }),
    ).toBe(false);
    expect(isTerminalSessionSummary({ id: ID, title: "x", cwd: "/repo", live: true, agent: "llm", resume: { kind: "launcher", shell: true } })).toBe(false);
    expect(isTerminalSessionSummary({ id: ID, title: "x", cwd: "/repo", live: true, agent: "shell", resume: { kind: "agent", agent: "shell" } })).toBe(false);
    expect(isTerminalSessionScreen({ screen: "x", suggestion: "", quickCommands: [{ label: "bad" }] })).toBe(false);
  });

  it("keeps screen as plain text data and validates optional metadata as strings", () => {
    expect(isTerminalSessionScreen({ screen: "<b>plain</b>", suggestion: "", quickCommands: [], cwd: "/repo", branch: "main", memo: "m" })).toBe(true);
    expect(isTerminalSessionScreen({ screen: "x", suggestion: "", quickCommands: [], prompt: 123 })).toBe(false);
  });

  it("maps shell and unknown sessions to launcher reattach, and agents to their own endpoint", () => {
    expect(resumeTargetForSessionAgent("shell")).toEqual({ kind: "launcher", shell: true });
    expect(resumeTargetForSessionAgent(null)).toEqual({ kind: "launcher", shell: true });
    expect(resumeTargetForSessionAgent("codex")).toEqual({ kind: "agent", agent: "codex" });
  });
});
