// @vitest-environment node
import { describe, it, expect } from "vitest";
import type { CalendarPushOutcome } from "@mulmoclaude/core/google";

import { toCollectionPushResult } from "../../../server/backends/calendarPushResult.js";

// Four of the engine's five outcomes mean "the push did not run", and all four have to come
// back as `errors` on a 200: the view sends an HTTP failure to the page-level error slot,
// away from the button that was pressed, while `errors` reaches the banner beside it.
const refusals: Array<[label: string, outcome: CalendarPushOutcome, matches: RegExp]> = [
  ["a collection that declares no calendar", { kind: "not-a-calendar" }, /does not declare a Google calendar/],
  ["an unlinked Google account", { kind: "not-linked" }, /not linked.*Settings/i],
  ["a calendar the user can only read", { kind: "read-only", accessRole: "reader" }, /read-only \(reader\)/],
  ["an engine failure", { kind: "failed", message: "calendar API unreachable" }, /calendar API unreachable/],
];

describe("toCollectionPushResult", () => {
  it("carries a successful push's counts through", () => {
    const outcome: CalendarPushOutcome = {
      kind: "pushed",
      result: { slug: "meetings", created: 3, updated: 2, conflicts: 1, localDeletes: 4, skipped: ["r7: no start time"], errors: [] },
    };
    expect(toCollectionPushResult(outcome)).toEqual({
      pushed: true,
      created: 3,
      updated: 2,
      conflicts: 1,
      localDeletes: 4,
      skipped: ["r7: no start time"],
      errors: [],
      // `slug` is the engine's, not the wire's — toEqual fails if it leaks through.
    });
  });

  // A push that reached Google but could not place every record is still a push: the counts
  // are real and the per-record reasons belong in `skipped`, not in `errors`.
  it("keeps per-record reasons on a push that partly succeeded", () => {
    const result = toCollectionPushResult({
      kind: "pushed",
      result: { slug: "meetings", created: 1, updated: 0, conflicts: 0, localDeletes: 0, skipped: ["r2: end before start"], errors: ["r9: 403"] },
    });
    expect(result.pushed).toBe(true);
    expect(result.skipped).toEqual(["r2: end before start"]);
    expect(result.errors).toEqual(["r9: 403"]);
  });

  describe.each(refusals)("%s", (_label, outcome, matches) => {
    it("reports nothing pushed", () => {
      const result = toCollectionPushResult(outcome);
      expect(result.pushed).toBe(false);
      expect({ ...result, errors: [], skipped: [] }).toEqual({ pushed: false, created: 0, updated: 0, conflicts: 0, localDeletes: 0, skipped: [], errors: [] });
    });

    // The whole point of the shape: counts alone would render a setup problem as
    // "0 created", which reads as "there was nothing to do".
    it("explains why in errors, so the banner has something to say", () => {
      const { errors } = toCollectionPushResult(outcome);
      expect(errors).toHaveLength(1);
      expect(errors[0]).toMatch(matches);
    });
  });

  // The refusals share a frozen base object; a mutation on one must not reach the next.
  it("gives each refusal its own arrays", () => {
    const first = toCollectionPushResult({ kind: "not-linked" });
    first.errors.push("extra");
    first.skipped.push("extra");
    expect(toCollectionPushResult({ kind: "not-linked" }).errors).toHaveLength(1);
    expect(toCollectionPushResult({ kind: "not-linked" }).skipped).toEqual([]);
  });
});
