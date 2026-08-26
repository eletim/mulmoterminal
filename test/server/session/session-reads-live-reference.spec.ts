// @vitest-environment node
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { activity, aiTitles, sessionMemos } from "../../../server/session/registry.js";
import { readSessionMeta } from "../../../server/session/session-reads.js";

const HISTORY = "11111111-1111-4111-8111-111111111111";
const LIVE = "22222222-2222-4222-8222-222222222222";

afterEach(() => {
  activity.clear();
  aiTitles.clear();
  sessionMemos.clear();
});

describe("resumed history row metadata", () => {
  it("reads transcript content by history id and live state by Core id", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "mt-history-row-"));
    try {
      await fs.writeFile(path.join(dir, `${HISTORY}.jsonl`), `${JSON.stringify({ type: "user", message: { content: "history prompt" } })}\n`);
      activity.set(LIVE, { working: true, waiting: false, event: "UserPromptSubmit", at: 1 });
      aiTitles.set(LIVE, "Live Core title");
      sessionMemos.set(LIVE, "Live Core memo");

      await expect(readSessionMeta(dir, `${HISTORY}.jsonl`, LIVE)).resolves.toMatchObject({
        id: HISTORY,
        title: "Live Core memo",
        working: true,
        waiting: false,
        event: "UserPromptSubmit",
      });
    } finally {
      await fs.rm(dir, { recursive: true });
    }
  });
});
