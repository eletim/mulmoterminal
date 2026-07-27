<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount, onActivated, watch, nextTick, useTemplateRef } from "vue";
import TerminalCell from "./TerminalCell.vue";
import CommandCell from "./CommandCell.vue";
import LauncherCell from "./LauncherCell.vue";
import CockpitRowMenu from "./CockpitRowMenu.vue";
import CockpitHeader from "./CockpitHeader.vue";
import * as conn from "../composables/useTerminalConnections";
import { trackStyle, layoutForCount } from "./gridLayout";
import { cockpitLines } from "../composables/cockpitLines";
import { flipKeyframes, flipPairs, onScreen, FLIP_MS, FLIP_EASING } from "./cellFlip";
import { canMoveCell, type Cell, type CellStatus } from "./gridTabs";
import type { RunCommand } from "./runCommand";
import type { PrPhase, WorkPhase } from "./rosterPhase";
import type { CwdPreset } from "./presets";
import type { Launcher, LaunchPick } from "./launchers";
import { shouldFlipZoom } from "./cellChromeRules";
import { formatCwd } from "./cwdDisplay";
import FilesPane, { type FilesPaneState } from "./FilesPane.vue";
import { clampPaneWidth, splitterKeyWidth, MIN_GUI, MIN_TERMINAL } from "./splitterWidth";

// Renders the grid, auto-sized to the cell count, fully controlled by GridView:
// `cells` is the active page's slice (≤9) when nothing is zoomed, and `expandedUid`
// the zoomed cell; every change is emitted up by uid.
// Expanding a cell switches to a filmstrip — the zoomed cell (teleported to the
// overlay) fills the top, the rest line up in a scrollable strip below. While
// zoomed, GridView passes EVERY cell (all tabs), so the strip shows them all live.
// A cell carrying a `command` renders as a CommandCell (a running script.json
// command) instead of the Claude launcher/terminal.
export interface CockpitRow {
  uid: number;
  cwd: string | null;
  agent: string;
  status: CellStatus;
  summary: string | null; // AI title
  prompt: string | null; // current user prompt
  response: string | null; // tail of the agent's latest reply
  fallback: string | null; // label when there's no prompt/summary yet (launcher/command name)
  phase: PrPhase; // the branch's PR workflow phase (`none` until a PR exists)
  workPhase: WorkPhase | null; // planning vs editing while working; null when unknown / not working
  headerColor: string | null; // the directory's configured header background, tinting the row
  headerTextColor: string | null; // and its text colour, so the row stays legible on that tint
}
const props = defineProps<{
  cells: Cell[];
  expandedUid: number | null;
  // A text row per cell for the cockpit list shown beside the expanded terminal.
  listRows: CockpitRow[];
  cancelUid: number | null;
  defaultCwd: string | null;
  presets: CwdPreset[];
  launchers: Launcher[];
  home: string | null;
  // Manual sort mode: each cell shows move buttons to reorder.
  reorderable?: boolean;
  openSessionIds: string[];
  openCwds: string[];
  // While a cell is zoomed: cockpit roster (true) vs thumbnail strip (false). Owned by GridView
  // so the toggle can live in the global toolbar rather than float over the stage.
  listMode: boolean;
}>();
const emit = defineEmits<{
  (e: "session" | "cwd", uid: number, value: string): void;
  (e: "close" | "toggle-expand" | "focus-cell", uid: number): void;
  (e: "run" | "runSpare", uid: number, command: RunCommand): void;
  (e: "launch", uid: number, pick: LaunchPick): void;
  (e: "move", uid: number, dir: -1 | 1): void;
  (e: "status", uid: number, value: CellStatus): void;
  (e: "agent", uid: number, value: "claude" | "codex"): void;
  // Shared preset list events — uid-less since they mutate the one config list.
  (e: "record-cwd" | "remove-preset", value: string): void;
}>();

const gridStyle = computed(() => trackStyle(layoutForCount(props.cells.length)));

// The keyboard-focused cell, so it can lift + zoom slightly in place. `focusin` bubbles from the
// xterm textarea up to the grid, so one delegated listener suffices. It's sticky: focus moving to
// the toolbar doesn't reset it — only another cell taking focus moves the emphasis.
const focusedUid = ref<number | null>(null);
function onFocusIn(e: FocusEvent) {
  const target = e.target;
  if (!(target instanceof HTMLElement)) return;
  const el = target.closest<HTMLElement>("[data-uid]");
  if (!el?.dataset.uid) return;
  focusedUid.value = Number(el.dataset.uid);
  // GridView needs it too: un-zoomed it is the only "which terminal am I on" there is, and the
  // keyboard shortcuts rotate from it.
  emit("focus-cell", focusedUid.value);
}

// Returning to the grid via a top-tab switch reactivates it under <KeepAlive>, which does
// NOT re-run the cells' attach()/focus() — so nothing restores the cursor. Put it back in
// whichever cell last held it (sticky `focusedUid`, tracked in both the grid and the
// zoomed slot). Grid cells' durable connections are keyed `cell-<uid>`.
onActivated(() => {
  const uid = focusedUid.value;
  if (uid !== null) nextTick(() => conn.focus(`cell-${uid}`));
});
// Per-cell class: `flipping` drives the zoom FLIP, `focused` the in-place lift of the active cell —
// suppressed while expanded or mid-flip so it never fights those animations.
function cellClass(uid: number) {
  return {
    flipping: flippingUids.value.has(uid),
    focused: uid === focusedUid.value && props.expandedUid === null && !flippingUids.value.has(uid),
  };
}
// Hand the flip's timing to the stylesheet so the fade under it can't drift out of sync.
const flipVars = { "--flip-ms": `${FLIP_MS}ms`, "--flip-ease": FLIP_EASING };

// The zoomed cell is teleported up here; the target must exist before it moves, so
// hold off until mounted (covers a reload that restores a zoom).
const zoomMain = ref<HTMLElement | null>(null);
const mounted = ref(false);
onMounted(() => (mounted.value = true));
const zoomed = computed(() => props.expandedUid !== null && mounted.value);

// The file pane beside the enlarged cell. ONE pane, not one per cell: it re-roots to whichever
// cell is enlarged, so walking the zoom doesn't accumulate editors. Open-state and width are
// per-browser (localStorage), like the single view's splitter and the terminal font size.
const PANE_OPEN_KEY = "files_pane_open";
const PANE_WIDTH_KEY = "files_pane_width";
const PANE_WIDTH_DEFAULT = 480;
// Storage can throw (private mode / storage-blocked contexts), so both reads are best-effort.
const stored = (key: string): string | null => {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
};
const remember = (key: string, value: string): void => {
  try {
    localStorage.setItem(key, value);
  } catch {
    // storage blocked: the pane still works this session, it just isn't remembered
  }
};
const filesOpen = ref(stored(PANE_OPEN_KEY) === "1");
const paneWidth = ref(Number(stored(PANE_WIDTH_KEY)) || PANE_WIDTH_DEFAULT);
const zoomRow = ref<HTMLElement | null>(null);
const rowWidth = () => zoomRow.value?.clientWidth ?? 0;
// Mirrored into a ref so the separator can announce its range (a plain function call would not
// re-render when the row resizes). The pane's floor gives way to the terminal's on a narrow row,
// which is why the minimum is itself clamped.
const rowWidthNow = ref(0);
const paneMax = computed(() => Math.max(0, rowWidthNow.value - MIN_TERMINAL));
const paneMin = computed(() => Math.min(MIN_GUI, paneMax.value));

function setFilesOpen(open: boolean): void {
  if (!open) rememberPaneState(paneUid.value);
  filesOpen.value = open;
  // Closing drops the root it was on, so re-opening lands on whichever cell is enlarged THEN
  // rather than resuming a directory the user has since walked away from.
  if (!open) paneCwd.value = null;
  remember(PANE_OPEN_KEY, open ? "1" : "0");
}

// The header toggle. Closing unmounts the pane, buffer and all, so the buffer is saved on the
// way out — the pane's OWN close button has already flushed by the time it emits, which is why
// that path stays separate rather than routing through here.
async function toggleFiles(): Promise<void> {
  // Closing unmounts the buffer with the pane, so a buffer that could be neither saved nor
  // backed up keeps the pane open — the error is visible in it.
  if (filesOpen.value && (await filesPane.value?.flush()) === false) return;
  setFilesOpen(!filesOpen.value);
}

// The enlarged cell's project dir — what the pane browses. A cell that hasn't reported one yet
// (a launcher, a session still starting) falls back to the grid's default.
const expandedCwd = computed(() => props.cells.find((c) => c.uid === props.expandedUid)?.cwd ?? props.defaultCwd);
const filesPane = ref<InstanceType<typeof FilesPane> | null>(null);
// What the pane looked like in each cell, so coming back to a terminal doesn't mean opening
// the same three directories again. Saved state only — the buffer went to disk on the way out
// (or to the backup store), so there is nothing unsaved to carry. In memory: a reload starts
// the grid over anyway, and stale paths from a previous session would only mislead.
const paneStateByUid = new Map<number, FilesPaneState>();
const rememberPaneState = (uid: number | null): void => {
  const snapshot = uid !== null ? filesPane.value?.snapshot() : undefined;
  if (uid !== null && snapshot) paneStateByUid.set(uid, snapshot);
};
const paneState = ref<FilesPaneState | null>(null);
// The root the pane is ACTUALLY on. Normally `expandedCwd`, but it stays behind when a re-root
// is declined over unsaved edits — and it, not `expandedCwd`, is what the pane is handed, so a
// file opened from a tree that stayed put still resolves against the directory it came from.
const paneCwd = ref<string | null>(null);
// Which cell the pane is showing. Tracks `paneCwd` rather than `expandedUid`, or a re-root that
// could not be saved out of would file its snapshot under the cell it never moved to.
const paneUid = ref<number | null>(null);
watch(paneCwd, () => (paneUid.value = paneCwd.value === null ? null : (props.expandedUid ?? null)));

// Walking the zoom to another terminal has to re-root the pane: the pane deliberately ignores
// its `cwd` prop (see its defineExpose contract), so nothing else would move it. The buffer is
// saved first rather than asked about — the zoom moves from keys and filmstrip clicks, and a
// dialog on each of those would interrupt the very flow the pane is meant to sit beside.
watch(
  [filesOpen, zoomed, expandedCwd],
  async ([open, isZoomed]) => {
    if (!open || !isZoomed || paneCwd.value === expandedCwd.value) return;
    // First showing: the pane is about to mount against this root, so there is nothing to re-read.
    if (paneCwd.value === null) {
      paneCwd.value = expandedCwd.value;
      paneState.value = paneStateByUid.get(props.expandedUid ?? -1) ?? null;
      return;
    }
    // Re-rooting re-reads the tree and drops the buffer with it. Nothing to fall back on means
    // staying put: the pane keeps the old root, which its header names.
    if ((await filesPane.value?.flush()) === false) return;
    rememberPaneState(paneUid.value);
    paneCwd.value = expandedCwd.value;
    paneState.value = paneStateByUid.get(props.expandedUid ?? -1) ?? null;
    await nextTick(); // the pane reads its `cwd` prop when reloading, so let the new one land
    filesPane.value?.reload();
  },
  { immediate: true },
);

function setPaneWidth(width: number): void {
  const available = rowWidth();
  rowWidthNow.value = available;
  // Before the row is laid out there is nothing to clamp against, and clamping against zero
  // would "correct" the width to a negative one.
  if (available <= 0) return;
  paneWidth.value = clampPaneWidth(width, available);
}
function onSplitterDown(e: PointerEvent): void {
  const startX = e.clientX;
  const startWidth = paneWidth.value;
  // Dragging LEFT grows the pane, so the delta is subtracted.
  const onMove = (ev: PointerEvent) => setPaneWidth(startWidth - (ev.clientX - startX));
  const onUp = () => {
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);
    remember(PANE_WIDTH_KEY, String(paneWidth.value));
  };
  window.addEventListener("pointermove", onMove);
  window.addEventListener("pointerup", onUp);
}
// The keys act on the TERMINAL's width (ArrowLeft shrinks it, growing the pane), which is what
// splitterKeyWidth speaks — the pane's width is the remainder. Returning null means the key
// isn't ours, and the separator must not swallow Tab or Escape.
function onSplitterKey(e: KeyboardEvent): void {
  const available = rowWidth();
  const next = splitterKeyWidth(e.key, available - paneWidth.value, available);
  if (next === null) return;
  e.preventDefault();
  setPaneWidth(available - next);
  remember(PANE_WIDTH_KEY, String(paneWidth.value));
}
// A window that shrank below the two floors would otherwise leave the pane wider than the row.
const reclampPane = () => filesOpen.value && setPaneWidth(paneWidth.value);
onMounted(() => window.addEventListener("resize", reclampPane));
onBeforeUnmount(() => window.removeEventListener("resize", reclampPane));

// A width restored from storage was clamped against WHATEVER row existed when it was stored —
// a wider window, or the other zoom mode. Re-clamp once the row is actually on screen, or a
// remembered 900px opens against a 1000px row and leaves the terminal 100px wide.
watch([filesOpen, zoomed, () => props.listMode], async ([open, isZoomed]) => {
  if (!open || !isZoomed) return;
  await nextTick();
  setPaneWidth(paneWidth.value);
});

const stage = ref<HTMLElement | null>(null);
// The cells currently flying between slots. Also gates the stylesheet: the cells not in
// flight fade in under them, and the stage stops taking clicks until the batch lands.
const flippingUids = ref<Set<number>>(new Set());
// One expand/collapse is one batch. A newer batch cancels every animation the last one
// still had running, so a fast double-click never leaves a cell stranded mid-transform.
let running: Animation[] = [];

const cellEl = (uid: number) => stage.value?.querySelector<HTMLElement>(`[data-uid="${uid}"]`) ?? null;

// Measure every currently-rendered cell's slot, dropping any the layout has parked
// off-screen. Taken once before the patch and once after; flipPairs keeps only the cells
// on-screen in BOTH, so a cell hidden in one layout (cockpit list mode parks the grid at
// left:-99999px) fades rather than flying across the viewport. Each survivor flies from
// its own old slot.
function measureCells(uids: number[]): Map<number, DOMRect> {
  const rects = new Map<number, DOMRect>();
  for (const uid of uids) {
    const el = cellEl(uid);
    if (!el) continue;
    const rect = el.getBoundingClientRect();
    if (onScreen(rect, window.innerWidth, window.innerHeight)) rects.set(uid, rect);
  }
  return rects;
}

function flipCells(before: Map<number, DOMRect>) {
  // Cancel the previous batch FIRST: a transform still on a cell would move its box, so
  // the `after` measurement below has to read resting layout, not a mid-flight rect.
  running.forEach((a) => a.cancel());
  running = [];
  flippingUids.value = new Set();

  const after = measureCells([...before.keys()]);
  const animations = flipPairs(before, after)
    .map(({ uid, first, last }) => {
      const el = cellEl(uid);
      const frames = el && flipKeyframes(first, last);
      return el && frames ? { uid, anim: el.animate(frames, { duration: FLIP_MS, easing: FLIP_EASING }) } : null;
    })
    .filter((x): x is { uid: number; anim: Animation } => x !== null);
  if (!animations.length) return;

  const batch = animations.map((a) => a.anim);
  running = batch;
  flippingUids.value = new Set(animations.map((a) => a.uid));
  const settle = () => {
    if (running !== batch) return; // a newer batch took over — it owns the class now
    running = [];
    flippingUids.value = new Set();
  };
  // The batch shares one duration + easing, so the last to finish settles them all.
  Promise.allSettled(batch.map((a) => a.finished)).then(settle);
}

// Pre-flush, so the cells are still in the slots they are leaving when we measure them.
// EVERY rendered cell is measured, not just the one being zoomed, so the filmstrip cells
// slide into place alongside it instead of snapping.
watch(
  () => props.expandedUid,
  (to, from) => {
    if (!shouldFlipZoom(to, from, window.matchMedia("(prefers-reduced-motion: reduce)").matches)) return;
    const before = measureCells(props.cells.map((c) => c.uid));
    nextTick(() => flipCells(before));
  },
);

// Keep the roster scrolled to whichever terminal is enlarged. Without this, moving the zoom
// from the keyboard highlights a row that is off-screen in a list of every session, so the
// one list meant to say "here is where you are" says nothing.
const rosterRoot = useTemplateRef<HTMLElement>("roster");
watch(
  () => props.expandedUid,
  (uid) => {
    if (uid === null) return;
    nextTick(() => {
      const row = rosterRoot.value?.querySelector(`[data-uid="${uid}"]`);
      // `nearest` so a row already in view is left alone — re-centring on every step would
      // make the list jump under a user who can already see what they picked.
      row?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    });
  },
);
</script>

<template>
  <div ref="stage" class="stage" :class="{ zoomed, listmode: listMode, flipping: flippingUids.size > 0 }" :style="flipVars" @focusin="onFocusIn">
    <!-- Cockpit roster: a tall text row per cell (status / dir / summary / prompt / latest
         reply). Click a row to swap which terminal is enlarged. -->
    <aside
      v-if="zoomed && listMode"
      ref="roster"
      data-testid="cockpit"
      class="flex min-w-0 shrink-0 grow-0 basis-[360px] flex-col gap-[5px] overflow-y-auto bg-deep p-1.5"
    >
      <div
        v-for="row in listRows"
        :key="row.uid"
        :data-uid="row.uid"
        role="button"
        :tabindex="0"
        data-testid="cockpit-row"
        class="flex shrink-0 cursor-pointer flex-col gap-1 overflow-hidden rounded-lg border border-l-[3px] bg-panel px-2.5 py-2 text-left text-fg hover:brightness-[1.15] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#4a9eff]"
        :class="row.uid === expandedUid ? 'border-[#4a9eff] border-l-[#4a9eff]' : 'border-border border-l-transparent'"
        @click="row.uid !== expandedUid && emit('toggle-expand', row.uid)"
        @keydown.enter.self.prevent="row.uid !== expandedUid && emit('toggle-expand', row.uid)"
        @keydown.space.self.prevent="row.uid !== expandedUid && emit('toggle-expand', row.uid)"
      >
        <!-- The status + directory line is the row's header: a bar tinted with the directory's
             configured header colour, pulled to the row's top and side edges. Shared with the
             strip thumbnails (CockpitHeader) so both read as the same directory. -->
        <CockpitHeader
          class="-mx-2.5 -mt-2"
          :status="row.status"
          :agent="row.agent"
          :cwd="row.cwd"
          :home="home"
          :header-color="row.headerColor"
          :header-text-color="row.headerTextColor"
          :work-phase="row.workPhase"
          :phase="row.phase"
        >
          <CockpitRowMenu
            v-if="reorderable"
            :can-up="canMoveCell(cells, row.uid, -1)"
            :can-down="canMoveCell(cells, row.uid, 1)"
            @move="(dir) => emit('move', row.uid, dir)"
          />
        </CockpitHeader>
        <!-- The clamp is a runtime value, so the utility reads a CSS variable each line sets for
             itself — `line-clamp-N` only exists for the literals Tailwind found in the source.
             `title` carries the rest, so a low clamp hides nothing you can't get at. -->
        <span
          v-if="row.summary"
          data-testid="cockpit-line"
          class="line-clamp-[var(--cockpit-lines)] overflow-hidden text-[12px] leading-[1.35]"
          :style="{ '--cockpit-lines': cockpitLines.summary }"
          :title="row.summary"
          ><b class="mr-1 text-[10px] font-bold text-[#7a8aa0]">summary</b> {{ row.summary }}</span
        >
        <span
          data-testid="cockpit-line"
          class="line-clamp-[var(--cockpit-lines)] overflow-hidden text-[12px] leading-[1.35]"
          :style="{ '--cockpit-lines': cockpitLines.prompt }"
          :title="row.prompt || row.fallback || undefined"
          ><b class="mr-1 text-[10px] font-bold text-[#7a8aa0]">prompt</b> {{ row.prompt || row.fallback || "—" }}</span
        >
        <span
          v-if="row.response"
          data-testid="cockpit-line"
          class="line-clamp-[var(--cockpit-lines)] overflow-hidden text-[12px] leading-[1.35] text-dim"
          :style="{ '--cockpit-lines': cockpitLines.response }"
          :title="row.response"
          ><b class="mr-1 text-[10px] font-bold text-[#7a8aa0]">reply</b> {{ row.response }}</span
        >
      </div>
    </aside>
    <!-- The enlarged cell and its file pane, side by side. A row wrapper rather than two more
         siblings of the stage: the stage is a ROW in list mode (roster | terminal) and a COLUMN
         in strip mode (terminal / filmstrip), so only nesting puts the pane beside the terminal
         in both. Hidden outright when nothing is zoomed, like .zoom-main itself. -->
    <div ref="zoomRow" :class="zoomed ? 'flex min-h-0 min-w-0 flex-auto' : 'hidden'">
      <div ref="zoomMain" class="zoom-main" />
      <template v-if="filesOpen">
        <div
          class="w-[5px] flex-none cursor-col-resize bg-border hover:bg-accent focus-visible:bg-accent"
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize file pane"
          :aria-valuenow="paneWidth"
          :aria-valuemin="paneMin"
          :aria-valuemax="paneMax"
          title="Drag (or use arrow keys) to resize the file pane"
          tabindex="0"
          @pointerdown.prevent="onSplitterDown"
          @keydown="onSplitterKey"
        />
        <FilesPane
          ref="filesPane"
          :cwd="paneCwd"
          :initial-state="paneState"
          :style="{ flex: `0 0 ${paneWidth}px` }"
          class="border-l border-border bg-deep"
          @close="setFilesOpen(false)"
        >
          <!-- Which directory the tree is actually rooted at. It normally follows the enlarged
               cell, but declining a re-root leaves it behind — and then this is the only thing
               that says so. -->
          <template #title>
            <span class="truncate font-mono text-[11px] text-muted" :title="paneCwd ?? ''">{{ formatCwd(paneCwd, home) }}</span>
          </template>
        </FilesPane>
      </template>
    </div>
    <div class="grid" :style="gridStyle">
      <Teleport v-for="cell in cells" :key="cell.uid" :to="zoomMain" :disabled="!(zoomed && cell.uid === expandedUid)">
        <CommandCell
          v-if="cell.command"
          :data-uid="cell.uid"
          :class="cellClass(cell.uid)"
          :expanded="cell.uid === expandedUid"
          :files-open="filesOpen"
          :zoomed="zoomed"
          :command="cell.command"
          :home="home"
          :reorderable="reorderable"
          @toggle-expand="emit('toggle-expand', cell.uid)"
          @toggle-files="toggleFiles"
          @close="emit('close', cell.uid)"
          @move="(dir) => emit('move', cell.uid, dir)"
          @status="(s) => emit('status', cell.uid, s)"
        />
        <LauncherCell
          v-else-if="cell.launcher"
          :uid="cell.uid"
          :data-uid="cell.uid"
          :class="cellClass(cell.uid)"
          :expanded="cell.uid === expandedUid"
          :files-open="filesOpen"
          :zoomed="zoomed"
          :launcher="cell.launcher"
          :session="cell.session"
          :cwd="cell.cwd"
          :home="home"
          :reorderable="reorderable"
          @toggle-expand="emit('toggle-expand', cell.uid)"
          @toggle-files="toggleFiles"
          @close="emit('close', cell.uid)"
          @move="(dir) => emit('move', cell.uid, dir)"
          @status="(s) => emit('status', cell.uid, s)"
          @session="(id) => emit('session', cell.uid, id)"
        />
        <TerminalCell
          v-else
          :uid="cell.uid"
          :data-uid="cell.uid"
          :class="cellClass(cell.uid)"
          :expanded="cell.uid === expandedUid"
          :files-open="filesOpen"
          :zoomed="zoomed"
          :initial-session-id="cell.session"
          :initial-cwd="cell.cwd"
          :initial-agent="cell.agent"
          :default-cwd="defaultCwd"
          :presets="presets"
          :launchers="launchers"
          :home="home"
          :open-session-ids="openSessionIds"
          :open-cwds="openCwds"
          :cancellable="cell.uid === cancelUid"
          :reorderable="reorderable"
          @toggle-expand="emit('toggle-expand', cell.uid)"
          @toggle-files="toggleFiles"
          @session="(id) => emit('session', cell.uid, id)"
          @agent="(a) => emit('agent', cell.uid, a)"
          @cwd="(c) => emit('cwd', cell.uid, c)"
          @record-cwd="(c) => emit('record-cwd', c)"
          @remove-preset="(path) => emit('remove-preset', path)"
          @run="(cmd) => emit('run', cell.uid, cmd)"
          @run-spare="(cmd) => emit('runSpare', cell.uid, cmd)"
          @launch="(pick) => emit('launch', cell.uid, pick)"
          @close="emit('close', cell.uid)"
          @move="(dir) => emit('move', cell.uid, dir)"
          @status="(s) => emit('status', cell.uid, s)"
        />
      </Teleport>
    </div>
  </div>
</template>

<style scoped>
.stage {
  height: 100%;
  width: 100%;
  display: flex;
  flex-direction: column;
  min-height: 0;
  min-width: 0;
  background: var(--bg-deep);
}

.grid {
  flex: 1;
  min-height: 0;
  display: grid;
  padding: 6px;
  box-sizing: border-box;
}

/* The focused cell grows via `transform: scale` (see `.focused`). That growth is a fraction
   of the cell's size, which for a wide/tall edge cell can push its edge past the viewport's
   `overflow:hidden` and clip the outermost characters. Inset the tiled grid by an amount that
   tracks the cell size on each axis — % of width horizontally, vh vertically — so the reserved
   room matches the scale at any window size and the zoom always stays on screen. (Scoped to the
   non-zoomed grid so the zoomed filmstrip keeps its own padding.) */
.stage:not(.zoomed) .grid {
  padding: calc(6px + 1.5vh) calc(6px + 1.6%);
}

/* Inert until a cell is zoomed. */
.zoom-main {
  display: none;
}

.zoom-main > * {
  flex: 1;
  min-width: 0;
  min-height: 0;
}

.stage.zoomed .zoom-main {
  display: flex;
  flex: 1;
  min-height: 0;
  min-width: 0;
}

/* List mode: text roster on the left, the expanded terminal on the right. */
.stage.zoomed.listmode {
  flex-direction: row;
}

.stage.zoomed.listmode .zoom-main {
  padding: 6px 6px 6px 0;
}

/* Keep the non-expanded cells mounted (connections + metadata stay live) but OFF the visible
   layout. A real off-screen box means xterm never fits to zero. */
.stage.zoomed.listmode .grid {
  position: absolute;
  left: -99999px;
  top: 0;
  width: 900px;
  height: 600px;
  display: block;
  overflow: hidden;
  padding: 0;
}

.stage.zoomed.listmode .grid > * {
  width: 900px;
  height: 600px;
}

/* Strip mode (toggle): the original filmstrip — expanded terminal on top, thumbnails below. */
.stage.zoomed:not(.listmode) {
  flex-direction: column;
}

.stage.zoomed:not(.listmode) .zoom-main {
  padding: 6px 6px 0;
}

.stage.zoomed:not(.listmode) .grid {
  flex: 0 0 150px;
  display: flex;
  gap: 6px;
  overflow-x: auto;
  overflow-y: hidden;
}

.stage.zoomed:not(.listmode) .grid > * {
  flex: 0 0 260px;
  height: 100%;
  min-width: 0;
}

/* The keyboard-focused cell lifts and grows slightly, in place — tiled grid only, so it never
   applies to a filmstrip thumbnail (.stage.zoomed) or a cell mid-FLIP. The transform doesn't change
   the cell's layout size, so xterm isn't refit and the PTY isn't resized. */
.stage:not(.zoomed) .grid > *:not(.flipping) {
  transition:
    transform 140ms ease,
    box-shadow 140ms ease;
}

.stage:not(.zoomed) .grid > .focused {
  transform: scale(1.03);
  z-index: 5;
  box-shadow: 0 8px 30px rgba(0, 0, 0, 0.5);
}

@media (prefers-reduced-motion: reduce) {
  .stage:not(.zoomed) .grid > *:not(.flipping) {
    transition: none;
  }
}

/* A second click landing mid-flight would measure a transformed cell and flip from the
   wrong rect, so the stage stays inert until the cell lands. */
.stage.flipping {
  pointer-events: none;
}

/* Restoring shrinks the cell from the overlay's rect back into its grid slot, so it
   starts out overflowing its siblings — it has to paint above them the whole way. */
.stage.flipping .flipping {
  z-index: 1;
}

/* Cells present in both layouts fly (they carry `.flipping`); the ones left here are the
   other tabs' cells, which appear in (or vanish from) the filmstrip with no counterpart to
   fly from, so they cross-fade instead. */
.stage.flipping .grid > *:not(.flipping) {
  animation: cell-in var(--flip-ms) var(--flip-ease);
}

.stage.flipping.zoomed .grid > *:not(.flipping) {
  animation-name: strip-in;
}

@keyframes cell-in {
  from {
    opacity: 0;
  }
}

@keyframes strip-in {
  from {
    opacity: 0;
    transform: translateY(8px);
  }
}
</style>
