// The hidden Claude session that harvests the rate-limit windows (#387).
//
// It exists because the windows are only ever handed to a `statusLine` command, and only by an
// INTERACTIVE session that has had at least one API response — both measured. So the probe is a
// real `claude` PTY that is asked one trivial question, reports through the statusLine, and is
// killed. Nobody ever sees its terminal, which is what makes this cheaper than #388's design: that
// one injected the statusLine into the user's own cells and cost each of them a row.
//
// What it costs instead is one small query against the very budget it reports. That is the whole
// reason the caller only asks when a browser is watching (see rate-limit-store.ts) — a probe on a
// timer would spend the user's window overnight to refresh a number nobody is reading.
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { statusLineCommand } from "./statusline.js";

// Long enough for a cold `claude` to boot, answer, and re-render its status line; short enough
// that a probe which will never report (no binary, an unaccepted trust prompt, an expired login)
// gives up rather than holding a PTY open.
export const PROBE_TIMEOUT_MS = 90_000;

// The question. Anything answerable without tools, because the point is to cause ONE API response
// — the cheapest thing that makes `rate_limits` appear.
const PROBE_PROMPT = "reply with the single character: .";

export interface ProbePty {
  write(data: string): void;
  kill(): void;
}

export interface ProbeDeps {
  // Injected so a test can drive the lifecycle without a real terminal.
  spawn: (args: string[], cwd: string) => ProbePty;
  host: string;
  port: string | number;
  cwd: string;
  sessionId: string;
  onSettled: () => void;
}

/**
 * Start one probe. Returns a stop function, called both by the timeout and by the report arriving.
 *
 * Failure has no branch of its own on purpose: a missing `claude`, a trust prompt nobody answered,
 * a login that expired — all of them look the same from here (no report before the timeout), and
 * all of them want the same response, which is to stop and leave the gauge showing what it had.
 */
export function startRateLimitProbe(deps: ProbeDeps): () => void {
  const dir = mkdtempSync(path.join(tmpdir(), "mt-ratelimit-"));
  const settingsFile = path.join(dir, "settings.json");
  writeFileSync(settingsFile, JSON.stringify({ statusLine: { type: "command", command: statusLineCommand(deps.host, deps.port, deps.sessionId) } }), {
    mode: 0o600,
  });

  let stopped = false;
  let pty: ProbePty | null = null;
  const stop = (): void => {
    if (stopped) return;
    stopped = true;
    clearTimeout(timer);
    try {
      pty?.kill();
    } catch {
      // already gone
    }
    rmSync(dir, { recursive: true, force: true });
    deps.onSettled();
  };
  const timer = setTimeout(stop, PROBE_TIMEOUT_MS);

  try {
    pty = deps.spawn(["--permission-mode", "auto", "--settings", settingsFile], deps.cwd);
    // The prompt has to arrive after the TUI is listening; there is no readiness signal to wait
    // for that is worth parsing, and sending early costs only this probe.
    setTimeout(() => {
      if (stopped) return;
      pty?.write(PROBE_PROMPT);
      setTimeout(() => !stopped && pty?.write("\r"), TYPE_TO_SUBMIT_MS);
    }, BOOT_MS);
  } catch {
    // `claude` is not installed, or cannot be launched at all. Same outcome as any other failure.
    stop();
  }
  return stop;
}

// The TUI paints before it accepts input, and text typed into a still-booting one is lost.
const BOOT_MS = 4000;
// Enter sent in the same breath as the text can land before the input box has it.
const TYPE_TO_SUBMIT_MS = 800;
