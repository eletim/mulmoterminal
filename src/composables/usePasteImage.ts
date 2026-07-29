// Pasting a screenshot into a terminal: save it through the server and insert the saved
// file's absolute path at the cursor. The clipboard carries bytes and an agent reads paths,
// so something has to bridge the two — the same job the paperclip button and a file drop do,
// arriving at the same insertText().
//
// The bridge itself is the DROP upload (#993): a clipboard image is a File with no path, which
// is exactly what that route already takes. So this file decides only what a paste means; where
// the bytes go, how they are named, how big they may be and which directory the agent is allowed
// to read them from are answered once, in dropUpload.ts and session-drops.ts.

import { pastedImageFile } from "../components/pasteImage";
import { toShellArg } from "../components/dropPaths";
import { dropUploadErrorMessage, uploadDroppedFile } from "../components/dropUpload";

interface PasteImageHandlers {
  // Null while the cell has no session yet — the same state a drop reports rather than uploading
  // into nowhere, since the save directory is granted to a session at spawn time.
  sessionId: () => string | null;
  insertText: (text: string) => void;
  onError: (message: string) => void;
}

/** A `paste` handler for the terminal's container. Returns false — and touches nothing —
 *  when the paste isn't an image, leaving xterm's own text handling alone. */
export function createImagePasteHandler({ sessionId, insertText, onError }: PasteImageHandlers) {
  return function onPaste(event: ClipboardEvent): boolean {
    const file = pastedImageFile(event.clipboardData);
    if (!file) return false;
    const session = sessionId();
    // Claimed before the upload resolves: xterm's own paste handlers run in the same tick,
    // and awaiting first would let the image reach the terminal as nothing at all.
    event.preventDefault();
    event.stopPropagation();
    if (!session) {
      onError(PASTE_NO_SESSION_EN);
      return true;
    }
    // A clipboard image usually has no filename; the drop route then takes the extension from the
    // content type, which is why nothing here has to invent one.
    void uploadDroppedFile(session, file).then((result) => {
      if (result.ok) return insertText(toShellArg(result.path));
      onError(dropUploadErrorMessage(result.status));
    });
    return true;
  };
}

export const PASTE_NO_SESSION_EN = "This terminal has no session yet — start one before pasting an image.";
