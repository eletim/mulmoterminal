// @vitest-environment node
import { describe, it, expect } from "vitest";
import {
  tmuxSessionName,
  tmuxAttachSessionArgs,
  TMUX_CONF_LINES,
  parseTmuxEnvironment,
  parseAttachedClientCount,
  parseTmuxClientSessions,
  parseTmuxTerminalModes,
  parseTmuxWindowSize,
  parseTmuxPanePid,
  redrawTargets,
  planMsOverride,
  MS_OVERRIDE_ENTRY,
} from "../../../server/infra/tmux";

describe("tmuxSessionName", () => {
  it("uses the Core session id unchanged", () => {
    expect(tmuxSessionName("abc-123")).toBe("abc-123");
  });
});

describe("tmuxAttachSessionArgs", () => {
  it("attaches to the Core id on the dedicated server", () => {
    expect(tmuxAttachSessionArgs("id1")).toEqual(["-L", "mulmoterminal-core", "attach-session", "-t", "id1"]);
  });
});

describe("TMUX_CONF_LINES", () => {
  it("keeps mouse enabled for raw attached-client click forwarding", () => {
    expect(TMUX_CONF_LINES).toContain("set -g mouse on");
  });

  // Regression: tmux swallows a program's OSC 52 unless set-clipboard is on AND the outer
  // terminal is known to support it (the Ms override) — else Claude's auto-copy (#206)
  // never reaches the browser clipboard inside grid terminals.
  it("forwards OSC 52 to the outer terminal (Claude's auto-copy → browser clipboard)", () => {
    expect(TMUX_CONF_LINES).toContain("set -g set-clipboard on");
    expect(TMUX_CONF_LINES.some((l) => l.includes("terminal-overrides") && l.includes("Ms="))).toBe(true);
  });

  it("does not install tmux copy-mode wheel bindings", () => {
    expect(TMUX_CONF_LINES.some((line) => line.includes("Wheel") || line.includes("copy-mode"))).toBe(false);
  });

  // Not cosmetic any more: the size check compares `window_height` against the client's, and a
  // status line reserves a row — so with the bar on, every resize would read as a disagreement and
  // nudge the pty for nothing (#957). Measured: with the bar on, `client=80x24` vs `window=80x23`.
  it("turns the status line off, which the window/client size comparison depends on", () => {
    expect(TMUX_CONF_LINES).toContain("set -g status off");
  });

  // #783: tmux strips OSC 8 hyperlinks (Claude's statusline `PR #NNNN`) unless told the outer
  // terminal has the `hyperlinks` feature — same shape as the Ms override above.
  it("forwards OSC 8 hyperlinks to the outer terminal", () => {
    expect(TMUX_CONF_LINES.some((l) => l.includes("terminal-features") && l.includes("hyperlinks"))).toBe(true);
  });

  // Regression (#740): with DOUBLE quotes tmux escape-processes the value while parsing the
  // conf — `\E` becomes a bare `E` and `\007` a raw BEL — so the stored capability emits
  // `E]52;…` as literal text and the clipboard write never happens. Measured on tmux 3.6a.
  it("single-quotes the Ms override so tmux stores `\\E` rather than eating it", () => {
    const line = TMUX_CONF_LINES.find((l) => l.includes("Ms="));
    expect(line).toBe(`set -ag terminal-overrides ',${MS_OVERRIDE_ENTRY}'`);
    expect(line).not.toContain('"');
    expect(MS_OVERRIDE_ENTRY).toContain("Ms=\\E]52;");
  });
});

describe("planMsOverride", () => {
  // Captured from a real `tmux -L … show -g terminal-overrides` on tmux 3.6a. tmux doubles
  // each stored backslash on the way out, so a working entry reads `Ms=\\E]52;`.
  const DEFAULT_ONLY = "terminal-overrides[0] linux*:AX@\n";
  const WORKING = `${DEFAULT_ONLY}terminal-overrides[1] "*:Ms=\\\\E]52;%p1%s;%p2%s\\\\007"\n`;
  const BROKEN = `${DEFAULT_ONLY}terminal-overrides[1] "*:Ms=E]52;%p1%s;%p2%s\\a"\n`;

  it("appends when the server has no OSC 52 override yet", () => {
    expect(planMsOverride(DEFAULT_ONLY)).toEqual({ kind: "append" });
    expect(planMsOverride("")).toEqual({ kind: "append" });
  });

  it("leaves a correctly-stored override alone", () => {
    expect(planMsOverride(WORKING)).toEqual({ kind: "ok" });
  });

  // A server started before #740 keeps the broken value for its whole life — rewriting that
  // one index is the only way an upgrade reaches it.
  it("rewrites the entry a pre-fix server stored with the escape eaten", () => {
    expect(planMsOverride(BROKEN)).toEqual({ kind: "replace", index: 1 });
  });

  it("ignores overrides that are not ours", () => {
    expect(planMsOverride("terminal-overrides[0] xterm*:XT\nterminal-overrides[1] screen*:Ms@\n")).toEqual({ kind: "append" });
  });
});

describe("parseTmuxEnvironment", () => {
  it("reads plain NAME=value lines", () => {
    const env = parseTmuxEnvironment("HOME=/Users/u\nPATH=/usr/bin:/bin\n");
    expect(env.get("HOME")).toBe("/Users/u");
    expect(env.get("PATH")).toBe("/usr/bin:/bin");
    expect(env.size).toBe(2);
  });

  it("omits vars already flagged for removal (rendered as -NAME)", () => {
    const env = parseTmuxEnvironment("-PREFIX\nHOME=/Users/u\n");
    expect(env.has("PREFIX")).toBe(false);
    expect(env.get("HOME")).toBe("/Users/u");
  });

  it("keeps a multi-line value whole instead of reading its lines as new vars", () => {
    const env = parseTmuxEnvironment("SSH_KEY=-----BEGIN-----\nabc\n-----END-----\nHOME=/Users/u\n");
    expect(env.get("SSH_KEY")).toBe("-----BEGIN-----\nabc\n-----END-----");
    expect(env.get("HOME")).toBe("/Users/u");
  });

  // Regression: a naive line split read a multi-line value's continuations as
  // variable names, so a line beginning `PATH=` inside an exported bash function
  // would have clobbered the real PATH. A name we can't parse is skipped whole —
  // we only ever act on plainly-named vars, so silence is the safe outcome.
  it("never lets a continuation line inside an unparseable var become a var", () => {
    const env = parseTmuxEnvironment("BASH_FUNC_ls%%=() {\n  PATH=/injected\n}\nPATH=/usr/bin\n");
    expect(env.get("PATH")).toBe("/usr/bin");
    expect([...env.keys()]).toEqual(["PATH"]);
  });

  it("does not let the trailing newline extend the last value", () => {
    expect(parseTmuxEnvironment("PATH=/usr/bin\n").get("PATH")).toBe("/usr/bin");
  });

  it("keeps an empty value, and tolerates empty output", () => {
    expect(parseTmuxEnvironment("EMPTY=\n").get("EMPTY")).toBe("");
    expect(parseTmuxEnvironment("").size).toBe(0);
  });
});

describe("parseTmuxPanePid", () => {
  it("reads a positive integer pid", () => {
    expect(parseTmuxPanePid("12345\n")).toBe(12345);
  });

  it("returns null for anything that is not a usable pid", () => {
    expect(parseTmuxPanePid("")).toBeNull();
    expect(parseTmuxPanePid("0")).toBeNull();
    expect(parseTmuxPanePid("1.5")).toBeNull();
    expect(parseTmuxPanePid("no pane")).toBeNull();
  });
});

describe("parseAttachedClientCount", () => {
  it("reads the client count", () => {
    expect(parseAttachedClientCount("2\n")).toBe(2);
    expect(parseAttachedClientCount("0")).toBe(0);
  });

  // The caller decides whether to KILL a session, so "we could not tell" has to be
  // distinguishable from "nobody is attached" — null, never 0.
  it("returns null for anything that is not a count", () => {
    expect(parseAttachedClientCount("")).toBeNull();
    expect(parseAttachedClientCount("no server running")).toBeNull();
    expect(parseAttachedClientCount("-1")).toBeNull();
    expect(parseAttachedClientCount("1.5")).toBeNull();
  });
});

describe("parseTmuxClientSessions", () => {
  // One line per CLIENT, so the count of a session is how many times its name appears — two
  // mulmoterminal processes on one session is exactly the case this has to see (#1207).
  it("counts the clients on each of our sessions", () => {
    expect(parseTmuxClientSessions("a\nb\na\n")).toEqual(
      new Map([
        ["a", 2],
        ["b", 1],
      ]),
    );
  });

  it("ignores empty output", () => {
    expect(parseTmuxClientSessions("")).toEqual(new Map());
  });

  // A session with no client does not appear at all, which is what makes "absent" mean zero
  // rather than unknown — the caller can only tell the two apart from the CALL failing.
  it("has no entry for a session nobody holds", () => {
    expect(parseTmuxClientSessions("a\n").has("b")).toBe(false);
  });

  it("survives CRLF", () => {
    expect(parseTmuxClientSessions("a\r\na\r\n")).toEqual(new Map([["a", 2]]));
  });
});

// Fields, in order: alternate_on, mouse_standard_flag, mouse_button_flag, mouse_all_flag,
// mouse_utf8_flag, mouse_sgr_flag.
describe("parseTmuxTerminalModes", () => {
  // Measured on a live Claude Code 2.1.220 pane under tmux 3.6a.
  it("reads a mouse TUI's pane as the alternate buffer plus its tracking and SGR modes", () => {
    expect(parseTmuxTerminalModes("1,0,0,1,0,1\n")).toEqual([1049, 1003, 1006]);
  });

  it("reads a plain shell's pane as nothing to restore", () => {
    expect(parseTmuxTerminalModes("0,0,0,0,0,0\n")).toEqual([]);
  });

  it("maps the older tracking flags too", () => {
    expect(parseTmuxTerminalModes("1,1,1,0,1,1")).toEqual([1049, 1000, 1002, 1005, 1006]);
  });

  // A tmux that doesn't know a variable renders it EMPTY. The remaining fields must keep their
  // own modes rather than sliding onto the previous one.
  it("keeps the fields aligned when a variable is unknown to this tmux", () => {
    expect(parseTmuxTerminalModes("1,0,0,,,1")).toEqual([1049, 1006]);
  });

  it("restores nothing from output tmux could not produce", () => {
    expect(parseTmuxTerminalModes("")).toEqual([]);
    expect(parseTmuxTerminalModes("no server running")).toEqual([]);
  });
});

// Fields: `#{client_pid} #{client_tty}`.
describe("redrawTargets", () => {
  const OUR_PID = 29421;

  it("repaints our own client", () => {
    expect(redrawTargets(`${OUR_PID} /dev/ttys019\n`, OUR_PID)).toEqual(["/dev/ttys019"]);
  });

  // tmux promises nothing about the order of list-clients, so taking the first line would send the
  // repaint to another server's browser and leave this one showing the half-built screen.
  it("picks ours out of a session several clients are attached to, wherever it is listed", () => {
    const listed = `40100 /dev/ttys002\n${OUR_PID} /dev/ttys019\n40200 /dev/ttys044\n`;
    expect(redrawTargets(listed, OUR_PID)).toEqual(["/dev/ttys019"]);
  });

  // Repainting someone else's client is harmless; repainting nobody is the bug itself.
  it("falls back to every client when our pid is not in the list", () => {
    const listed = `40100 /dev/ttys002\n40200 /dev/ttys044\n`;
    expect(redrawTargets(listed, OUR_PID)).toEqual(["/dev/ttys002", "/dev/ttys044"]);
  });

  it("has nothing to repaint when no client is attached", () => {
    expect(redrawTargets("", OUR_PID)).toEqual([]);
    expect(redrawTargets("\n \n", OUR_PID)).toEqual([]);
  });

  it("ignores a line that carries no tty", () => {
    expect(redrawTargets(`${OUR_PID}\n${OUR_PID} /dev/ttys019\n`, OUR_PID)).toEqual(["/dev/ttys019"]);
  });
});

describe("parseTmuxWindowSize", () => {
  it("reads the pair tmux prints", () => {
    expect(parseTmuxWindowSize("120x40\n")).toEqual({ cols: 120, rows: 40 });
  });

  // Every non-answer must read as "don't know", never as a disagreement: the caller RESIZES a
  // live session on a disagreement, and tmux answers with an error line for a session that has
  // gone (#957).
  it("refuses anything that is not a pair of numbers", () => {
    expect(parseTmuxWindowSize("")).toBeNull();
    expect(parseTmuxWindowSize("can't find session: mt-x")).toBeNull();
    expect(parseTmuxWindowSize("120x")).toBeNull();
    expect(parseTmuxWindowSize("x40")).toBeNull();
    expect(parseTmuxWindowSize("120x40x10")).toBeNull();
    expect(parseTmuxWindowSize("-1x40")).toBeNull();
  });
});
