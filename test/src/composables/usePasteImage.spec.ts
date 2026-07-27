import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createImagePasteHandler, savePastedImage } from "../../../src/composables/usePasteImage";

const png = () => new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], "shot.png", { type: "image/png" });

// jsdom has no clipboard, and the handler only reads what the browser reports.
function pasteEvent(types: string[], file: File | null): ClipboardEvent {
  const clipboardData = {
    types,
    items: file ? [{ kind: "file", type: file.type, getAsFile: () => file }] : [{ kind: "string", type: "text/plain", getAsFile: () => null }],
  };
  return {
    clipboardData,
    preventDefault: vi.fn(),
    stopPropagation: vi.fn(),
  } as unknown as ClipboardEvent;
}

const jsonResponse = (status: number, body: unknown) => ({ ok: status < 400, status, json: async () => body });

// One microtask turn is enough for FileReader + the mocked fetch to settle.
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("createImagePasteHandler", () => {
  beforeEach(() => vi.restoreAllMocks());
  afterEach(() => vi.unstubAllGlobals());

  it("saves the image and inserts the returned absolute path at the cursor", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse(200, { path: "/Users/me/.mulmoterminal/tmp/pasted/pasted-20260727-090503-007.png" })),
    );
    const insertText = vi.fn();
    const onError = vi.fn();
    const event = pasteEvent(["image/png"], png());

    expect(createImagePasteHandler({ insertText, onError })(event)).toBe(true);
    // Claimed synchronously — xterm's own paste handlers run in this same tick.
    expect(event.preventDefault).toHaveBeenCalled();
    expect(event.stopPropagation).toHaveBeenCalled();

    await settle();
    expect(insertText).toHaveBeenCalledWith("/Users/me/.mulmoterminal/tmp/pasted/pasted-20260727-090503-007.png");
    expect(onError).not.toHaveBeenCalled();
  });

  it("quotes a path that a shell would otherwise split", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse(200, { path: "/Users/me/My Dir/pasted-1.png" })),
    );
    const insertText = vi.fn();
    createImagePasteHandler({ insertText, onError: vi.fn() })(pasteEvent(["image/png"], png()));
    await settle();
    expect(insertText).toHaveBeenCalledWith("'/Users/me/My Dir/pasted-1.png'");
  });

  // The whole point of the type check: a text paste must reach xterm untouched.
  it("declines a text paste without touching the event or the network", () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const insertText = vi.fn();
    const event = pasteEvent(["text/plain"], null);

    expect(createImagePasteHandler({ insertText, onError: vi.fn() })(event)).toBe(false);
    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(event.stopPropagation).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(insertText).not.toHaveBeenCalled();
  });

  it("reports the server's reason instead of inserting nothing", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse(413, { error: "image too large" })),
    );
    const insertText = vi.fn();
    const onError = vi.fn();
    createImagePasteHandler({ insertText, onError })(pasteEvent(["image/png"], png()));
    await settle();
    expect(insertText).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledWith("image too large");
  });
});

describe("savePastedImage", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("posts the file as a data URL and returns the saved path", async () => {
    const fetchMock = vi.fn(async () => jsonResponse(200, { path: "/Users/me/.mulmoterminal/tmp/pasted/pasted-1.png" }));
    vi.stubGlobal("fetch", fetchMock);
    expect(await savePastedImage(png())).toBe("/Users/me/.mulmoterminal/tmp/pasted/pasted-1.png");
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/paste-image");
    expect(JSON.parse(String(init.body)).dataUrl).toMatch(/^data:image\/png;base64,/);
  });

  it("throws when the response carries no path", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse(200, { ok: true })),
    );
    await expect(savePastedImage(png())).rejects.toThrow("the server returned no path");
  });
});
