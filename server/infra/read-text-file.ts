// Reading a file a HUMAN may have edited, which on Windows means one that may start with a
// byte-order mark.
//
// Notepad, `Set-Content` and PowerShell 5.1's `Out-File -Encoding utf8` all write UTF-8 WITH a
// BOM, and node's "utf8" decoding keeps it as a leading U+FEFF. `JSON.parse` then throws on
// the very first character, and every config reader here answers a throw the same way — with
// an empty config — so the whole file goes silently missing: a directory's colours, a
// provider's registration, the Run menu's scripts. Nothing says why.
//
// The rule already existed for SKILL.md frontmatter (server/skills/discovery.ts) and for
// wiki pages (src/wikiMarkdown.ts); this is the same rule where the JSON readers can reach it.
import { readFileSync } from "node:fs";

/** Drop a leading byte-order mark. Only the leading one: a U+FEFF anywhere else is content. */
export const stripBom = (text: string): string => (text.charCodeAt(0) === 0xfeff ? text.slice(1) : text);

/** A text file's contents, BOM-free. */
export const readTextFile = (file: string): string => stripBom(readFileSync(file, "utf8"));

/** Parse a JSON file a human may have edited. Throws like JSON.parse — the callers here
 *  already decide what a corrupt file means, and that decision differs (an empty config vs.
 *  refusing to overwrite it), so it stays theirs. */
export const readJsonFile = (file: string): unknown => JSON.parse(readTextFile(file));
