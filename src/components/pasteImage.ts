// Deciding whether a paste is an image the terminal should intercept. Pure so the rule can
// be unit-tested without a real ClipboardEvent — the same reason dropPaths.ts exists.

import { isPasteableImageMime } from "../../common/pastedImageTypes";

// Two conditions, and the second is the one that keeps the terminal usable.
//
// A type the server can save: taking a paste away from xterm and THEN failing the upload
// leaves the user with nothing happening at all, so anything we can't store stays a normal
// paste.
//
// And no text alongside it: a screenshot (Cmd+Shift+4, Win+Shift+S) puts an image on the
// clipboard and nothing else, while copying rich text from a web page puts text/plain there
// too. Intercepting those would break pasting text, the terminal's most-used gesture.
// text/html WITHOUT text/plain — an image copied from a page — is still treated as an image,
// which is the useful reading of that paste here.
export function shouldInterceptImagePaste(types: readonly string[]): boolean {
  return types.some(isPasteableImageMime) && !types.includes("text/plain");
}

/** The image file on the clipboard, or null when this paste isn't one to intercept. */
export function pastedImageFile(clipboard: DataTransfer | null): File | null {
  if (!clipboard || !shouldInterceptImagePaste(clipboard.types)) return null;
  const item = [...clipboard.items].find((entry) => entry.kind === "file" && isPasteableImageMime(entry.type));
  return item?.getAsFile() ?? null;
}
