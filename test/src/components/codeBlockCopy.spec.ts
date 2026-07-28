import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { copyOutcomeFor, copyOutcomeMessage, type CopyOutcome } from "../../../src/components/codeBlockCopy";

// #865. Three of the four outcomes are not errors, and the value of separating them is that
// each needs a different sentence — "that reply had no code" and "this transcript is too big to
// read" are both silence from the button otherwise, and only one of them is a limit.
describe("copyOutcomeFor", () => {
  it("returns the last fenced block's body", () => {
    const reply = "here you go\n\n```ts\nconst a = 1;\n```\n\nand that's it";
    expect(copyOutcomeFor({ reply })).toEqual({ kind: "ok", text: "const a = 1;", lang: "ts" });
  });

  it("keeps the block's own indentation and blank lines", () => {
    const body = "function f() {\n  if (x) {\n\n    return 1;\n  }\n}";
    expect(copyOutcomeFor({ reply: "```js\n" + body + "\n```" })).toMatchObject({ kind: "ok", text: body });
  });

  it("reports no-code for a reply that is only prose", () => {
    expect(copyOutcomeFor({ reply: "I changed three files and pushed." })).toEqual({ kind: "no-code" });
  });

  // The size refusal rides on the same response as the turn, and the reply it comes with is
  // necessarily empty — so it has to be read FIRST or it reads as "no completed turn".
  it("reports too-large ahead of the empty reply that comes with it", () => {
    expect(copyOutcomeFor({ reply: null, tooLarge: true })).toEqual({ kind: "too-large" });
  });

  it.each([
    ["a session with nothing on disk yet", null],
    ["an empty reply", ""],
  ])("reports no-turn for %s", (_case, reply) => {
    expect(copyOutcomeFor({ reply })).toEqual({ kind: "no-turn" });
  });
});

describe("copyOutcomeMessage", () => {
  // Every outcome must say something. A missing case would surface as an empty toast, which is
  // exactly the "the button does nothing" complaint this feature is meant to avoid.
  it.each<CopyOutcome>([{ kind: "ok", text: "x", lang: null }, { kind: "no-code" }, { kind: "too-large" }, { kind: "no-turn" }])(
    "has a message for %o",
    (outcome) => {
      expect(copyOutcomeMessage(outcome).length).toBeGreaterThan(0);
    },
  );

  it("does not call any of them a failure — none is something a retry fixes", () => {
    const messages = (["no-code", "too-large", "no-turn"] as const).map((kind) => copyOutcomeMessage({ kind }));
    messages.forEach((m) => expect(m.toLowerCase()).not.toContain("error"));
  });
});

// The fallback dialog's contract, after Codex flagged it (#995 review). Asserted on the
// RENDERED dialog rather than on the source text: what matters is what a screen reader and the
// Escape key actually meet.
//
// The pattern to match is TimelineOverlay's, the app's only other modal — role + aria-modal on
// the BOX (the review found them on the backdrop), and Escape handled at the DOCUMENT. Bound to
// the overlay element instead, Escape fires only while focus is already inside it, which reads
// as "Escape sometimes works".
describe("the manual-copy dialog", () => {
  const REPLY = "here:\n\n```ts\nconst a = 1;\n```";

  // No Clipboard API is exactly the situation the dialog exists for: any address that is not
  // https or localhost, i.e. reaching this app from a phone.
  const withoutClipboard = async () => {
    vi.stubGlobal("navigator", { ...navigator, clipboard: undefined });
    vi.doMock("../../../src/composables/useHandoff", () => ({
      fetchLastTurn: async () => ({ prompt: null, reply: REPLY, text: "", tooLarge: false }),
    }));
    const { default: CopyCodeBlock } = await import("../../../src/components/CopyCodeBlock.vue");
    const w = mount(CopyCodeBlock, { props: { sessionId: "s", cwd: "/x", agent: "claude" as const } });
    await w.find("button").trigger("click");
    await flushPromises();
    await new Promise((r) => requestAnimationFrame(r));
    return w;
  };

  beforeEach(() => {
    vi.resetModules();
    document.body.innerHTML = "";
  });
  afterEach(() => vi.unstubAllGlobals());

  it("marks the BOX as the modal, not the backdrop", async () => {
    const w = await withoutClipboard();
    const dialog = document.body.querySelector('[role="dialog"]');
    expect(dialog).not.toBeNull();
    expect(dialog?.getAttribute("aria-modal")).toBe("true");
    expect(dialog?.getAttribute("tabindex")).toBe("-1");
    // The backdrop is the element that fills the screen; the dialog must not be it.
    expect(dialog?.className).not.toContain("inset-0");
    w.unmount();
  });

  it("puts the text in, selected, so one key copies it", async () => {
    const w = await withoutClipboard();
    const box = document.body.querySelector<HTMLTextAreaElement>('[data-testid="copy-block-text"]');
    expect(box?.value).toBe("const a = 1;");
    expect(document.activeElement).toBe(box);
    w.unmount();
  });

  it("closes on Escape raised at the document, with focus anywhere", async () => {
    const w = await withoutClipboard();
    (document.activeElement as HTMLElement)?.blur();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    await flushPromises();
    expect(document.body.querySelector('[role="dialog"]')).toBeNull();
    w.unmount();
  });
});
