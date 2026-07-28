// Whether MulmoTerminal may comment on the issue a cell is working on (#979), hydrated once from
// /api/config. A plain module value for the same reasons as copyOnSelect.ts: nothing renders it,
// one answer applies to every cell, and the composable that acts on it stays free of the config
// layer.
let enabled = false;

export const isIssueWorkCommentsEnabled = (): boolean => enabled;
export const setIssueWorkComments = (value: unknown): void => {
  enabled = value === true;
};
