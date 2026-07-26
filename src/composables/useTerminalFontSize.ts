import { ref } from "vue";
import {
  normalizeFontSize,
  TERMINAL_FONT_SIZE_DEFAULT,
  TERMINAL_FONT_SIZE_MAX,
  TERMINAL_FONT_SIZE_MIN,
  TERMINAL_FONT_SIZE_STEP,
} from "../../common/terminalFontSize";

// The app-wide xterm font size, in px. Kept in localStorage rather than config.json — the
// same place the theme lives, and per-browser is the right grain for a size: a phone and a
// desktop viewing the same server want different ones, which one shared value can't express.
// A directory's `.mulmoterminal.json` fontSize overrides this per terminal.
const STORAGE_KEY = "terminalFontSize";

// Storage access can throw (private mode / storage-blocked contexts), so reading is
// best-effort — a failure falls back to the default instead of breaking startup.
function loadFontSize(): number {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return normalizeFontSize(stored === null ? null : Number(stored)) ?? TERMINAL_FONT_SIZE_DEFAULT;
  } catch {
    return TERMINAL_FONT_SIZE_DEFAULT;
  }
}

const fontSize = ref<number>(loadFontSize());

export function useTerminalFontSize() {
  function setFontSize(next: number) {
    const size = normalizeFontSize(next);
    if (size === null) return;
    fontSize.value = size;
    try {
      localStorage.setItem(STORAGE_KEY, String(size));
    } catch {
      // storage blocked: the size still applies for this session, just isn't persisted
    }
  }
  const nudgeFontSize = (delta: number) => setFontSize(fontSize.value + delta);
  return {
    fontSize,
    setFontSize,
    nudgeFontSize,
    min: TERMINAL_FONT_SIZE_MIN,
    max: TERMINAL_FONT_SIZE_MAX,
    step: TERMINAL_FONT_SIZE_STEP,
  };
}
