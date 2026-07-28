import { describe, it, expect } from "vitest";
import { dropUploadErrorMessage, dropUploadUrl, isTooLargeToDrop } from "../../../src/components/dropUpload";
import { MAX_DROP_BYTES } from "../../../common/dropUpload";

describe("dropUploadUrl", () => {
  it("addresses the session's own drop endpoint", () => {
    expect(dropUploadUrl("2f1c0b4e-0000-4000-8000-000000000000")).toBe("/api/session/2f1c0b4e-0000-4000-8000-000000000000/drop");
  });

  // The id reaches the URL from component state rather than from a user, but a value that
  // needs escaping must not silently address a different path.
  it("escapes an id that would otherwise reshape the path", () => {
    expect(dropUploadUrl("../../evil")).toBe("/api/session/..%2F..%2Fevil/drop");
  });
});

describe("isTooLargeToDrop", () => {
  // Checked in the browser as well as by the server so a large file fails at once, rather than
  // after uploading all of it only to be refused at the end.
  it("accepts up to the cap and refuses past it", () => {
    expect(isTooLargeToDrop(MAX_DROP_BYTES)).toBe(false);
    expect(isTooLargeToDrop(MAX_DROP_BYTES + 1)).toBe(true);
    expect(isTooLargeToDrop(0)).toBe(false);
  });
});

describe("dropUploadErrorMessage", () => {
  // Each of these needs a DIFFERENT thing from the user — shrink the file, restart the
  // terminal, fix the origin — and "it failed" tells them none of it.
  it("says something different for each cause the user can act on", () => {
    const actionable = [413, 404, 403].map(dropUploadErrorMessage);
    expect(new Set(actionable).size).toBe(actionable.length);
    expect(actionable).not.toContain(dropUploadErrorMessage(null));
  });

  // Everything else is one message on purpose: there is nothing specific to say about a 500 or
  // a dropped connection, and inventing per-status wording would only look like it knew more.
  it("gives an unrecognized status the same message as no status at all", () => {
    expect(dropUploadErrorMessage(500)).toBe(dropUploadErrorMessage(null));
  });

  it("names the size for a file that was too large", () => {
    expect(dropUploadErrorMessage(413)).toContain("too large");
  });

  it("has a message for a failure with no status at all", () => {
    expect(dropUploadErrorMessage(null)).not.toBe("");
  });
});
