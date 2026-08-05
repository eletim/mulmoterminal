<script setup lang="ts">
// The mobile entry point (/mobile/terminals), mounted by App.vue instead of
// DesktopAppShell — never alongside it. Wired to the two read-only endpoints the local
// mobile terminal API already exposes: which transport mode the server is running
// (GET /api/mobile-mode) and, only in local mode, the terminal session roster
// (GET /api/mobile/terminal-sessions). Screen display, input and launching are a
// follow-up change — this page stops at picking a session in the list.
import { onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import { isMobileMode } from "../../common/mobileMode";
import { isRecord } from "../../common/isRecord";
import { isUnknownArray } from "../../common/isUnknownArray";
import { jsonBody } from "../jsonBody";

const router = useRouter();

function backToDesktop(): void {
  void router.push("/terminals");
}

// The fields this page reads off a GET /api/mobile/terminal-sessions row. The backend's
// TerminalSessionSummary (server/backends/remoteHost/terminalScreen.ts) carries more
// (work, …) — nothing here needs it yet, so it stays off this shape rather than pulled in.
interface MobileSession {
  id: string;
  title: string;
  cwd: string;
  live: boolean;
  agent: string | null;
}

const isMobileSession = (value: unknown): value is MobileSession =>
  isRecord(value) &&
  typeof value.id === "string" &&
  typeof value.title === "string" &&
  typeof value.cwd === "string" &&
  typeof value.live === "boolean" &&
  (value.agent === null || typeof value.agent === "string");

type Status = "loading" | "remote-disabled" | "local" | "error";

const status = ref<Status>("loading");
const sessions = ref<MobileSession[]>([]);
const selectedSessionId = ref<string | null>(null);

// One shot: /api/mobile-mode, then — only when it answers "local" — the session list. Never
// called again except by the Retry button, which re-enters here from the mode check.
async function load(): Promise<void> {
  status.value = "loading";
  try {
    const modeRes = await fetch("/api/mobile-mode");
    if (!modeRes.ok) throw new Error(`HTTP ${modeRes.status}`);
    const modeBody = await jsonBody(modeRes);
    if (!isMobileMode(modeBody.mode)) throw new Error("invalid /api/mobile-mode response");
    if (modeBody.mode === "remote") {
      // Remote mode serves the phone over Firestore (backends/remoteHost) — this same-origin
      // API is only mounted in local mode, so there is nothing to call here and no fallback.
      status.value = "remote-disabled";
      return;
    }

    const sessionsRes = await fetch("/api/mobile/terminal-sessions");
    if (!sessionsRes.ok) throw new Error(`HTTP ${sessionsRes.status}`);
    const sessionsBody = await jsonBody(sessionsRes);
    if (!isUnknownArray(sessionsBody.sessions)) throw new Error("invalid /api/mobile/terminal-sessions response");
    const parsed = sessionsBody.sessions.filter(isMobileSession);

    sessions.value = parsed;
    // The first live session wins; with none live, the first session; with none at all, nothing.
    selectedSessionId.value = parsed.find((session) => session.live)?.id ?? parsed[0]?.id ?? null;
    status.value = "local";
  } catch {
    status.value = "error";
  }
}

// Selection lives in this ref alone — no query param, no localStorage, no store. It is
// forgotten on reload, same as any other unrouted UI state on this page.
function selectSession(id: string): void {
  selectedSessionId.value = id;
}

onMounted(load);
</script>

<template>
  <div class="flex h-full min-h-screen flex-col bg-base text-fg">
    <header class="flex h-10 flex-none items-center justify-between border-b border-border bg-panel px-4">
      <div class="flex min-w-0 items-baseline gap-2">
        <span class="font-sans text-[14px] font-semibold tracking-[0.02em]">MulmoTerminal</span>
        <span class="truncate text-[12px] text-secondary">Local mobile terminal</span>
      </div>
      <button type="button" class="flex-none rounded-md border border-border bg-panel px-2.5 py-1 text-[12px] text-fg hover:bg-hover" @click="backToDesktop">
        Back to desktop
      </button>
    </header>

    <main class="flex-1 overflow-y-auto px-4 py-4">
      <p v-if="status === 'loading'" class="text-[13px] text-secondary">Loading…</p>

      <div v-else-if="status === 'remote-disabled'" class="flex flex-col gap-2 text-[13px]">
        <p class="text-fg">Local mobile terminal is disabled.</p>
        <p class="text-secondary">
          Start the server with <code class="rounded bg-elevated px-1 py-0.5 font-mono text-[12px]">MULMOTERMINAL_MOBILE_MODE=local</code> to use it here.
        </p>
      </div>

      <div v-else-if="status === 'error'" class="flex flex-col gap-2 text-[13px]">
        <p class="text-err-text">Failed to load terminal sessions.</p>
        <button type="button" class="w-fit rounded-md border border-border bg-panel px-2.5 py-1 text-[12px] text-fg hover:bg-hover" @click="load">Retry</button>
      </div>

      <p v-else-if="sessions.length === 0" class="text-[13px] text-secondary">No terminal sessions.</p>

      <ul v-else class="flex flex-col gap-2">
        <li v-for="session in sessions" :key="session.id">
          <button
            type="button"
            class="w-full rounded-md border px-3 py-2 text-left"
            :class="session.id === selectedSessionId ? 'border-accent bg-accent-bg text-on-accent' : 'border-border bg-elevated text-fg hover:bg-hover'"
            @click="selectSession(session.id)"
          >
            <div class="flex items-center justify-between gap-2">
              <span class="truncate text-[13px] font-medium">{{ session.title }}</span>
              <span class="flex-none text-[11px]" :class="session.live ? 'text-ok' : 'text-muted'">{{ session.live ? "live" : "detached" }}</span>
            </div>
            <div class="truncate text-[11px]" :class="session.id === selectedSessionId ? 'text-on-accent' : 'text-secondary'">{{ session.cwd }}</div>
            <div v-if="session.agent" class="text-[11px] text-muted">{{ session.agent }}</div>
          </button>
        </li>
      </ul>
    </main>
  </div>
</template>
