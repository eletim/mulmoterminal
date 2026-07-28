// @vitest-environment node
// The log that remembers where each grid session was started (#1021). It is read by a build that
// may be older or newer than the one that wrote it, and appended to by several instances at once,
// so what a line means — and what an unusable one costs — is pinned here.
import { describe, it, expect } from "vitest";
import { devTerminalCwdLine, parseDevTerminalCwds } from "../../../server/session/dev-terminal-cwds";

const ID_A = "bf488420-850f-4dcb-931c-727614d6eaf7";
const ID_B = "33149419-234b-4d31-bd8c-341290f4c090";
const isValidId = (id: string) => /^[0-9a-f-]{36}$/.test(id);

describe("parseDevTerminalCwds", () => {
  it("reads one record per line", () => {
    const log = `${devTerminalCwdLine(ID_A, "/work/one")}${devTerminalCwdLine(ID_B, "/work/two")}`;
    expect([...parseDevTerminalCwds(log, isValidId)]).toEqual([
      [ID_A, "/work/one"],
      [ID_B, "/work/two"],
    ]);
  });

  // The log only grows, so a cell relaunched somewhere else appends a second line for the same id.
  it("lets the last entry for an id win", () => {
    const log = `${devTerminalCwdLine(ID_A, "/work/old")}${devTerminalCwdLine(ID_A, "/work/new")}`;
    expect(parseDevTerminalCwds(log, isValidId).get(ID_A)).toBe("/work/new");
  });

  it("keeps a path that contains spaces", () => {
    expect(parseDevTerminalCwds(devTerminalCwdLine(ID_A, "/work/my project"), isValidId).get(ID_A)).toBe("/work/my project");
  });

  it.each([
    ["an empty file", ""],
    ["blank lines", "\n\n   \n"],
    ["an id with no path", ID_A],
    ["a path with no id", " /work/one"],
    ["something that is not a session id", "not-an-id /work/one"],
  ])("drops %s rather than guessing", (_label, contents) => {
    expect([...parseDevTerminalCwds(contents, isValidId)]).toEqual([]);
  });

  // The two logs live side by side in ~/.mulmoterminal. Reading the wrong one must yield nothing
  // rather than nonsense — an id log line is a bare id, which has no path to take.
  it("reads nothing out of the id log next door", () => {
    expect([...parseDevTerminalCwds(`\n${ID_A}\n${ID_B}`, isValidId)]).toEqual([]);
  });

  it("survives a torn last line", () => {
    const log = `${devTerminalCwdLine(ID_A, "/work/one")}\n${ID_B} `;
    expect([...parseDevTerminalCwds(log, isValidId)]).toEqual([[ID_A, "/work/one"]]);
  });
});

describe("devTerminalCwdLine", () => {
  // Same rule as the id log: a file that ended without a newline would otherwise weld this record
  // onto the previous line and lose both.
  it("starts its own line", () => {
    expect(devTerminalCwdLine(ID_A, "/work/one").startsWith("\n")).toBe(true);
  });

  it("round-trips through the parser", () => {
    const line = devTerminalCwdLine(ID_A, "/work/one");
    expect(parseDevTerminalCwds(`existing content${line}`, isValidId).get(ID_A)).toBe("/work/one");
  });
});
