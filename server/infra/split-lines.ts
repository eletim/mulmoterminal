// Text → lines, for text this process did not write: `git` / `gh` / `tmux` output, a JSONL
// transcript, a bundled markdown file.
//
// It exists because `split("\n")` was the rule in about twenty places and is silently wrong
// the moment the text is CRLF-terminated: the `\r` clings to the END of each line, so
// whatever a parser reads last carries it — a diff path that then 404s, an env value with an
// invisible character, a config key that matches nothing. Windows is where that arrives (a
// file checked out under `core.autocrlf`, a tool that ends its own lines with CRLF), and it
// is invisible from a POSIX host, so the parsers cannot be left to each remember a `.trim()`.
export const splitLines = (text: string): string[] => text.split(/\r?\n/);
