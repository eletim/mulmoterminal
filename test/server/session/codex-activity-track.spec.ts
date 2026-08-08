// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { buildSessionList } from "../../../server/backends/remoteHost/terminalScreen.js";
import { recordCodexPromptForHeader, restoreCodexPromptBaselineForHeader, trackCodexActivity } from "../../../server/session/codex-activity-track.js";
import { LAST_PROMPT_CAP } from "../../../server/session/header-hook.js";
import { lastPrompts } from "../../../server/session/registry.js";
import { sessionDisplayName } from "../../../common/sessionMemo.js";
import { cellHeaderText } from "../../../src/components/cellActivity.js";

const SESSION = "11111111-1111-4111-8111-111111111111";
const line = (o: unknown) => JSON.stringify(o);
const started = (turnId = "t1") => line({ type: "event_msg", payload: { type: "task_started", turn_id: turnId } }) + "\n";
const userMessage = (message: string) => line({ type: "event_msg", payload: { type: "user_message", message } }) + "\n";
const responseUserMessage = (message: string) =>
  line({ type: "response_item", payload: { type: "message", role: "user", content: [{ type: "input_text", text: message }] } }) + "\n";
const environmentContext = () =>
  line({
    type: "response_item",
    payload: {
      type: "message",
      role: "user",
      content: [{ type: "input_text", text: "<environment_context>\n<context>auto</context>\n</environment_context>" }],
    },
  }) + "\n";
const complete = (turnId = "t1") => line({ type: "event_msg", payload: { type: "task_complete", turn_id: turnId, last_agent_message: "done" } }) + "\n";

async function rolloutFile(content: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "mulmo-codex-rollout-"));
  const file = join(dir, "rollout.jsonl");
  await writeFile(file, content);
  return file;
}

describe("recordCodexPromptForHeader", () => {
  beforeEach(() => {
    lastPrompts.clear();
  });

  it("records a codex rollout user prompt in the shared lastPrompts table and publishes it", () => {
    const publishActivity = vi.fn();
    recordCodexPromptForHeader(SESSION, "  fix the mobile title fallback  ", { publishActivity });

    expect(lastPrompts.get(SESSION)).toBe("fix the mobile title fallback");
    expect(publishActivity).toHaveBeenCalledWith(SESSION);
  });

  it("does not replace a meaningful prompt with a trivial follow-up", () => {
    const publishActivity = vi.fn();
    lastPrompts.set(SESSION, "implement the Codex rollout prompt tracker");

    recordCodexPromptForHeader(SESSION, "ok", { publishActivity });

    expect(lastPrompts.get(SESSION)).toBe("implement the Codex rollout prompt tracker");
    expect(publishActivity).toHaveBeenCalledWith(SESSION);
  });

  it("uses a resumed rollout baseline to protect a meaningful prompt from the first trivial follow-up", () => {
    const publishActivity = vi.fn();

    recordCodexPromptForHeader(SESSION, "ok", { publishActivity }, "implement the Codex rollout prompt tracker");

    expect(lastPrompts.get(SESSION)).toBe("implement the Codex rollout prompt tracker");
    expect(publishActivity).toHaveBeenCalledWith(SESSION);
  });

  it("caps long prompts the same way Claude hook prompt tracking does", () => {
    recordCodexPromptForHeader(SESSION, "x".repeat(LAST_PROMPT_CAP + 20), { publishActivity: vi.fn() });

    expect(lastPrompts.get(SESSION)).toBe("x".repeat(LAST_PROMPT_CAP));
  });

  it("ignores blank prompts without publishing", () => {
    const publishActivity = vi.fn();
    recordCodexPromptForHeader(SESSION, "   ", { publishActivity });

    expect(lastPrompts.has(SESSION)).toBe(false);
    expect(publishActivity).not.toHaveBeenCalled();
  });

  it("restores a resumed rollout baseline in lastPrompts and publishes it before a new prompt", () => {
    const publishActivity = vi.fn();

    restoreCodexPromptBaselineForHeader(SESSION, "restore the Codex resume title", { publishActivity });

    expect(lastPrompts.get(SESSION)).toBe("restore the Codex resume title");
    expect(publishActivity).toHaveBeenCalledWith(SESSION);
  });

  it("keeps the existing fallback semantics when the resumed baseline is only trivial", () => {
    const publishActivity = vi.fn();

    restoreCodexPromptBaselineForHeader(SESSION, "ok", { publishActivity });

    expect(lastPrompts.get(SESSION)).toBe("ok");
    expect(publishActivity).toHaveBeenCalledWith(SESSION);
  });

  it("keeps a meaningful restored baseline after a trivial new Codex prompt", () => {
    const publishActivity = vi.fn();
    restoreCodexPromptBaselineForHeader(SESSION, "restore the Codex resume title", { publishActivity });

    recordCodexPromptForHeader(SESSION, "ok", { publishActivity });

    expect(lastPrompts.get(SESSION)).toBe("restore the Codex resume title");
    expect(publishActivity).toHaveBeenCalledTimes(2);
  });

  it("does not publish when there is no baseline prompt to restore", () => {
    const publishActivity = vi.fn();
    restoreCodexPromptBaselineForHeader(SESSION, null, { publishActivity });

    expect(lastPrompts.has(SESSION)).toBe(false);
    expect(publishActivity).not.toHaveBeenCalled();
  });
});

describe("trackCodexActivity resume baseline", () => {
  beforeEach(() => {
    lastPrompts.clear();
  });

  it("restores a resumed rollout baseline without replaying old activity, and the mobile list title uses it", async () => {
    const file = await rolloutFile(started("old") + userMessage("restore the Codex resume title") + userMessage("ok") + complete("old"));
    const publishActivity = vi.fn();
    const setWorking = vi.fn();
    const setWaiting = vi.fn();
    const deps = {
      setWorking,
      setWaiting,
      publishActivity,
      isActive: () => false,
      uiPort: "5173",
      isAlive: () => publishActivity.mock.calls.length === 0,
    };

    trackCodexActivity(SESSION, file, true, deps);

    await vi.waitFor(() => expect(lastPrompts.get(SESSION)).toBe("restore the Codex resume title"));
    expect(publishActivity).toHaveBeenCalledWith(SESSION);
    expect(setWorking).not.toHaveBeenCalled();
    expect(setWaiting).not.toHaveBeenCalled();

    const sessions = buildSessionList({
      liveIds: [SESSION],
      tmuxIds: [],
      isResumable: () => true,
      isGridSession: () => true,
      detailOf: (id) => ({
        title: sessionDisplayName(null, null, lastPrompts.get(id), undefined),
        cwd: "/repo",
        agent: "codex",
      }),
    });
    expect(sessions[0]).toMatchObject({ id: SESSION, title: "restore the Codex resume title" });
  });

  it("restores a resumed current rollout baseline while ignoring environment_context", async () => {
    const file = await rolloutFile(started("old") + environmentContext() + responseUserMessage("restore the current Codex resume title") + complete("old"));
    const publishActivity = vi.fn();

    trackCodexActivity(SESSION, file, true, {
      setWorking: vi.fn(),
      setWaiting: vi.fn(),
      publishActivity,
      isActive: () => false,
      uiPort: "5173",
      isAlive: () => publishActivity.mock.calls.length === 0,
    });

    await vi.waitFor(() => expect(lastPrompts.get(SESSION)).toBe("restore the current Codex resume title"));
    expect(publishActivity).toHaveBeenCalledWith(SESSION);
  });

  it("tracks a fresh current rollout prompt through lastPrompts, desktop header, and mobile list title", async () => {
    const file = await rolloutFile(started("fresh") + environmentContext() + responseUserMessage("fix the fresh Codex title") + complete("fresh"));
    const publishActivity = vi.fn();
    const deps = {
      setWorking: vi.fn(),
      setWaiting: vi.fn(),
      publishActivity,
      isActive: () => false,
      uiPort: "5173",
      isAlive: () => publishActivity.mock.calls.length === 0,
    };

    trackCodexActivity(SESSION, file, false, deps);

    await vi.waitFor(() => expect(lastPrompts.get(SESSION)).toBe("fix the fresh Codex title"), { timeout: 2500 });
    expect(publishActivity).toHaveBeenCalledWith(SESSION);
    expect(cellHeaderText(null, null, lastPrompts.get(SESSION) ?? null, SESSION)).toBe("fix the fresh Codex title");

    const sessions = buildSessionList({
      liveIds: [SESSION],
      tmuxIds: [],
      isResumable: () => true,
      isGridSession: () => true,
      detailOf: (id) => ({
        title: sessionDisplayName(null, null, lastPrompts.get(id), undefined),
        cwd: "/repo",
        agent: "codex",
      }),
    });
    expect(sessions[0]).toMatchObject({ id: SESSION, title: "fix the fresh Codex title" });
  });

  it("does not seed lastPrompts from existing rollout content for a fresh session", async () => {
    const file = await rolloutFile(started("fresh") + userMessage("fresh prompt") + complete("fresh"));
    const deps = {
      setWorking: vi.fn(),
      setWaiting: vi.fn(),
      publishActivity: vi.fn(),
      isActive: () => false,
      uiPort: "5173",
      isAlive: () => false,
    };

    trackCodexActivity(SESSION, file, false, deps);
    await Promise.resolve();

    expect(lastPrompts.has(SESSION)).toBe(false);
    expect(deps.publishActivity).not.toHaveBeenCalled();
  });
});
