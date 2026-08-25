// What makes two Canvas results "the same thing", per tool — the `identityOf` accessors that
// src/plugins-registry.ts hands to collapseByIdentity (see canvasCollapse.ts for the rule they
// feed, and why the superseded card is dropped).
//
// Separate from the registry so they can be tested without mounting it: the registry pulls in
// every plugin's Vue View and compiled stylesheet, none of which this decision involves.
//
// Each returns null for a result that must stand alone. That is the important default — an
// unrecognised shape, or content with nothing durable behind it, has no business superseding a
// card that is still on screen.
import { documentPathOf, type MarkdownToolData } from "@mulmoclaude/markdown-plugin/vue";
import { isRecord } from "../../common/isRecord";

// A tool result's payload travels in `data` and `jsonData` both. Read through both because a
// partial update (a view persisting its state) may carry only one.
function payloadsOf(result: unknown): Record<string, unknown>[] {
  if (!isRecord(result)) return [];
  return [result.data, result.jsonData].filter(isRecord);
}

/** A non-empty string field off whichever payload carries it. */
export function payloadString(result: unknown, field: string): string | null {
  for (const payload of payloadsOf(result)) {
    const value = payload[field];
    if (typeof value === "string" && value) return value;
  }
  return null;
}

/**
 * presentDocument: the document on disk, or null for inline markdown.
 *
 * The package's own accessor rather than a field read — `docPath` is authoritative, but results
 * stored before that field existed kept the path in `markdown`, and only `documentPathOf` knows
 * which values in there mean "path" rather than "a one-line document".
 */
export function documentIdentity(result: unknown): string | null {
  for (const payload of payloadsOf(result)) {
    // Built field by field rather than cast: `markdown` is required on MarkdownToolData and a
    // partial update may not carry it, so an assertion here would be a lie the compiler rejects.
    // An absent one becomes "", which is not a path, leaving `docPath` to answer on its own.
    const { markdown, docPath } = payload;
    const data: MarkdownToolData = {
      markdown: typeof markdown === "string" ? markdown : "",
      // Omitted rather than set to undefined: exactOptionalPropertyTypes is on.
      ...(typeof docPath === "string" ? { docPath } : {}),
    };
    const path = documentPathOf(data);
    if (path) return path;
  }
  return null;
}

/**
 * presentHtml / presentMulmoScript: the artifact on disk.
 *
 * `filePath` is required on both payloads (the HTML is too large to travel in the result; the
 * story's path is the wire form every mulmoScript endpoint keys on), and each tool's CREATE path
 * writes a FRESH path — so this collapses re-presentations of one artifact without ever merging
 * two distinct ones.
 */
export function filePathIdentity(result: unknown): string | null {
  return payloadString(result, "filePath");
}
