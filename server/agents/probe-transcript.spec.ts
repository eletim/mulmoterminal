import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import os from "node:os";
import { isProbeTranscript, removeProbeTranscript, sweepLegacyProbeTranscripts } from "./probe-transcript";
import { PROBE_PROMPT } from "./rate-limit-probe";
import { projectSessionsDir } from "../session/project-dir";

// #1010: these functions DELETE files out of the user's ~/.claude. The predicate is the whole
// safety argument, so it is pinned here rather than tried out on a real disk.

const userLine = (text: string) => JSON.stringify({ type: "user", message: { role: "user", content: text } });
const userBlocks = (text: string) => JSON.stringify({ type: "user", message: { role: "user", content: [{ type: "text", text }] } });
const assistantLine = (text: string) => JSON.stringify({ type: "assistant", message: { role: "assistant", content: [{ type: "text", text }] } });
const noise = () => JSON.stringify({ type: "attachment", foo: 1 });

describe("isProbeTranscript", () => {
  it("recognises a probe: one user message, and it is the prompt", () => {
    expect(isProbeTranscript([noise(), userLine(PROBE_PROMPT), assistantLine("."), noise()].join("\n"))).toBe(true);
  });

  it("recognises it when the content is text blocks rather than a bare string", () => {
    expect(isProbeTranscript([userBlocks(PROBE_PROMPT), assistantLine(".")].join("\n"))).toBe(true);
  });

  // The measured failure mode: over 7711 transcripts a substring test matched 6 real
  // conversations, one of them 974 messages long — it had merely DISCUSSED the prompt.
  it("does not claim a real conversation that merely quotes the prompt", () => {
    const real = [userLine("what does this do?"), assistantLine(`it sends ${PROBE_PROMPT} to claude`), userLine(PROBE_PROMPT), userLine("thanks")].join("\n");
    expect(real).toContain(PROBE_PROMPT);
    expect(isProbeTranscript(real)).toBe(false);
  });

  it("does not claim a session whose single message is something else", () => {
    expect(isProbeTranscript(userLine("reply with the single character: x"))).toBe(false);
    expect(isProbeTranscript(userLine(`${PROBE_PROMPT} and then explain`))).toBe(false);
  });

  it("does not claim a transcript with no user message at all", () => {
    expect(isProbeTranscript([noise(), assistantLine(".")].join("\n"))).toBe(false);
    expect(isProbeTranscript("")).toBe(false);
  });

  it("survives a truncated last line, which a file still being written always has", () => {
    expect(isProbeTranscript([userLine(PROBE_PROMPT), '{"type":"assis'].join("\n"))).toBe(true);
  });
});

// The disk-touching half runs against a fake HOME so no real transcript is ever in reach.
describe("probe transcript removal", () => {
  const realHome = os.homedir();
  let home: string;
  let cwd: string;

  beforeEach(() => {
    home = mkdtempSync(path.join(tmpdir(), "mt-probe-home-"));
    Object.defineProperty(os, "homedir", { value: () => home, configurable: true });
    // Under the sandbox home too, so nothing here names a world-writable path.
    cwd = path.join(home, "project");
    mkdirSync(projectSessionsDir(cwd), { recursive: true });
  });

  afterEach(() => {
    Object.defineProperty(os, "homedir", { value: () => realHome, configurable: true });
    rmSync(home, { recursive: true, force: true });
  });

  const write = (name: string, body: string) => writeFileSync(path.join(projectSessionsDir(cwd), name), body);
  const remains = () => readdirSync(projectSessionsDir(cwd)).sort();

  it("removes the probe's own transcript by id, and leaves every other id alone", async () => {
    write("probe-1.jsonl", userLine(PROBE_PROMPT));
    write("someone-else.jsonl", userLine(PROBE_PROMPT));

    expect(await removeProbeTranscript(cwd, "probe-1")).toBe(true);
    expect(remains()).toEqual(["someone-else.jsonl"]);
  });

  it("says so rather than throwing when there is nothing to remove", async () => {
    expect(await removeProbeTranscript(cwd, "never-written")).toBe(false);
  });

  it("sweeps legacy probes and spares real work in the same directory", async () => {
    write("legacy-probe-a.jsonl", [userLine(PROBE_PROMPT), assistantLine(".")].join("\n"));
    write("legacy-probe-b.jsonl", [userBlocks(PROBE_PROMPT), assistantLine(".")].join("\n"));
    write("real-conversation.jsonl", [userLine("about " + PROBE_PROMPT), userLine("more")].join("\n"));
    write("unrelated.jsonl", userLine("hello"));
    write("not-a-transcript.txt", PROBE_PROMPT);

    expect(await sweepLegacyProbeTranscripts(cwd)).toBe(2);
    expect(remains()).toEqual(["not-a-transcript.txt", "real-conversation.jsonl", "unrelated.jsonl"]);
  });

  it("does nothing, quietly, when the project has no transcripts yet", async () => {
    expect(await sweepLegacyProbeTranscripts(path.join(home, "never-used"))).toBe(0);
  });

  it("only looks inside the project it was given", async () => {
    const other = path.join(home, "other-project");
    mkdirSync(projectSessionsDir(other), { recursive: true });
    writeFileSync(path.join(projectSessionsDir(other), "probe.jsonl"), userLine(PROBE_PROMPT));
    write("probe.jsonl", userLine(PROBE_PROMPT));

    expect(await sweepLegacyProbeTranscripts(cwd)).toBe(1);
    expect(existsSync(path.join(projectSessionsDir(other), "probe.jsonl"))).toBe(true);
  });
});
