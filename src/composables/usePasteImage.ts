// Pasting a screenshot into a terminal: save it through the server and insert the saved
// file's absolute path at the cursor. The clipboard carries bytes and an agent reads paths,
// so something has to bridge the two — the same job the paperclip button and a file drop do,
// arriving at the same insertText().

import { pastedImageFile } from "../components/pasteImage";
import { toShellArg } from "../components/dropPaths";
import { isRecord } from "../../common/isRecord";

const UPLOAD_TIMEOUT_MS = 20_000;

async function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("could not read the pasted image"));
    reader.onload = () => (typeof reader.result === "string" ? resolve(reader.result) : reject(new Error("unexpected reader result")));
    reader.readAsDataURL(file);
  });
}

/** The absolute path the server saved the image at. Throws with a message worth showing. */
export async function savePastedImage(file: File): Promise<string> {
  const dataUrl = await readAsDataUrl(file);
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), UPLOAD_TIMEOUT_MS);
  try {
    const res = await fetch("/api/paste-image", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ dataUrl }),
      signal: abort.signal,
    });
    const data: unknown = await res.json().catch(() => null);
    const error = isRecord(data) && typeof data.error === "string" ? data.error : `HTTP ${res.status}`;
    if (!res.ok) throw new Error(error);
    if (!isRecord(data) || typeof data.path !== "string") throw new Error("the server returned no path");
    return data.path;
  } finally {
    clearTimeout(timer);
  }
}

interface PasteImageHandlers {
  insertText: (text: string) => void;
  onError: (message: string) => void;
}

/** A `paste` handler for the terminal's container. Returns false — and touches nothing —
 *  when the paste isn't an image, leaving xterm's own text handling alone. */
export function createImagePasteHandler({ insertText, onError }: PasteImageHandlers) {
  return function onPaste(event: ClipboardEvent): boolean {
    const file = pastedImageFile(event.clipboardData);
    if (!file) return false;
    // Claimed before the upload resolves: xterm's own paste handlers run in the same tick,
    // and awaiting first would let the image reach the terminal as nothing at all.
    event.preventDefault();
    event.stopPropagation();
    savePastedImage(file)
      .then((path) => insertText(toShellArg(path)))
      .catch((err: unknown) => onError(err instanceof Error ? err.message : "could not save the pasted image"));
    return true;
  };
}
