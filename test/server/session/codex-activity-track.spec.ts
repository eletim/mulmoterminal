// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

import { recordCodexPromptForHeader } from "../../../server/session/codex-activity-track.js";
import { LAST_PROMPT_CAP } from "../../../server/session/header-hook.js";
import { lastPrompts } from "../../../server/session/registry.js";

const SESSION = "11111111-1111-4111-8111-111111111111";

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
});
