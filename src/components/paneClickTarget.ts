// Whether the grid is in a state where a path clicked in terminal output can open in the
// Files pane (#910). Split out of TerminalGrid because it is a decision, not wiring — and
// because every "no" here is a case where the pane would otherwise show the wrong file.
//
// Saying no costs the user nothing: the click keeps the route it had before (a new tab, or
// the full-screen Files view), so these can be strict.

export interface PaneClickState {
  /** Is a cell enlarged? Nothing is enlarged means there is no pane on screen. */
  zoomed: boolean;
  /** The enlarged cell's project dir. */
  expandedCwd: string | null;
  /** The dir the pane's tree is ACTUALLY rooted at — null before it has first opened. It
   *  trails `expandedCwd` when a re-root could not be saved out of, and a path relative to
   *  the enlarged cell would then resolve against the directory the pane stayed on. */
  paneCwd: string | null;
}

/** Can a click from the session running in `cwd` be shown in the pane right now? */
export function paneCanShowClick(state: PaneClickState, cwd: string): boolean {
  if (!state.zoomed) return false;
  // Every cell stays mounted while one is enlarged (the filmstrip), so a click can arrive
  // from a thumbnail — where the pane beside the ENLARGED cell is the wrong place for it.
  if (state.expandedCwd !== cwd) return false;
  return state.paneCwd === null || state.paneCwd === cwd;
}
