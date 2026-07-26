import type { SortMode } from "./gridTabs";

// How the toolbar's ordering button presents each mode, and what one click moves to.
// Split out of AppToolbar.vue so the cycle and the wording are directly testable — the
// button is the only way to reach "priority", so a broken cycle would strand the feature.
export interface SortModeButton {
  icon: string;
  title: string;
  label: string;
  // Highlighted whenever an automatic ordering is in effect, i.e. anything but the
  // hand-arranged one. NOT aria-pressed: this cycles through three states, and
  // aria-pressed describes a binary toggle.
  active: boolean;
}

// auto → manual → priority → auto. `priority` sits last so the two long-standing modes
// keep their existing relationship (one click apart) for anyone used to them.
const NEXT: Record<SortMode, SortMode> = { auto: "manual", manual: "priority", priority: "auto" };
export const nextSortMode = (mode: SortMode): SortMode => NEXT[mode];

const PRESENTATION: Record<SortMode, { icon: string; title: string }> = {
  auto: {
    icon: "sort",
    title: "Auto order: attention-first — needs-attention cells float up (click for manual ◀▶ ordering)",
  },
  manual: {
    icon: "swap_horiz",
    title: "Manual order: reorder cells with ◀▶ (click to order by each directory's orderPriority)",
  },
  priority: {
    icon: "format_list_numbered",
    title: "Priority order: by each directory's orderPriority in .mulmoterminal.json, lowest first; unset directories last (click for auto attention-sort)",
  },
};

// The accessible name carries the CURRENT mode: with three states and no aria-pressed, a
// static "Toggle grid cell ordering" would leave a screen-reader user unable to tell which
// ordering is in effect.
export function sortModeButton(mode: SortMode): SortModeButton {
  const { icon, title } = PRESENTATION[mode];
  return { icon, title, label: `Grid cell ordering: ${mode} (click for ${nextSortMode(mode)})`, active: mode !== "manual" };
}
