// Whether a settled mouse selection goes straight to the clipboard (#900), hydrated once from
// /api/config and read by every terminal's selection handler. A plain module value, not a ref:
// nothing renders it, one global answer applies to all open terminals, and keeping it free of
// xterm imports lets useAppConfig set it without pulling the terminal manager into the config
// layer — the same arrangement as terminalSubmitMode.ts.
let enabled = false;

export const isCopyOnSelectEnabled = (): boolean => enabled;
export const setCopyOnSelect = (value: unknown): void => {
  enabled = value === true;
};
