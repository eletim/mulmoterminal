// The app's native `<select>` chrome, as a Tailwind utility string so the styling travels
// with the markup (docs/styling.md) instead of becoming a CSS class.
//
// A caller adds what is specific to its own select — `font-mono` for a model id, say — on
// top of this, so the box, border and focus ring stay one decision.

export const SELECT_CONTROL =
  "box-border w-full rounded-md border border-border bg-input px-2.5 py-[7px] text-[12px] text-fg focus:border-accent focus:outline-none";
