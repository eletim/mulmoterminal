import { computed, type ComputedRef } from "vue";
import type { RightPane } from "./gridCell";

// What each cell already receives: all four are GRID state (see GridCellProps), which is why every
// cell type forwards exactly the same set.
export interface CellChromeSource {
  expanded: boolean;
  filesOpen?: boolean | undefined;
  rightPane?: RightPane | null | undefined;
  canvasAvailable?: boolean | undefined;
}

// The two booleans are resolved rather than passed through as `boolean | undefined`: under
// `exactOptionalPropertyTypes` an explicit `undefined` is not assignable to CellChromeButtons'
// `filesOpen?: boolean`, and it reads every one of them as a truthiness test — so absent and false
// were already the same answer there.
export interface CellChromeProps {
  expanded: boolean;
  filesOpen: boolean;
  rightPane: RightPane | null;
  canvasAvailable: boolean;
}

export type CellChromeEvent = "toggle-expand" | "toggle-files" | "toggle-canvas" | "toggle-tools" | "close";

// Bound as two objects rather than spelled out in each template.
//
// The command, launcher and terminal cells wired the same four props and the same five events, and
// TerminalCell did it twice (its cockpit header and its normal header) — four copies that all had
// to agree, so adding a fifth button meant remembering every one of them.
//
// `close` is the one that genuinely differs by OWNERSHIP. Persistent TerminalCell and LauncherCell
// inject the shared confirmed Core Delete owner; ephemeral CommandCell uses the local forward.
export function cellChromeBinding(
  source: CellChromeSource,
  emit: (event: CellChromeEvent) => void,
  close: () => void = () => emit("close"),
): { chromeProps: ComputedRef<CellChromeProps>; chromeEvents: Record<CellChromeEvent, () => void> } {
  return {
    chromeProps: computed(() => ({
      expanded: source.expanded,
      filesOpen: source.filesOpen ?? false,
      rightPane: source.rightPane ?? null,
      canvasAvailable: source.canvasAvailable ?? false,
    })),
    chromeEvents: {
      "toggle-expand": () => emit("toggle-expand"),
      "toggle-files": () => emit("toggle-files"),
      "toggle-canvas": () => emit("toggle-canvas"),
      "toggle-tools": () => emit("toggle-tools"),
      close,
    },
  };
}

// The other half of the same idea, for CellShell. The injected close is load-bearing: persistent
// LauncherCell supplies confirmed Core Delete, while ephemeral CommandCell uses the local default.
export type CellShellEvent = CellChromeEvent | "move";

export function cellShellEvents(
  emit: {
    (event: CellChromeEvent): void;
    (event: "move", dir: -1 | 1): void;
  },
  close: () => void = () => emit("close"),
): Record<CellChromeEvent, () => void> & { move: (dir: -1 | 1) => void } {
  return {
    "toggle-expand": () => emit("toggle-expand"),
    "toggle-files": () => emit("toggle-files"),
    "toggle-canvas": () => emit("toggle-canvas"),
    "toggle-tools": () => emit("toggle-tools"),
    close,
    move: (dir: -1 | 1) => emit("move", dir),
  };
}
