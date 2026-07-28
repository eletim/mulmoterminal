// Which directory each grid session was started in, as it is read from and written back to disk.
//
// The phone's session list shows a directory, and #1014 resolves the cell's PR/issue from it — but
// both read `ptys`, the table of PTYs THIS process spawned. A session that outlived a restart is
// not in it, so it arrived on the phone with no directory and no work item (#1021). Nothing else
// remembered where it was running: the id log next door stores ids and nothing more.
//
// A SEPARATE file from that id log, deliberately. Both are shared between instances — and between
// VERSIONS, since ~/.mulmoterminal is one directory for every server on the machine. Widening the
// id log's lines to carry a cwd would make an older build's parser drop every line (it keeps
// strings only), and that log exists to keep grid transcripts out of the chat sidebar: an older
// build would quietly bring that bug back. A new file it has never heard of is simply ignored.
//
// Same append-log shape as the id log, for the same reason: two instances writing at once cannot
// lose each other's entries when nobody reads before writing.

export interface DevTerminalCwd {
  id: string;
  cwd: string;
}

/** One line: `<id> <absolute path>`. The id cannot contain a space, so the first one splits it. */
function recordFromLine(line: string, isValidId: (id: string) => boolean): DevTerminalCwd | null {
  const text = line.trim();
  const at = text.indexOf(" ");
  if (at <= 0) return null;
  const id = text.slice(0, at);
  const cwd = text.slice(at + 1).trim();
  return isValidId(id) && cwd !== "" ? { id, cwd } : null;
}

/**
 * The directories a file holds, id → cwd.
 *
 * The LAST entry for an id wins: the same cell can be relaunched somewhere else, and the log only
 * ever grows, so the newest line is the current answer.
 */
export function parseDevTerminalCwds(contents: string, isValidId: (id: string) => boolean): Map<string, string> {
  const out = new Map<string, string>();
  contents.split("\n").forEach((line) => {
    const record = recordFromLine(line, isValidId);
    if (record) out.set(record.id, record.cwd);
  });
  return out;
}

/**
 * What to append for a session.
 *
 * The newline goes BEFORE the record, exactly as in the id log: a file that ended without one
 * would otherwise weld this record onto the previous line and lose both.
 */
export function devTerminalCwdLine(id: string, cwd: string): string {
  return `\n${id} ${cwd}`;
}
