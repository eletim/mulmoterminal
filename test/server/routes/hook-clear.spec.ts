// @vitest-environment node
// What a `/clear` does to the session state the cockpit roster reads, pinned at the route.
//
// The pieces have their own specs — headerHookEffect decides that SessionStart source=clear IS a
// clear, and the readers each have a guard — but this is the seam where the user-visible bug lived
// (#1085): the route blanked the prompt and reply and left the transcript unmarked, so the next
// turn read the pre-clear title and reply back out of a file claude had already abandoned.
import { describe, it, expect, beforeEach, vi } from "vitest";
import express from "express";
import request from "supertest";
import { mountHookRoute } from "../../../server/routes/hook-routes";
import { clearedTranscripts, lastPrompts, lastResponses } from "../../../server/session/registry";

const ID = "11111111-2222-4333-8444-555555555555";

const deps = {
  setWorking: vi.fn(),
  setWaiting: vi.fn(),
  publishActivity: vi.fn(),
  forgetTitle: vi.fn(),
  noteTitleTurn: vi.fn(),
  noteWorkPhase: vi.fn(),
  maybeGenerateTitle: vi.fn(async () => {}),
  recordToolCallStart: vi.fn(async () => {}),
  recordToolCallEnd: vi.fn(async () => {}),
  publishDirConfig: vi.fn(),
  publishFileWrite: vi.fn(),
  uiPort: "34567",
};

const app = express();
app.use(express.json());
mountHookRoute(app, deps);

const postHook = (body: Record<string, unknown>) => request(app).post("/api/hook").set("x-mt-session", ID).send(body);

beforeEach(() => {
  lastPrompts.delete(ID);
  lastResponses.delete(ID);
  clearedTranscripts.delete(ID);
  vi.clearAllMocks();
});

describe("SessionStart source=clear", () => {
  it("blanks the prompt and reply, drops the title, and marks the transcript cleared", async () => {
    lastPrompts.set(ID, "continue GitHub issue 1048");
    lastResponses.set(ID, "Done — issue 1048 is closed.");

    await postHook({ hook_event_name: "SessionStart", source: "clear" });

    // Empty string, not deleted: it has to beat the transcript fallback in /api/session.
    expect(lastPrompts.get(ID)).toBe("");
    expect(lastResponses.get(ID)).toBe("");
    expect(clearedTranscripts.has(ID)).toBe(true);
    expect(deps.forgetTitle).toHaveBeenCalledWith(ID);
    expect(deps.publishActivity).toHaveBeenCalledWith(ID);
  });

  // `/compact` arrives as SessionStart too, mid-conversation. Marking its transcript cleared
  // would freeze the summary of a session that is still going and still writing to that file.
  it("leaves a session alone on any other SessionStart", async () => {
    lastPrompts.set(ID, "continue GitHub issue 1048");

    await postHook({ hook_event_name: "SessionStart", source: "compact" });

    expect(lastPrompts.get(ID)).toBe("continue GitHub issue 1048");
    expect(clearedTranscripts.has(ID)).toBe(false);
    expect(deps.forgetTitle).not.toHaveBeenCalled();
  });
});
