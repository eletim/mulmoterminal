// @vitest-environment node
import { execFile, execFileSync, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { promisify } from "node:util";
import { afterAll, describe, expect, it } from "vitest";
import { CoreSessionAdapter, type CoreSession } from "../../../server/session/core-session-adapter.js";
import { buildSessionList } from "../../../server/mobileTerminal/terminalScreen.js";

const execFileAsync = promisify(execFile);
// eslint-disable-next-line sonarjs/no-os-command-from-path -- portability: tmux is supplied by the test host
const HAS_TMUX = spawnSync("tmux", ["-V"]).status === 0;
const SERVER = `mulmoterminal-test-${process.pid}-${Date.now()}`;
const SHELL_ID = randomUUID();
const AGENT_ID = randomUUID();
const STOP_ID = randomUUID();

async function waitFor<T>(read: () => Promise<T>, accept: (value: T) => boolean, timeoutMs = 5_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let value = await read();
  while (!accept(value) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 50));
    value = await read();
  }
  expect(accept(value), JSON.stringify(value)).toBe(true);
  return value;
}

async function listFromFreshNodeProcess(): Promise<CoreSession[]> {
  const source = `
    import { CoreSessionAdapter } from "./server/session/core-session-adapter.ts";
    const adapter = new CoreSessionAdapter({ serverName: process.env.MULMOTERMINAL_TEST_CORE_SERVER });
    process.stdout.write(JSON.stringify(await adapter.list()));
  `;
  const { stdout } = await execFileAsync(process.execPath, ["--import", "tsx", "--input-type=module", "--eval", source], {
    cwd: process.cwd(),
    env: { ...process.env, MULMOTERMINAL_TEST_CORE_SERVER: SERVER },
  });
  return JSON.parse(stdout) as CoreSession[];
}

describe.skipIf(!HAS_TMUX)("Core session discovery after a complete Node restart", () => {
  afterAll(() => {
    try {
      // eslint-disable-next-line sonarjs/no-os-command-from-path -- same isolated test binary as above
      execFileSync("tmux", ["-L", SERVER, "kill-server"], { stdio: "ignore" });
    } catch {
      // The isolated test server is already gone.
    }
  });

  it("restores, operates, retains final screen, and deletes using Core alone", async () => {
    const firstProcess = new CoreSessionAdapter({ serverName: SERVER });
    await firstProcess.create({
      id: SHELL_ID,
      command: "/bin/sh",
      cwd: process.cwd(),
      agent: "shell",
      title: "Restart shell",
      memo: "shell memo",
    });
    await firstProcess.create({
      id: AGENT_ID,
      command: "printf AGENT_FINAL_MARKER; exit 7",
      cwd: process.cwd(),
      agent: "codex",
      title: "Restart agent",
    });
    await firstProcess.create({
      id: STOP_ID,
      command: `${process.execPath} -e 'process.on("SIGINT",()=>{console.log("STOP_FINAL_MARKER");process.exit(130)});setInterval(()=>{},1000)'`,
      cwd: process.cwd(),
      agent: "shell",
      title: "Stopped shell",
    });

    await waitFor(
      () => firstProcess.get(AGENT_ID),
      (session) => session.exited,
    );

    // This is a separate OS process with no MulmoTerminal registry, lifecycle rows, or PTYs.
    const restarted = await listFromFreshNodeProcess();
    const desktopIds = restarted.map((session) => session.id).sort();
    const mobileIds = buildSessionList({
      sessions: restarted.map((session) => ({
        id: session.id,
        exited: session.exited,
        title: session.title ?? "",
        cwd: session.cwd ?? "",
        agent: session.agent ?? null,
      })),
    })
      .map((session) => session.id)
      .sort();
    expect(desktopIds).toEqual(mobileIds);
    expect(desktopIds).toEqual([AGENT_ID, SHELL_ID, STOP_ID].sort());
    expect(restarted.find((session) => session.id === SHELL_ID)).toMatchObject({
      agent: "shell",
      title: "Restart shell",
      memo: "shell memo",
      cwd: process.cwd(),
      exited: false,
    });
    expect(restarted.find((session) => session.id === AGENT_ID)).toMatchObject({
      agent: "codex",
      title: "Restart agent",
      cwd: process.cwd(),
      exited: true,
    });

    const secondProcess = new CoreSessionAdapter({ serverName: SERVER });
    expect(await secondProcess.screen(AGENT_ID)).toContain("AGENT_FINAL_MARKER");
    await secondProcess.input(SHELL_ID, "printf 'RUNNING_INPUT_MARKER\\n'\r");
    await waitFor(
      () => secondProcess.screen(SHELL_ID),
      (screen) => screen.includes("RUNNING_INPUT_MARKER"),
    );

    await secondProcess.stop(STOP_ID);
    const stopped = await waitFor(
      () => secondProcess.get(STOP_ID),
      (session) => session.exited,
    );
    expect(stopped.id).toBe(STOP_ID);
    expect(await secondProcess.screen(STOP_ID)).toContain("STOP_FINAL_MARKER");
    expect((await secondProcess.list()).map((session) => session.id)).toContain(STOP_ID);

    // Explicit Delete removes either running or dead membership; Stop never does.
    await secondProcess.delete(AGENT_ID);
    await secondProcess.delete(SHELL_ID);
    await secondProcess.delete(STOP_ID);
    expect(await new CoreSessionAdapter({ serverName: SERVER }).list()).toEqual([]);
  }, 15_000);
});
