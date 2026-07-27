// @vitest-environment node
import { describe, it, expect } from "vitest";

import { GITHUB_REPO, STAR_API_PATH, parseStarState } from "../../common/githubRepo.js";

describe("githubRepo constants", () => {
  it("derives the gh api path from the repo constant", () => {
    expect(STAR_API_PATH).toBe(`/user/starred/${GITHUB_REPO}`);
  });
});

describe("parseStarState", () => {
  it("passes a boolean through", () => {
    expect(parseStarState({ starred: true })).toBe(true);
    expect(parseStarState({ starred: false })).toBe(false);
  });

  // Everything unparseable collapses to "cannot tell", so the client has one degraded path
  // (offer a link) instead of a separate error branch per malformed shape.
  it("reads an explicit null, a missing field and a wrong type as unknown", () => {
    expect(parseStarState({ starred: null })).toBeNull();
    expect(parseStarState({})).toBeNull();
    expect(parseStarState({ starred: "yes" })).toBeNull();
  });

  it("reads a non-object body as unknown", () => {
    expect(parseStarState(null)).toBeNull();
    expect(parseStarState("starred")).toBeNull();
    expect(parseStarState(undefined)).toBeNull();
  });
});
