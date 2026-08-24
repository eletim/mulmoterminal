<script setup lang="ts">
// The file explorer + read-only viewer itself, independent of where it is shown: the full-screen
// Files view (FilesOverlay) and the pane beside a zoomed grid cell mount the same thing.
// Left: a lazy-loaded directory tree rooted at `cwd`. Right: a read-only CodeMirror
// viewer, with a Markdown preview toggle that reuses the server's sandboxed md→HTML iframe.
//
// It owns no notion of routes or of being open — the host decides when it exists, and
// calls `reload()` after a root change it has already cleared with the user.
import { onBeforeUnmount, onMounted, ref, computed, nextTick, watch } from "vue";
import { createEditor, langKindForFilename, type CmEditor } from "./cmEditor";
import { expandedPaths, restoreOrder } from "./filesTreeState";
import { isWriteToOpenFile } from "../composables/fileWriteMatch";
import { usePubSub } from "../composables/usePubSub";
import { FILE_WRITE_CHANNEL, isFileWriteEvent } from "../../common/fileWriteChannel";
import { isRecord } from "../../common/isRecord";
import { isUnknownArray } from "../../common/isUnknownArray";
import { jsonBody } from "../jsonBody";
import { withAppBasePath } from "../basePath";

interface Node {
  name: string;
  path: string; // relative to the project root
  dir: boolean;
  size: number;
  expanded: boolean;
  loaded: boolean;
  children: Node[];
}
interface Entry {
  name: string;
  dir: boolean;
  size: number;
}

// The listing arrives off the wire, so an entry is checked before it becomes one — the tree
// renders `name` and branches on `dir`, and a malformed entry would render as blank rather than
// as absent.
const isEntry = (value: unknown): value is Entry =>
  isRecord(value) && typeof value.name === "string" && typeof value.dir === "boolean" && typeof value.size === "number";

/** What a host hands back so a revisited directory looks the way it was left. */
export interface FilesPaneState {
  openPath: string | null;
  expanded: string[];
}

const props = defineProps<{ cwd: string | null; requestedPath?: string | null; initialState?: FilesPaneState | null }>();
const emit = defineEmits<{ close: [] }>();

const roots = ref<Node[]>([]);
const treeError = ref<string | null>(null);
const openPath = ref<string | null>(null);
const openName = computed(() => (openPath.value ? (openPath.value.split("/").pop() ?? "") : ""));
const fileError = ref<string | null>(null);
const baseVersion = ref<string | null>(null);
const showPreview = ref(false);
const isMarkdown = computed(() => langKindForFilename(openName.value) === "markdown");

const editorHost = ref<HTMLDivElement>();
let editor: CmEditor | null = null;
// The tree and the open file are fetched independently, so they get a counter EACH. One
// shared counter reads as "latest request wins" and is wrong the moment the two overlap:
// opening a file while the tree is still loading bumped the shared id, the tree's own
// `id === reqId` check then failed, and its result was thrown away — leaving a pane that says
// "Empty directory." next to the file it just opened. Nothing overlapped them until a click in
// terminal output could open a file at the same moment the pane mounts (#910).
let treeReqId = 0;
let fileReqId = 0;

function qs(pathRel: string): string {
  const p = new URLSearchParams();
  if (props.cwd) p.set("cwd", props.cwd);
  p.set("path", pathRel);
  return p.toString();
}
const previewSrc = computed(() => (openPath.value ? `${withAppBasePath("/api/files/browse/md")}?${qs(openPath.value)}` : ""));

function makeNode(e: Entry, parentPath: string): Node {
  return { name: e.name, path: parentPath ? `${parentPath}/${e.name}` : e.name, dir: e.dir, size: e.size, expanded: false, loaded: false, children: [] };
}

async function fetchEntries(pathRel: string): Promise<Entry[]> {
  const res = await fetch(`/api/files/browse/list?${qs(pathRel)}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await jsonBody(res);
  // A directory with no children answers `{ entries: [] }`, so an ABSENT array is a body we could
  // not read — different from an empty directory, and the callers treat the two differently (one
  // marks the node loaded, the other collapses it again).
  if (!isUnknownArray(data.entries)) throw new Error("GET /api/files/browse/list → body has no entries array");
  return data.entries.filter(isEntry);
}

async function loadRoot(): Promise<void> {
  const id = ++treeReqId;
  treeError.value = null;
  try {
    const entries = await fetchEntries("");
    if (id === treeReqId) roots.value = entries.map((e) => makeNode(e, ""));
  } catch (e) {
    if (id === treeReqId) treeError.value = e instanceof Error ? e.message : String(e);
  }
}

async function toggleDir(node: Node): Promise<void> {
  node.expanded = !node.expanded;
  if (node.expanded && !node.loaded) {
    try {
      node.children = (await fetchEntries(node.path)).map((e) => makeNode(e, node.path));
      node.loaded = true;
    } catch {
      node.expanded = false; // couldn't read — collapse again
    }
  }
}

// Depth-first flatten of the currently-visible rows (only descending into expanded
// dirs), so the template renders a flat list without a recursive component.
const rows = computed(() => {
  const out: { node: Node; depth: number }[] = [];
  const walk = (nodes: Node[], depth: number) => {
    for (const node of nodes) {
      out.push({ node, depth });
      if (node.dir && node.expanded) walk(node.children, depth + 1);
    }
  };
  walk(roots.value, 0);
  return out;
});

async function flush(): Promise<boolean> {
  return true;
}

async function openFile(node: Node): Promise<void> {
  if (node.dir) return toggleDir(node);
  await loadFile(node.path);
}

// Open a project-relative path in the editor. Split out from openFile because the other way
// in has no tree node to hand over: a clicked source path in terminal output arrives as
// Every /api route answers a failure as `res.status(4xx).json({ error })`, so the reason a read
// was refused is in the body — reporting only the status turns a fixable problem into a mystery.
const failureReason = (body: Record<string, unknown>, status: number): string =>
  typeof body.error === "string" && body.error !== "" ? body.error : `HTTP ${status}`;

// ?path= and opens the same file (#808).
// `force` re-reads the file already open and skips the unsaved-edits prompt — the
// conflict banner's "Reload", where discarding is the button the user just pressed.
async function loadFile(pathRel: string, force = false): Promise<void> {
  if (!force && pathRel === openPath.value) return; // already open — no reload
  const id = ++fileReqId;
  fileError.value = null;
  showPreview.value = false;
  try {
    const res = await fetch(`/api/files/browse/text?${qs(pathRel)}`);
    const data = await jsonBody(res);
    if (!res.ok) throw new Error(failureReason(data, res.status));
    if (id !== fileReqId) return;
    openPath.value = pathRel;
    baseVersion.value = typeof data.version === "string" ? data.version : null;
    editor?.setDoc(typeof data.text === "string" ? data.text : "", pathRel.split("/").pop() ?? pathRel);
  } catch (e) {
    if (id === fileReqId) fileError.value = e instanceof Error ? e.message : String(e);
  }
}

async function requestClose(): Promise<void> {
  emit("close");
}

// The file may move under the editor at any moment — the agent working in this directory is
// editing the same files. Two ways of finding out, because neither alone is enough: the write
// hook is immediate but only speaks for Claude (Codex reports through a different channel, and
// git, a build or another editor report through none), while the poll misses nothing and is
// merely late. The 409 on save is still the hard guarantee; these two only get the news out
// before the user has typed into a file that already moved.
const EXTERNAL_CHECK_MS = 30_000;
let externalTimer: ReturnType<typeof setInterval> | null = null;

/** Re-read the version and refresh the content: the pane is a live read-only view. */
async function checkForExternalChange(): Promise<void> {
  if (!openPath.value) return;
  const pathRel = openPath.value;
  try {
    const res = await fetch(`/api/files/browse/version?${qs(pathRel)}`);
    if (!res.ok) return;
    const data = await jsonBody(res);
    const onDisk = typeof data.version === "string" ? data.version : null;
    // Still the version we loaded, or the answer arrived after the user moved on.
    if (onDisk === baseVersion.value || pathRel !== openPath.value) return;
    void loadFile(pathRel, true);
  } catch {
    // Offline or the server restarted: the next tick asks again, and the save still can't clobber.
  }
}

function watchExternalChanges(): () => void {
  externalTimer = setInterval(checkForExternalChange, EXTERNAL_CHECK_MS);
  const unsubscribe = usePubSub().subscribe(FILE_WRITE_CHANNEL, (data) => {
    if (isFileWriteEvent(data) && isWriteToOpenFile(data.file, props.cwd, openPath.value)) void checkForExternalChange();
  });
  return () => {
    if (externalTimer !== null) clearInterval(externalTimer);
    externalTimer = null;
    unsubscribe();
  };
}

function teardown(): void {
  editor?.destroy();
  editor = null;
  roots.value = [];
  openPath.value = null;
  baseVersion.value = null;
  showPreview.value = false;
}

async function start(): Promise<void> {
  await nextTick();
  if (editorHost.value) editor = createEditor(editorHost.value, () => {}, true);
  await loadRoot();
  await restore(props.initialState ?? null);
  // An explicitly requested path wins over whatever was remembered — it is the more recent
  // intent (a clicked path in terminal output).
  if (props.requestedPath) void loadFile(props.requestedPath);
}

/** Put a remembered tree back: open its directories parents-first (each fetches its children),
 *  then the file that was open. Anything since deleted simply isn't found and is skipped. */
async function restore(state: FilesPaneState | null): Promise<void> {
  if (!state) return;
  for (const dirPath of restoreOrder(state.expanded)) {
    const node = findNode(roots.value, dirPath);
    if (node?.dir && !node.expanded) await toggleDir(node);
  }
  if (state.openPath) await loadFile(state.openPath);
}

function findNode(nodes: Node[], target: string): Node | null {
  for (const node of nodes) {
    if (node.path === target) return node;
    const hit = findNode(node.children, target);
    if (hit) return hit;
  }
  return null;
}

// A second clicked path while the pane is already showing: nothing else changes, so
// without this the file would never open.
watch(
  () => props.requestedPath,
  (pathRel) => {
    if (pathRel) void loadFile(pathRel);
  },
);

let stopWatchingExternal: (() => void) | null = null;
onMounted(() => {
  stopWatchingExternal = watchExternalChanges();
  void start();
});
onBeforeUnmount(() => {
  stopWatchingExternal?.();
  teardown();
});

// `reload` is the host's way to say "the root changed and I have already cleared it with the
// user" — the pane never watches `cwd` itself, because reacting to it would discard a buffer
// the host may still be asking about.
defineExpose({
  /** What this pane looks like right now, for a host that will bring the user back here. */
  snapshot: (): FilesPaneState => ({ openPath: openPath.value, expanded: expandedPaths(roots.value) }),
  reload: async () => {
    teardown();
    await start();
  },
  /** Open a file the host chose — a path clicked in terminal output (#910). Routed through
   *  loadFile exactly as it would be from the tree. */
  openFile: (pathRel: string) => loadFile(pathRel),
  flush,
});
</script>

<template>
  <div class="flex min-h-0 min-w-0 flex-auto flex-col">
    <header class="flex flex-none items-center gap-2.5 border-b border-border bg-panel px-4 py-2">
      <slot name="title" />
      <span class="flex-auto" />
      <span v-if="openPath" class="min-w-0 truncate font-mono text-[12px] text-secondary">{{ openName }}</span>
      <button
        v-if="openPath && isMarkdown"
        type="button"
        class="h-[26px] cursor-pointer rounded-md border border-border bg-base px-2.5 py-1 text-[12px] text-secondary enabled:hover:bg-hover enabled:hover:text-fg disabled:cursor-default disabled:opacity-50"
        @click="showPreview = !showPreview"
      >
        {{ showPreview ? "Source" : "Preview" }}
      </button>
      <button
        type="button"
        class="h-[26px] cursor-pointer rounded-md border border-border bg-base px-2.5 py-1 text-[12px] text-secondary enabled:hover:bg-hover enabled:hover:text-fg disabled:cursor-default disabled:opacity-50"
        title="Reload tree"
        aria-label="Reload tree"
        @click="loadRoot"
      >
        <span class="material-symbols-outlined" aria-hidden="true">refresh</span>
      </button>
      <button
        type="button"
        class="h-[26px] cursor-pointer rounded-md border border-border bg-base px-2.5 py-1 text-[12px] text-secondary enabled:hover:bg-hover enabled:hover:text-fg disabled:cursor-default disabled:opacity-50"
        title="Close"
        aria-label="Close files"
        @click="requestClose"
      >
        <span class="material-symbols-outlined" aria-hidden="true">close</span>
      </button>
    </header>
    <div class="flex min-h-0 flex-auto">
      <nav class="basis-[clamp(160px,24%,340px)] shrink-0 grow-0 overflow-auto border-r border-border py-1.5" aria-label="File tree">
        <p v-if="treeError" class="p-4 text-[13px] text-err">{{ treeError }}</p>
        <p v-else-if="roots.length === 0" class="p-4 text-[13px] text-muted">Empty directory.</p>
        <button
          v-for="{ node, depth } in rows"
          :key="node.path"
          type="button"
          data-testid="files-row"
          class="flex w-full cursor-pointer items-center gap-1 whitespace-nowrap border-0 bg-transparent px-2 py-[3px] text-left font-mono text-[12px]"
          :class="node.path === openPath ? 'bg-hover text-fg' : 'text-secondary hover:bg-hover hover:text-fg'"
          :style="{ paddingLeft: `${8 + depth * 14}px` }"
          @click="openFile(node)"
        >
          <span class="w-3.5 flex-none text-dim">
            <span v-if="node.dir" class="material-symbols-outlined" aria-hidden="true">{{ node.expanded ? "expand_more" : "chevron_right" }}</span>
          </span>
          <span class="material-symbols-outlined flex-none" aria-hidden="true">{{ node.dir ? "folder" : "description" }}</span>
          <span class="truncate">{{ node.name }}</span>
        </button>
      </nav>
      <section class="relative flex min-w-0 flex-auto">
        <p v-if="fileError" class="p-4 text-[13px] text-err">{{ fileError }}</p>
        <p v-if="!openPath" class="m-auto p-4 text-[13px] text-muted">Select a file to view.</p>
        <iframe v-show="openPath && showPreview" class="flex-auto border-0 bg-white" :src="previewSrc" sandbox="" title="Markdown preview" />
        <div v-show="openPath && !showPreview" ref="editorHost" class="files-editor min-w-0 flex-auto overflow-hidden" />
      </section>
    </div>
  </div>
</template>
