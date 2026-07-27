<script setup lang="ts">
// The file explorer + editor itself, independent of where it is shown: the full-screen
// Files view (FilesOverlay) and the pane beside a zoomed grid cell mount the same thing.
// Left: a lazy-loaded directory tree rooted at `cwd`. Right: a CodeMirror editor, with a
// Markdown preview toggle that reuses the server's sandboxed md→HTML iframe. Writes go
// through PUT .../write, whose `path` the server contains within the project root.
//
// It owns no notion of routes or of being open — the host decides when it exists, and
// calls `reload()` after a root change it has already cleared with the user.
import { onBeforeUnmount, onMounted, ref, computed, nextTick, watch } from "vue";
import { createEditor, langKindForFilename, type CmEditor } from "./cmEditor";

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

const props = defineProps<{ cwd: string | null; requestedPath?: string | null }>();
const emit = defineEmits<{ close: []; dirty: [boolean] }>();

const roots = ref<Node[]>([]);
const treeError = ref<string | null>(null);
const openPath = ref<string | null>(null);
const openName = computed(() => (openPath.value ? (openPath.value.split("/").pop() ?? "") : ""));
const dirty = ref(false);
const saving = ref(false);
const fileError = ref<string | null>(null);
// The version the open buffer was loaded from; sent back on save so the server can refuse a
// write that would clobber someone else's (null = the file didn't exist).
const baseVersion = ref<string | null>(null);
// Set when a save came back 409, holding the version now on disk — what "Overwrite" re-sends.
const conflict = ref<{ version: string | null } | null>(null);
const showPreview = ref(false);
const isMarkdown = computed(() => langKindForFilename(openName.value) === "markdown");

const editorHost = ref<HTMLDivElement>();
let editor: CmEditor | null = null;
let reqId = 0;

// The host guards its own navigation on this, so it has to hear every change.
watch(dirty, (value) => emit("dirty", value));

function qs(pathRel: string): string {
  const p = new URLSearchParams();
  if (props.cwd) p.set("cwd", props.cwd);
  p.set("path", pathRel);
  return p.toString();
}
const previewSrc = computed(() => (openPath.value ? `/api/files/browse/md?${qs(openPath.value)}` : ""));

function makeNode(e: Entry, parentPath: string): Node {
  return { name: e.name, path: parentPath ? `${parentPath}/${e.name}` : e.name, dir: e.dir, size: e.size, expanded: false, loaded: false, children: [] };
}

async function fetchEntries(pathRel: string): Promise<Entry[]> {
  const res = await fetch(`/api/files/browse/list?${qs(pathRel)}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  return Array.isArray(data.entries) ? data.entries : [];
}

async function loadRoot(): Promise<void> {
  const id = ++reqId;
  treeError.value = null;
  try {
    const entries = await fetchEntries("");
    if (id === reqId) roots.value = entries.map((e) => makeNode(e, ""));
  } catch (e) {
    if (id === reqId) treeError.value = e instanceof Error ? e.message : String(e);
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

type WriteOutcome = { status: "saved"; version: string | null } | { status: "conflict"; version: string | null } | { status: "error"; message: string };

// One write, reported as a value rather than through component state. Leaving has to keep
// working while the pane is being torn down, and anything read from `editor` or a ref AFTER
// an await may already be gone by then.
async function writeBuffer(pathRel: string, text: string, base: string | null, keepalive = false): Promise<WriteOutcome> {
  try {
    const res = await fetch(`/api/files/browse/write?${qs(pathRel)}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text, baseVersion: base }),
      keepalive,
    });
    const data = await res.json().catch(() => ({}));
    const version = typeof data.version === "string" ? data.version : null;
    if (res.status === 409) return { status: "conflict", version };
    if (!res.ok) return { status: "error", message: data.error || `HTTP ${res.status}` };
    return { status: "saved", version };
  } catch (e) {
    return { status: "error", message: e instanceof Error ? e.message : String(e) };
  }
}

/** Hand a copy to the backup store — content that exists nowhere else once the editor is gone. */
async function bankText(pathRel: string, text: string, keepalive = false): Promise<boolean> {
  try {
    const res = await fetch(`/api/files/browse/backup?${qs(pathRel)}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text }),
      keepalive,
    });
    return res.ok;
  } catch {
    return false;
  }
}

// Save on the way out instead of asking. The editor sits beside a terminal the user is
// working in, so anything that moves the enlargement — a key, a click on the filmstrip —
// would otherwise raise a dialog mid-flow. Nothing is lost either way: the server banks
// three generations of every file it replaces.
//
// A save that loses the version race can't put a banner up (we are already leaving), so the
// buffer is banked instead and the file left as the other writer left it. Everything needed
// is read BEFORE the first await, so an unmount mid-flight can't take the content with it.
async function flush(): Promise<void> {
  if (!dirty.value || !openPath.value || !editor) return;
  const pathRel = openPath.value;
  const text = editor.getDoc();
  const outcome = await writeBuffer(pathRel, text, baseVersion.value);
  // Stop calling it unsaved only once the copy is SOMEWHERE. A failed backup leaves the buffer
  // marked dirty, which is the one honest answer left.
  if (outcome.status === "saved" || (await bankText(pathRel, text))) {
    dirty.value = false;
    conflict.value = null;
  }
}

async function openFile(node: Node): Promise<void> {
  if (node.dir) return toggleDir(node);
  await loadFile(node.path);
}

// Open a project-relative path in the editor. Split out from openFile because the other way
// in has no tree node to hand over: a clicked source path in terminal output arrives as
// ?path= and opens the same file (#808).
// `force` re-reads the file already open and skips the unsaved-edits prompt — the
// conflict banner's "Reload", where discarding is the button the user just pressed.
async function loadFile(pathRel: string, force = false): Promise<void> {
  if (!force) {
    if (pathRel === openPath.value) return; // already open — no reload
    await flush(); // opening another file is leaving this one
  }
  const id = ++reqId;
  fileError.value = null;
  conflict.value = null;
  showPreview.value = false;
  try {
    const res = await fetch(`/api/files/browse/text?${qs(pathRel)}`);
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `HTTP ${res.status}`);
    const data = await res.json();
    if (id !== reqId) return;
    openPath.value = pathRel;
    baseVersion.value = typeof data.version === "string" ? data.version : null;
    editor?.setDoc(typeof data.text === "string" ? data.text : "", pathRel.split("/").pop() ?? pathRel);
    dirty.value = false;
  } catch (e) {
    if (id === reqId) fileError.value = e instanceof Error ? e.message : String(e);
  }
}

async function save(): Promise<void> {
  if (!openPath.value || !editor || saving.value) return;
  saving.value = true;
  fileError.value = null;
  const outcome = await writeBuffer(openPath.value, editor.getDoc(), baseVersion.value);
  saving.value = false;
  // 409: the file moved on under us (the agent working in this very directory is the likeliest
  // author). Nothing was written — offer the choice instead of picking a loser.
  if (outcome.status === "conflict") {
    conflict.value = { version: outcome.version };
    return;
  }
  if (outcome.status === "error") {
    fileError.value = outcome.message;
    return;
  }
  baseVersion.value = outcome.version;
  dirty.value = false;
  conflict.value = null;
}

/** Conflict banner — take the disk's copy. The buffer is banked first, so "discard" costs
 *  nothing that can't be fetched back out of the backup store. */
async function discardAndReload(): Promise<void> {
  if (!openPath.value || !editor) return;
  await bankText(openPath.value, editor.getDoc());
  loadFile(openPath.value, true);
}

/** Conflict banner — keep the buffer, adopting the disk's version as the new baseline so the
 *  retry is a deliberate overwrite rather than another conflict. */
function overwrite(): void {
  if (!conflict.value) return;
  baseVersion.value = conflict.value.version;
  conflict.value = null;
  save();
}

async function requestClose(): Promise<void> {
  await flush();
  emit("close");
}

// Bound to this pane's own subtree, not to window: with a pane open beside a terminal,
// a window-level ⌘S would save while the user is typing into the terminal.
function onKeydown(e: KeyboardEvent): void {
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
    e.preventDefault();
    save();
  }
}

function teardown(): void {
  editor?.destroy();
  editor = null;
  roots.value = [];
  openPath.value = null;
  dirty.value = false;
  baseVersion.value = null;
  conflict.value = null;
  showPreview.value = false;
}

async function start(): Promise<void> {
  await nextTick();
  if (editorHost.value) editor = createEditor(editorHost.value, () => (dirty.value = true));
  loadRoot();
  if (props.requestedPath) loadFile(props.requestedPath);
}

// A second clicked path while the pane is already showing: nothing else changes, so
// without this the file would never open.
watch(
  () => props.requestedPath,
  (pathRel) => {
    if (pathRel) loadFile(pathRel);
  },
);

// Closing the tab or reloading is also leaving the file. `keepalive` lets the request outlive
// the page — capped at 64 KB by the browser, so a very large buffer may not make it out, which
// is the one hole autosave can't close.
function onPageHide(): void {
  if (!dirty.value || !openPath.value || !editor) return;
  const pathRel = openPath.value;
  const text = editor.getDoc();
  // Both, unconditionally: there is no awaiting an answer here, so the only way to honour
  // "your version is kept either way" is to bank it whether or not the write wins the race.
  // The cost is one redundant generation per tab-close with unsaved edits.
  bankText(pathRel, text, true);
  writeBuffer(pathRel, text, baseVersion.value, true);
}

onMounted(() => {
  window.addEventListener("pagehide", onPageHide);
  start();
});
onBeforeUnmount(() => {
  window.removeEventListener("pagehide", onPageHide);
  teardown();
});

// `reload` is the host's way to say "the root changed and I have already cleared it with the
// user" — the pane never watches `cwd` itself, because reacting to it would discard a buffer
// the host may still be asking about.
defineExpose({
  reload: async () => {
    teardown();
    await start();
  },
  flush,
});
</script>

<template>
  <div class="flex min-h-0 min-w-0 flex-auto flex-col" @keydown="onKeydown">
    <header class="flex flex-none items-center gap-2.5 border-b border-border bg-panel px-4 py-2">
      <slot name="title" />
      <span class="flex-auto" />
      <span v-if="openPath" class="min-w-0 truncate font-mono text-[12px]" :class="dirty ? 'text-fg' : 'text-secondary'"
        >{{ openName }}<span v-if="dirty" class="ml-1 text-amber" title="Unsaved">●</span></span
      >
      <button
        v-if="openPath && isMarkdown"
        type="button"
        class="h-[26px] cursor-pointer rounded-md border border-border bg-base px-2.5 py-1 text-[12px] text-secondary enabled:hover:bg-hover enabled:hover:text-fg disabled:cursor-default disabled:opacity-50"
        @click="showPreview = !showPreview"
      >
        {{ showPreview ? "Edit" : "Preview" }}
      </button>
      <button
        v-if="openPath"
        type="button"
        class="h-[26px] cursor-pointer rounded-md border border-accent bg-accent-bg px-2.5 py-1 text-[12px] text-on-accent enabled:hover:bg-hover enabled:hover:text-fg disabled:cursor-default disabled:opacity-50"
        :disabled="!dirty || saving"
        @click="save"
      >
        {{ saving ? "Saving…" : "Save" }}
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
        <div
          v-if="conflict"
          role="alert"
          data-testid="files-conflict"
          class="absolute inset-x-0 top-0 z-10 flex flex-wrap items-center gap-2 border-b border-amber bg-[var(--warn-bg-subtle)] px-4 py-2 text-[13px] text-warn"
        >
          <span class="material-symbols-outlined" aria-hidden="true">warning</span>
          <span class="flex-auto">This file changed on disk. Nothing was saved — your version is kept as a backup either way.</span>
          <button
            type="button"
            class="h-[26px] cursor-pointer rounded-md border border-border bg-base px-2.5 py-1 text-[12px] text-secondary hover:bg-hover hover:text-fg"
            @click="discardAndReload"
          >
            Reload (discard your edits)
          </button>
          <button
            type="button"
            class="h-[26px] cursor-pointer rounded-md border border-border bg-base px-2.5 py-1 text-[12px] text-secondary hover:bg-hover hover:text-fg"
            @click="overwrite"
          >
            Overwrite anyway
          </button>
        </div>
        <p v-if="fileError" class="p-4 text-[13px] text-err">{{ fileError }}</p>
        <p v-if="!openPath" class="m-auto p-4 text-[13px] text-muted">Select a file to view or edit.</p>
        <iframe v-show="openPath && showPreview" class="flex-auto border-0 bg-white" :src="previewSrc" sandbox="" title="Markdown preview" />
        <div v-show="openPath && !showPreview" ref="editorHost" class="files-editor min-w-0 flex-auto overflow-hidden" />
      </section>
    </div>
  </div>
</template>
