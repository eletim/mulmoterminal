// @vitest-environment node
import { describe, expect, it } from "vitest";
import { parseLegacySessionToolGroups } from "../../../server/session/legacy-gui-capability-log.js";

const ID = "11111111-1111-1111-1111-111111111111";
const OTHER = "22222222-2222-2222-2222-222222222222";
const valid = (id: string) => /^[0-9a-f-]{36}$/i.test(id);

describe("legacy GUI capability log parser", () => {
  it("folds repeated groups and reset markers in order for one-way migration", () => {
    expect(parseLegacySessionToolGroups(`${ID} render\n${ID} render\n${OTHER} media\n${ID} -\n${ID} external`, valid)).toEqual([
      { sessionId: ID, group: "external" },
      { sessionId: OTHER, group: "media" },
    ]);
  });

  it("drops malformed ids, unknown groups, and torn lines", () => {
    expect(parseLegacySessionToolGroups(`bad render\n${ID} unknown\n${ID} render extra\n${OTHER} media`, valid)).toEqual([
      { sessionId: OTHER, group: "media" },
    ]);
  });
});
