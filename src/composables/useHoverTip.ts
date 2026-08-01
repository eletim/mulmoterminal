// The cell header's hover tips (#1235): one shared tip, opened by whichever chip the pointer is on.
//
// A SINGLETON with handlers bound to the existing chip, rather than a wrapper component around each
// one. Two reasons, both about the header: it is a flex row whose children carry `flex-none` and
// `min-w-0` deliberately, so an extra element between them changes the layout the chips were tuned
// in; and one tip in the document cannot become two, which a per-chip component can when a pointer
// leaves one chip straight onto the next.
//
// Moving between chips needs no special handling: the DOM fires the old element's `pointerleave`
// BEFORE the new one's `pointerenter`, so the close-then-open lands in one tick and Vue renders it
// as a change of content rather than as a blink.
//
// No delay. That is the request, and it is also why `title` could not be kept: its delay belongs to
// the browser and is not settable from CSS or script.
import { ref, type Ref } from "vue";
import type { TipContent } from "../components/tipContent";
import type { TipRect } from "./hoverTipPlacement";

/** The one tip element's id, so an anchor can point at it with `aria-describedby` while its own tip
 *  is up. One id is enough precisely because there is only ever one tip. */
export const HOVER_TIP_ID = "hover-tip";

export interface OpenTip {
  content: TipContent;
  anchor: TipRect;
}

const tip = ref<OpenTip | null>(null);

const rectOf = (el: Element): TipRect => {
  const { top, bottom, left, right } = el.getBoundingClientRect();
  return { top, bottom, left, right };
};

/** Show `content` describing the element the handler is bound to; answers whether it opened.
 *
 *  Empty content CLOSES rather than opening an empty box: every builder in tipContent.ts answers
 *  `[]` for a state it cannot describe (a directory that is not a repo, a work item still being
 *  fetched), so this is the ordinary case for a chip whose data has not arrived yet. */
export function showHoverTip(event: Event, content: TipContent): boolean {
  const el = event.currentTarget;
  const open = el instanceof Element && content.length > 0;
  tip.value = open && el instanceof Element ? { content, anchor: rectOf(el) } : null;
  return open;
}

export function hideHoverTip(): void {
  tip.value = null;
}

/** Bind a chip to the shared tip. `content` is read at hover time rather than watched, because a
 *  header polls (git status, work item, context) and the value wanted is the one on screen now.
 *
 *  `described` is per-anchor so the chip can carry `aria-describedby` only while ITS tip is up —
 *  pointing at the tip while it describes a different chip would misread it to a screen reader. */
export function useHoverTipAnchor(content: () => TipContent) {
  const described = ref(false);
  const show = (event: Event): void => {
    described.value = showHoverTip(event, content());
  };
  const hide = (): void => {
    described.value = false;
    hideHoverTip();
  };
  return { described, show, hide };
}

export function useHoverTipState(): { tip: Ref<OpenTip | null> } {
  return { tip };
}
