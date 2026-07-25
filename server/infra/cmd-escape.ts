// Building the command line that runs a Windows batch shim (`claude.cmd` from an npm-global
// install) under `cmd.exe`. CreateProcessW — what node-pty ultimately calls — executes PE
// images only, so a batch target has no other way in (#798).
//
// The command line is then parsed TWICE: by cmd.exe, and by the child's CRT. The two
// disagree about escaping, and cmd's rules are the ones that decide whether an argument
// stays an argument: `\"` (the CRT's escape, and what node-pty's own argsToCommandLine
// emits) does not escape a quote for cmd — it ends the quoted run, after which a `&` in the
// same argument is a command separator. Hence the rules below, which are cmd's.

/** An argument that cannot be represented on a Windows command line. Thrown rather than
 *  silently mangled: a truncated argument reaches the agent as a DIFFERENT instruction. */
export class UnsafeArgumentError extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = "UnsafeArgumentError";
  }
}

// A command line has no encoding for these: CR/LF end it, NUL terminates it.
const UNREPRESENTABLE = /[\0\r\n]/;

// Counted rather than matched: an anchored `\\+$` backtracks over a long run.
const trailingBackslashCount = (text: string): number => {
  const fromEnd = [...text].reverse().findIndex((ch) => ch !== "\\");
  return fromEnd === -1 ? text.length : fromEnd;
};

/** One argument, quoted for cmd.exe. Always quoted — inside quotes cmd's metacharacters
 *  (`& | < > ^ ( )`) are literal, which is the whole defence. Internal quotes are doubled
 *  (cmd's escape), and a trailing backslash run is doubled so it escapes itself instead of
 *  the closing quote when the CRT parses the same text afterwards. */
export function escapeBatchArgument(arg: string): string {
  if (UNREPRESENTABLE.test(arg)) throw new UnsafeArgumentError(`argument contains a NUL, CR or LF: ${JSON.stringify(arg)}`);
  const quotesDoubled = arg.replace(/"/g, '""');
  return `"${quotesDoubled}${"\\".repeat(trailingBackslashCount(quotesDoubled))}"`;
}

/** Everything after `cmd.exe` for running `batchPath args…`.
 *
 *  `/d` skips AutoRun, so a `HKCU\…\Command Processor\AutoRun` command cannot run inside our
 *  session first. `/s` makes cmd strip exactly the outer quote pair and take the rest
 *  verbatim, instead of applying its "is the first token a quoted path?" heuristics to a line
 *  that already contains quoted arguments. */
export function batchCommandLine(batchPath: string, args: readonly string[]): string {
  const command = [escapeBatchArgument(batchPath), ...args.map(escapeBatchArgument)].join(" ");
  return `/d /s /c "${command}"`;
}
