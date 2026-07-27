// Deciding whether a paste is an image the terminal should intercept. Pure so the rule can
// be unit-tested without a real ClipboardEvent — the same reason dropPaths.ts exists.

// A screenshot (Cmd+Shift+4, Win+Shift+S) puts an image on the clipboard and nothing else.
// Copying from a web page puts text/html AND an image there, and copying a file in the OS
// file manager can too — intercepting those would break pasting text, which is the terminal's
// most-used gesture. So: an image, and only when no text came with it.
export function shouldInterceptImagePaste(types: readonly string[]): boolean {
  return types.some((type) => type.startsWith("image/")) && !types.includes("text/plain");
}

/** The image file on the clipboard, or null when this paste isn't one to intercept. */
export function pastedImageFile(clipboard: DataTransfer | null): File | null {
  if (!clipboard || !shouldInterceptImagePaste(clipboard.types)) return null;
  const item = [...clipboard.items].find((entry) => entry.kind === "file" && entry.type.startsWith("image/"));
  return item?.getAsFile() ?? null;
}
