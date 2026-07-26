import { describe, it, expect } from "vitest";
import { globalFontFamily, setGlobalFontFamily } from "../../../src/composables/terminalFontFamily";
import { TERMINAL_FONT_FAMILY_DEFAULT } from "../../../common/terminalFontFamily";

describe("globalFontFamily", () => {
  // A terminal can mount before /api/config resolves, so the pre-hydration value has to be the
  // one an unset config would produce — not a blank that would render in the browser default.
  it("starts on the built-in stack", () => {
    expect(globalFontFamily.value).toBe(TERMINAL_FONT_FAMILY_DEFAULT);
  });

  it("adopts a stack from the config, normalized", () => {
    setGlobalFontFamily("Cica");
    expect(globalFontFamily.value).toBe("Cica, monospace");
  });

  // `fontFamily` is absent from every config.json written before this feature existed, which is
  // the overwhelmingly common case — it must read as "use the default", not as an error state.
  it("falls back to the built-in stack for an unset or unusable value", () => {
    setGlobalFontFamily("Cica");
    setGlobalFontFamily(undefined);
    expect(globalFontFamily.value).toBe(TERMINAL_FONT_FAMILY_DEFAULT);

    setGlobalFontFamily("Cica");
    setGlobalFontFamily("Cica; color: red");
    expect(globalFontFamily.value).toBe(TERMINAL_FONT_FAMILY_DEFAULT);
  });
});
