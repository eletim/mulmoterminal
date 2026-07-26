import { computed, ref, type ComputedRef } from "vue";
import { normalizeFontFamily, TERMINAL_FONT_FAMILY_DEFAULT } from "../../common/terminalFontFamily";

// The app-wide xterm font-family stack, hydrated from /api/config (`fontFamily` in
// ~/.mulmoterminal/config.json). A directory's `.mulmoterminal.json` fontFamily overrides it.
//
// Global, not per-browser like the font SIZE: a size is a display preference, so a phone and a
// desktop want their own, but a family names FONTS, and which fonts exist belongs to the machine
// the browser runs on — one answer for every client of one host.
//
// A ref rather than the plain module value `terminalSubmitMode` uses: hydration is async and a
// terminal can mount before /api/config resolves, so Terminal.vue watches this and re-applies the
// family when it lands. Starts at the built-in stack, which is also what an unset config means.
const current = ref<string>(TERMINAL_FONT_FAMILY_DEFAULT);

export const globalFontFamily: ComputedRef<string> = computed(() => current.value);

// Re-validated rather than trusted: the server validates what it loads, but this is the boundary,
// and an unusable stack reaches the canvas renderer if nothing checks. null (unset or garbage)
// keeps the built-in default.
export const setGlobalFontFamily = (fontFamily: unknown): void => {
  current.value = normalizeFontFamily(fontFamily) ?? TERMINAL_FONT_FAMILY_DEFAULT;
};
