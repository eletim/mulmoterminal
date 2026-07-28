import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import os from "node:os";
import {
  isProbeTranscript,
  removeProbeTranscript,
  sweepLegacyProbeTranscripts,
  sweepLegacyProbeTranscriptsOnce,
  PROBE_TRANSCRIPT_MAX_BYTES,
} from "./probe-transcript";
import { PROBE_PROMPT } from "./rate-limit-probe";
import { newProbeSessionId } from "./probe-session";
import { projectSessionsDir } from "../session/project-dir";

// #1010: these functions DELETE files out of the user's ~/.claude. The predicate is the whole
// safety argument, so it is pinned here rather than tried out on a real disk.

const userLine = (text: string) => JSON.stringify({ type: "user", message: { role: "user", content: text } });
const userBlocks = (text: string) => JSON.stringify({ type: "user", message: { role: "user", content: [{ type: "text", text }] } });
const assistantLine = (text: string) => JSON.stringify({ type: "assistant", message: { role: "assistant", content: [{ type: "text", text }] } });
const toolUseLine = () => JSON.stringify({ type: "assistant", message: { role: "assistant", content: [{ type: "tool_use", name: "Read", input: {} }] } });
const noise = () => JSON.stringify({ type: "attachment", foo: 1 });
const probe = () => [noise(), userLine(PROBE_PROMPT), assistantLine("."), noise()].join("\n");

describe("isProbeTranscript", () => {
  it("recognises a probe: one user message, and it is the prompt", () => {
    expect(isProbeTranscript(probe())).toBe(true);
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

  // Codex review on #1030: a person CAN type the probe's exact words. No field separates the two —
  // the probe types into the real TUI. What can be said is that a probe never reaches for a tool,
  // which held for all 84 probe transcripts measured.
  it("spares a one-turn conversation that used a tool, however it opened", () => {
    expect(isProbeTranscript([userLine(PROBE_PROMPT), toolUseLine(), assistantLine(".")].join("\n"))).toBe(false);
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
    const mine = newProbeSessionId();
    const theirs = newProbeSessionId();
    write(`${mine}.jsonl`, userLine(PROBE_PROMPT));
    write(`${theirs}.jsonl`, userLine(PROBE_PROMPT));

    expect(await removeProbeTranscript(cwd, mine)).toBe(true);
    expect(remains()).toEqual([`${theirs}.jsonl`]);
  });

  // A future caller passing the wrong variable must not be able to delete somebody's session.
  it("refuses an id that is not shaped like a probe's, even if the file is there", async () => {
    write("3f2504e0-4f89-41d3-9a0c-0305e82c3301.jsonl", userLine(PROBE_PROMPT));

    expect(await removeProbeTranscript(cwd, "3f2504e0-4f89-41d3-9a0c-0305e82c3301")).toBe(false);
    expect(remains()).toEqual(["3f2504e0-4f89-41d3-9a0c-0305e82c3301.jsonl"]);
  });

  it("says so rather than throwing when there is nothing to remove", async () => {
    expect(await removeProbeTranscript(cwd, newProbeSessionId())).toBe(false);
  });

  it("sweeps legacy probes and spares real work in the same directory", async () => {
    write("legacy-probe-a.jsonl", probe());
    write("legacy-probe-b.jsonl", [userBlocks(PROBE_PROMPT), assistantLine(".")].join("\n"));
    write("real-conversation.jsonl", [userLine("about " + PROBE_PROMPT), userLine("more")].join("\n"));
    write("unrelated.jsonl", userLine("hello"));
    write("not-a-transcript.txt", PROBE_PROMPT);

    expect(await sweepLegacyProbeTranscripts(cwd)).toBe(2);
    expect(remains()).toEqual(["not-a-transcript.txt", "real-conversation.jsonl", "unrelated.jsonl"]);
  });

  // Reading a 14MB conversation to decide it is not a 90KB probe is pure waste, and erring high
  // can only leave litter behind.
  it("does not even read a file far larger than any probe", async () => {
    write("huge.jsonl", userLine(PROBE_PROMPT) + "\n" + "x".repeat(PROBE_TRANSCRIPT_MAX_BYTES));

    expect(await sweepLegacyProbeTranscripts(cwd)).toBe(0);
    expect(remains()).toEqual(["huge.jsonl"]);
  });

  it("does nothing, quietly, when the project has no transcripts yet", async () => {
    expect(await sweepLegacyProbeTranscripts(path.join(home, "never-used"))).toBe(0);
  });

  it("only looks inside the project it was given", async () => {
    const other = path.join(home, "other-project");
    mkdirSync(projectSessionsDir(other), { recursive: true });
    writeFileSync(path.join(projectSessionsDir(other), "probe.jsonl"), probe());
    write("probe.jsonl", probe());

    expect(await sweepLegacyProbeTranscripts(cwd)).toBe(1);
    expect(existsSync(path.join(projectSessionsDir(other), "probe.jsonl"))).toBe(true);
  });
});

// The time bound is the real answer to "a person could type the same thing" (Codex on #1030):
// the sweep is for files that predate the fix, so it gets exactly one chance.
describe("the one-time sweep", () => {
  const realHome = os.homedir();
  let home: string;
  let cwd: string;
  let marker: string;

  beforeEach(() => {
    home = mkdtempSync(path.join(tmpdir(), "mt-probe-once-"));
    Object.defineProperty(os, "homedir", { value: () => home, configurable: true });
    cwd = path.join(home, "project");
    marker = path.join(home, "probe-sweep.json");
    mkdirSync(projectSessionsDir(cwd), { recursive: true });
  });

  afterEach(() => {
    Object.defineProperty(os, "homedir", { value: () => realHome, configurable: true });
    rmSync(home, { recursive: true, force: true });
  });

  const write = (name: string, body: string) => writeFileSync(path.join(projectSessionsDir(cwd), name), body);

  it("sweeps the first time and records that it did", async () => {
    write("old-probe.jsonl", probe());

    expect(await sweepLegacyProbeTranscriptsOnce(cwd, marker)).toBe(1);
    expect(existsSync(marker)).toBe(true);
  });

  it("never touches a transcript typed after that, however identical it looks", async () => {
    expect(await sweepLegacyProbeTranscriptsOnce(cwd, marker)).toBe(0);
    // Someone types the probe's exact words, by hand, the next day.
    write("a-person-typed-this.jsonl", probe());

    expect(await sweepLegacyProbeTranscriptsOnce(cwd, marker)).toBeNull();
    expect(existsSync(path.join(projectSessionsDir(cwd), "a-person-typed-this.jsonl"))).toBe(true);
  });

  it("records the sweep even when it found nothing, so the right to delete is not re-earned", async () => {
    expect(await sweepLegacyProbeTranscriptsOnce(cwd, marker)).toBe(0);
    expect(await sweepLegacyProbeTranscriptsOnce(cwd, marker)).toBeNull();
  });

  // Codex review on #1030: a fresh install has no ~/.mulmoterminal yet. Writing the marker into a
  // directory that does not exist throws, the caller can only swallow it, and the sweep would then
  // delete on EVERY boot — the permanent window this design exists to close.
  it("creates the marker's directory, so a fresh install still only sweeps once", async () => {
    const unmade = path.join(home, "not-created-yet", "probe-sweep.json");
    write("old-probe.jsonl", probe());

    expect(await sweepLegacyProbeTranscriptsOnce(cwd, unmade)).toBe(1);
    expect(existsSync(unmade)).toBe(true);

    write("a-person-typed-this.jsonl", probe());
    expect(await sweepLegacyProbeTranscriptsOnce(cwd, unmade)).toBeNull();
    expect(existsSync(path.join(projectSessionsDir(cwd), "a-person-typed-this.jsonl"))).toBe(true);
  });

  // Claimed before anything is deleted: if the claim cannot be written, the safe answer is to
  // delete nothing rather than to delete and forget having done so.
  it("deletes nothing when it cannot record that it swept", async () => {
    // A path whose parent is a FILE can never be created.
    const blocked = path.join(home, "blocker", "probe-sweep.json");
    mkdirSync(path.dirname(path.dirname(blocked)), { recursive: true });
    writeFileSync(path.join(home, "blocker"), "not a directory");
    write("old-probe.jsonl", probe());

    expect(await sweepLegacyProbeTranscriptsOnce(cwd, blocked)).toBeNull();
    expect(existsSync(path.join(projectSessionsDir(cwd), "old-probe.jsonl"))).toBe(true);
  });
});
