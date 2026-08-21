<script setup lang="ts">
/* eslint-disable max-lines */
// The mobile entry point (/mobile/terminals), mounted by App.vue instead of
// DesktopAppShell — never alongside it. Wired to the local mobile terminal API: the server mode
// check (GET /api/mobile-mode), the terminal session roster (GET /api/mobile/terminal-sessions),
// the selected session's current terminal screen
// (GET /api/mobile/terminal-sessions/:id/screen), creating a new local terminal (POST
// /api/mobile/terminal-sessions), and — for a live session — sending it one line of input
// (POST /api/mobile/terminal-sessions/:id/input).
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from "vue";
import { useRoute } from "vue-router";
import { isMobileMode } from "../../common/mobileMode";
import { SESSION_AGENTS } from "../../common/sessionAgent";
import type { LaunchAgent } from "../../common/launchAgent";
import { isRecord } from "../../common/isRecord";
import { isUnknownArray } from "../../common/isUnknownArray";
import { isAnsiScreen, type AnsiRow, type AnsiSegment } from "../../common/ansiStyle";
import { jsonBody } from "../jsonBody";
import { readRememberedLaunchAgent } from "../composables/rememberedLaunchAgent";
import { useManualCopy } from "../composables/useManualCopy";
import { readSessionIdQuery } from "../mobileWebPushClient";
import { isWorkPhase, mobileActivityStatus, type WorkPhase } from "./mobileActivityStatus";
import { homeRelative } from "./cwdDisplay";
import MobileNewTerminalPanel from "./MobileNewTerminalPanel.vue";
import MobileSessionActions from "./MobileSessionActions.vue";
import MobileWebPushPanel from "./MobileWebPushPanel.vue";

const route = useRoute();
const notificationRequestedSessionId = ref(readSessionIdQuery(route.query.sessionId));
const MOBILE_STATE_CACHE_KEY = "mulmoterminal.mobileTerminalPage.v1";

interface MobileActivity {
  working: boolean;
  waiting: boolean;
  event: string | null;
  workPhase: WorkPhase | null;
}

const isMobileActivity = (value: unknown): value is MobileActivity =>
  isRecord(value) &&
  typeof value.working === "boolean" &&
  typeof value.waiting === "boolean" &&
  (value.event === null || typeof value.event === "string") &&
  (value.workPhase === null || isWorkPhase(value.workPhase));

interface MobileSession {
  id: string;
  title: string;
  cwd: string;
  live: boolean;
  agent: string | null;
  activity: MobileActivity;
}

const isMobileSession = (value: unknown): value is MobileSession =>
  isRecord(value) &&
  typeof value.id === "string" &&
  typeof value.title === "string" &&
  typeof value.cwd === "string" &&
  typeof value.live === "boolean" &&
  (value.agent === null || SESSION_AGENTS.some((known) => known === value.agent)) &&
  isMobileActivity(value.activity);

type Status = "loading" | "local" | "error";

const status = ref<Status>("loading");
const sessions = ref<MobileSession[]>([]);
const mobileHome = ref<string | null>(null);
const selectedSessionId = ref<string | null>(null);
const selectedSession = computed(() => sessions.value.find((candidate) => candidate.id === selectedSessionId.value) ?? null);
const newTerminalCwd = ref("");
const newTerminalAgent = ref<LaunchAgent>(readRememberedLaunchAgent("shell"));
const newTerminalCwdTouched = ref(false);

type CreateStatus = "idle" | "creating" | "error";
const createStatus = ref<CreateStatus>("idle");
const createError = ref("");

interface MobileScreen {
  screen: string;
  styledScreen: AnsiRow[] | undefined;
  lastCommandCopy: { text: string } | undefined;
}

const isMobileScreen = (value: unknown): value is MobileScreen =>
  isRecord(value) &&
  typeof value.screen === "string" &&
  (value.styledScreen === undefined || isAnsiScreen(value.styledScreen)) &&
  (value.lastCommandCopy === undefined || (isRecord(value.lastCommandCopy) && typeof value.lastCommandCopy.text === "string"));

interface CachedMobileState {
  home: string | null;
  sessions: MobileSession[];
  selectedSessionId: string | null;
  screen: { sessionId: string; text: string; styledRows: AnsiRow[] | null } | null;
}

// eslint-disable-next-line sonarjs/cognitive-complexity
const cachedMobileState = (value: unknown): CachedMobileState | null => {
  if (!isRecord(value)) return null;
  if (value.home !== null && typeof value.home !== "string") return null;
  if (!isUnknownArray(value.sessions)) return null;
  const sessions: MobileSession[] = [];
  for (const session of value.sessions) {
    if (!isMobileSession(session)) return null;
    sessions.push(session);
  }
  if (value.selectedSessionId !== null && typeof value.selectedSessionId !== "string") return null;
  let screen: CachedMobileState["screen"] = null;
  if (value.screen !== null) {
    if (!isRecord(value.screen)) return null;
    if (typeof value.screen.sessionId !== "string" || typeof value.screen.text !== "string") return null;
    if (value.screen.styledRows !== null && !isAnsiScreen(value.screen.styledRows)) return null;
    screen = { sessionId: value.screen.sessionId, text: value.screen.text, styledRows: value.screen.styledRows };
  }
  return { home: value.home, sessions, selectedSessionId: value.selectedSessionId, screen };
};

type ScreenStatus = "idle" | "loading" | "loaded" | "error";

const screenStatus = ref<ScreenStatus>("idle");
const screenText = ref("");
const screenStyledRows = ref<AnsiRow[] | null>(null);
const lastCommandCopyText = ref("");
const screenIsLoading = () => screenStatus.value === "loading";
const mainScrollEl = ref<HTMLElement | null>(null);
const MAIN_SCROLL_BOTTOM_TOLERANCE_PX = 24;

function segmentStyle(segment: AnsiSegment): Record<string, string> {
  const style: Record<string, string> = {};
  if (segment.fg) style.color = segment.fg;
  if (segment.bg) style.backgroundColor = segment.bg;
  if (segment.bold) style.fontWeight = "700";
  return style;
}

const BLANK_ROW_FILLER = "\u00A0";

// Rate limit for the screen error Retry button alone — session switches and the header Refresh
// bypass it entirely. Counted from when a retry STARTS, not when its request resolves, so a slow
// or failing request doesn't extend the cooldown.
const MANUAL_REFRESH_COOLDOWN_MS = 5000;
const manualRefreshCoolingDown = ref(false);
let cooldownTimeoutId: ReturnType<typeof setTimeout> | null = null;

const inputText = ref("");
const inputTextareaEl = ref<HTMLTextAreaElement | null>(null);
type InputStatus = "idle" | "sending" | "error";
const inputStatus = ref<InputStatus>("idle");
type CopyStatus = "idle" | "copying" | "copied";
const copyStatus = ref<CopyStatus>("idle");
const { manualCopyText, setManualCopyTextareaEl, showManualCopy, closeManualCopy } = useManualCopy();

const MOBILE_INPUT_MIN_HEIGHT_PX = 42;
const MOBILE_INPUT_MAX_HEIGHT_PX = 128;

function resizeInputTextarea(): void {
  const el = inputTextareaEl.value;
  if (!el) return;
  el.style.height = "auto";
  const nextHeight = Math.min(Math.max(el.scrollHeight, MOBILE_INPUT_MIN_HEIGHT_PX), MOBILE_INPUT_MAX_HEIGHT_PX);
  el.style.height = `${nextHeight}px`;
  el.style.overflowY = el.scrollHeight > MOBILE_INPUT_MAX_HEIGHT_PX ? "auto" : "hidden";
}

function scheduleInputResize(): void {
  void nextTick(resizeInputTextarea);
}

interface MobileInputResult {
  sent: true;
}

const isMobileInputResult = (value: unknown): value is MobileInputResult => isRecord(value) && value.sent === true;

interface MobileInterruptResult {
  interrupted: true;
}

const isMobileInterruptResult = (value: unknown): value is MobileInterruptResult => isRecord(value) && value.interrupted === true;

interface MobileStopResult {
  stopped: true;
}

const isMobileStopResult = (value: unknown): value is MobileStopResult => isRecord(value) && value.stopped === true;

interface MobileCreateResult {
  ok: true;
  sessionId: string;
}

const isMobileCreateResult = (value: unknown): value is MobileCreateResult => isRecord(value) && value.ok === true && typeof value.sessionId === "string";

type SessionOperationStatus = "idle" | "sending" | "error";
const interruptStatus = ref<SessionOperationStatus>("idle");
const stopStatus = ref<SessionOperationStatus>("idle");

// Colours the activity word by urgency, matching the desktop roster's palette (CockpitHeader.vue's
// DOT_CLASS/BADGE_CLASS): blue while the agent is running, amber for the state that needs the
// user, the shared "done" green for a finished-but-unreviewed turn, muted for idle/waiting.
const ACTIVITY_CLASS: Record<ReturnType<typeof mobileActivityStatus>, string> = {
  planning: "text-accent",
  implementing: "text-accent",
  running: "text-accent",
  "needs input": "text-warn",
  done: "text-done",
  idle: "text-muted",
};

const activityStatusOf = (session: MobileSession) =>
  mobileActivityStatus(session.activity.working, session.activity.waiting, session.activity.event, session.activity.workPhase);
const activityClassOf = (session: MobileSession) => ACTIVITY_CLASS[activityStatusOf(session)];
const displayCwd = (cwd: string) => homeRelative(cwd, mobileHome.value);

function writeCachedMobileState(): void {
  try {
    const screen =
      selectedSessionId.value && screenStatus.value === "loaded"
        ? { sessionId: selectedSessionId.value, text: screenText.value, styledRows: screenStyledRows.value }
        : null;
    localStorage.setItem(
      MOBILE_STATE_CACHE_KEY,
      JSON.stringify({ home: mobileHome.value, sessions: sessions.value, selectedSessionId: selectedSessionId.value, screen }),
    );
  } catch {
    // Best effort only; cache failure must not affect the live mobile terminal.
  }
}

function restoreCachedMobileState(): boolean {
  try {
    const raw = localStorage.getItem(MOBILE_STATE_CACHE_KEY);
    if (!raw) return false;
    const cached = cachedMobileState(JSON.parse(raw));
    if (!cached || cached.sessions.length === 0) return false;
    mobileHome.value = cached.home;
    sessions.value = cached.sessions;
    const cachedSelection =
      cached.selectedSessionId && cached.sessions.some((session) => session.id === cached.selectedSessionId) ? cached.selectedSessionId : null;
    const nextSelectedSessionId = cachedSelection ?? cached.sessions.find((session) => session.live)?.id ?? cached.sessions[0]?.id ?? null;
    selectedSessionId.value = nextSelectedSessionId;
    const cachedScreen = cached.screen && cached.screen.sessionId === nextSelectedSessionId ? cached.screen : null;
    screenText.value = cachedScreen?.text ?? "";
    screenStyledRows.value = cachedScreen?.styledRows ?? null;
    screenStatus.value = cachedScreen ? "loaded" : "idle";
    status.value = "local";
    return true;
  } catch {
    return false;
  }
}

// The one place selection ever changes — a manual click (selectSession) and a poll's fallback
// (applySessionList, when the selected session has disappeared) both go through this. Whichever
// caller it is, switching sessions means the input box and any in-flight-send state belong to
// the session being left, not the one being entered: a line typed for the old session must not
// end up sent to the new one, and a stale "sending"/"error" from the old session must not leave
// the new session's input looking busy or broken. No-ops when `next` is already selected, so a
// re-click or a poll that returns the same selection touches neither ref.
function changeSelectedSession(next: string | null): void {
  if (next === selectedSessionId.value) return;

  selectedSessionId.value = next;
  inputText.value = "";
  inputStatus.value = "idle";
  copyStatus.value = "idle";
  lastCommandCopyText.value = "";
  manualCopyText.value = "";
  interruptStatus.value = "idle";
  if (stopStatus.value !== "sending") stopStatus.value = "idle";

  if (next) {
    trackSelectionScreenLoad(loadScreen(next));
  } else {
    screenStatus.value = "idle";
    screenText.value = "";
    screenStyledRows.value = null;
    lastCommandCopyText.value = "";
  }
}

watch(selectedSession, (session) => {
  if (newTerminalCwdTouched.value) return;
  if (session?.cwd) newTerminalCwd.value = session.cwd;
});

watch([inputText, screenStatus, selectedSessionId], scheduleInputResize);

// Applies a freshly fetched session list, keeping the current selection when it still exists
// (used by both the initial load and the recurring poll below) and only otherwise falling back
// to the first live session, then the first session, then nothing. On the initial load
// `selectedSessionId` is always null, so this always falls into the fallback branch — the same
// choice `load()` made before this was split out.
function applySessionList(parsed: MobileSession[]): void {
  sessions.value = parsed;
  if (notificationRequestedSessionId.value !== null && parsed.some((session) => session.id === notificationRequestedSessionId.value)) {
    const requested = notificationRequestedSessionId.value;
    notificationRequestedSessionId.value = null;
    changeSelectedSession(requested);
    return;
  }

  if (selectedSessionId.value !== null && parsed.some((session) => session.id === selectedSessionId.value)) return;

  const next = parsed.find((session) => session.live)?.id ?? parsed[0]?.id ?? null;
  changeSelectedSession(next);
}

// Parses a GET /api/mobile/terminal-sessions response, throwing on anything malformed. Shared by
// the initial load (a bad response fails the whole page) and the poll (a bad response is caught
// by the caller and simply skipped, leaving the list as it was).
interface MobileSessionListResult {
  sessions: MobileSession[];
  home: string | null;
}

async function fetchSessionList(): Promise<MobileSessionListResult> {
  const sessionsRes = await fetch("/api/mobile/terminal-sessions");
  if (!sessionsRes.ok) throw new Error(`HTTP ${sessionsRes.status}`);
  const sessionsBody = await jsonBody(sessionsRes);
  if (!isUnknownArray(sessionsBody.sessions)) throw new Error("invalid /api/mobile/terminal-sessions response");
  // Every row must be well-formed. Silently dropping a bad one would make the count, the empty
  // state and the first-live/first-session selection all quietly disagree with what the server
  // actually reported, so one invalid row fails the whole load instead.
  if (!sessionsBody.sessions.every(isMobileSession)) throw new Error("invalid session row in /api/mobile/terminal-sessions response");
  return { sessions: sessionsBody.sessions, home: typeof sessionsBody.home === "string" ? sessionsBody.home : null };
}

function applySessionListResult(result: MobileSessionListResult): void {
  mobileHome.value = result.home;
  applySessionList(result.sessions);
  writeCachedMobileState();
}

// Guards every call to fetchSessionList() — the initial load and every poll tick (interval or
// visibilitychange) share this one flag, so at most one GET /api/mobile/terminal-sessions is ever
// in flight. Without it, two overlapping fetches (a slow response plus a poll tick, or the
// interval firing at the same moment as a tab-resume refresh) can resolve out of order and the
// older one's applySessionList() call would overwrite the newer one's state with stale data.
let sessionListRefreshInFlight = false;
const sessionListRefreshBusy = ref(false);

async function withSessionListGuard(fetchAndApply: () => Promise<void>): Promise<void> {
  if (sessionListRefreshInFlight) return;
  sessionListRefreshInFlight = true;
  sessionListRefreshBusy.value = true;
  try {
    await fetchAndApply();
  } finally {
    sessionListRefreshInFlight = false;
    sessionListRefreshBusy.value = false;
  }
}

async function waitForSessionListIdle(): Promise<void> {
  while (sessionListRefreshInFlight) await new Promise((resolve) => setTimeout(resolve, 10));
}

// One shot: /api/mobile-mode, then the session list. Never called again except by the Retry
// button, which re-enters here from the mode check.
async function load(options: { keepStale?: boolean } = {}): Promise<void> {
  if (!options.keepStale) status.value = "loading";
  try {
    const modeRes = await fetch("/api/mobile-mode");
    if (!modeRes.ok) throw new Error(`HTTP ${modeRes.status}`);
    const modeBody = await jsonBody(modeRes);
    if (!isMobileMode(modeBody.mode)) throw new Error("invalid /api/mobile-mode response");

    await withSessionListGuard(async () => applySessionListResult(await fetchSessionList()));
    status.value = "local";
  } catch {
    if (!options.keepStale) status.value = "error";
  }
}

// Re-fetches the session list so activity (working/waiting/workPhase) and live/detached state
// stay current without a page reload — the poll below, and the immediate refresh on tab resume.
// Deliberately silent on failure and never flips `status`: an in-flight blip (server restart,
// a dropped connection) must not blank a list the user is currently looking at, and the next
// poll a couple of seconds later simply tries again. Guarded by sessionListRefreshInFlight so the
// interval and a visibilitychange resume never run concurrently with each other or with `load()`.
async function refreshSessionList(): Promise<void> {
  if (status.value !== "local") return;
  await withSessionListGuard(async () => {
    try {
      applySessionListResult(await fetchSessionList());
    } catch {
      // leave the current list showing; the next poll retries
    }
  });
}

const SESSION_LIST_POLL_MS = 2000;
let sessionListTimer: ReturnType<typeof setInterval> | null = null;

// Only while the tab is actually visible — a backgrounded phone tab has no reason to keep
// polling, and the resume handler below (handleVisibilityChange) already covers "came back".
function pollSessionListIfVisible(): void {
  if (document.visibilityState !== "visible") return;
  void refreshSessionList();
}

// Fetches one session's current screen exactly once. `requestedId` is captured at call time and
// re-checked against the live selection right before the response is reflected — the minimal
// guard against a slow response for a session the user has since switched away from landing on
// top of whatever the newer selection has already shown.
async function loadScreen(id: string): Promise<void> {
  const requestedId = id;
  screenStatus.value = "loading";
  try {
    const res = await fetch(`/api/mobile/terminal-sessions/${encodeURIComponent(id)}/screen`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const body = await jsonBody(res);
    if (!isMobileScreen(body)) throw new Error("invalid /api/mobile/terminal-sessions/:id/screen response");
    if (selectedSessionId.value !== requestedId) return;
    screenText.value = body.screen;
    screenStyledRows.value = body.styledScreen ?? null;
    lastCommandCopyText.value = body.lastCommandCopy?.text ?? "";
    copyStatus.value = "idle";
    screenStatus.value = "loaded";
    writeCachedMobileState();
  } catch {
    if (selectedSessionId.value !== requestedId) return;
    screenStatus.value = "error";
  }
}

async function copyLastCommandOutput(): Promise<void> {
  if (!lastCommandCopyText.value) return;
  if (selectedSession.value?.agent !== "shell") return;
  if (copyStatus.value === "copying") return;
  copyStatus.value = "copying";
  try {
    if (!navigator.clipboard) throw new Error("clipboard unavailable");
    await navigator.clipboard.writeText(lastCommandCopyText.value);
    copyStatus.value = "copied";
  } catch {
    await showManualCopy(lastCommandCopyText.value);
    copyStatus.value = "idle";
  }
}

let selectionScreenLoadPromise: Promise<void> | null = null;

function trackSelectionScreenLoad(loadPromise: Promise<void>): void {
  selectionScreenLoadPromise = loadPromise;
  void loadPromise.finally(() => {
    if (selectionScreenLoadPromise === loadPromise) selectionScreenLoadPromise = null;
  });
}

// The screen error's Retry button re-fetches only the currently selected session's screen — never
// the mode check or the session list, which the header Refresh owns.
function manualRefreshScreen(): void {
  if (!selectedSessionId.value) return;
  if (screenIsLoading()) return;
  if (manualRefreshCoolingDown.value) return;

  manualRefreshCoolingDown.value = true;
  cooldownTimeoutId = setTimeout(() => {
    manualRefreshCoolingDown.value = false;
    cooldownTimeoutId = null;
  }, MANUAL_REFRESH_COOLDOWN_MS);

  void loadScreen(selectedSessionId.value);
}

// Selection lives in this ref alone — no query param, no localStorage, no store. It is
// forgotten on reload, same as any other unrouted UI state on this page. Re-clicking the already
// selected session is a no-op: no new screen request for a session already showing (handled by
// changeSelectedSession's own guard).
function selectSession(id: string): void {
  changeSelectedSession(id);
}

// Sends the current input as one line to the selected session's PTY via the existing POST
// /input route, then clears it. `requestedId` is captured at call time and re-checked before
// the response is reflected, the same guard loadScreen uses — a response for a session the user
// has since switched away from must not touch the (now different) session's input state at all.
async function sendTerminalInput(): Promise<void> {
  if (!selectedSessionId.value) return;
  if (!selectedSession.value?.live) return;
  if (screenStatus.value !== "loaded") return;
  if (inputStatus.value === "sending") return;
  if (inputText.value.trim() === "") return;

  const requestedId = selectedSessionId.value;
  const text = inputText.value;
  inputStatus.value = "sending";
  lastCommandCopyText.value = "";
  copyStatus.value = "idle";
  manualCopyText.value = "";

  try {
    const res = await fetch(`/api/mobile/terminal-sessions/${encodeURIComponent(requestedId)}/input`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const body = await jsonBody(res);
    if (!isMobileInputResult(body)) throw new Error("invalid /api/mobile/terminal-sessions/:id/input response");
    if (selectedSessionId.value !== requestedId) return;
    inputText.value = "";
    inputStatus.value = "idle";
  } catch {
    if (selectedSessionId.value !== requestedId) return;
    inputStatus.value = "error";
  }
}

async function interruptSelectedSession(): Promise<void> {
  if (!selectedSessionId.value) return;
  if (!selectedSession.value?.live) return;
  if (interruptStatus.value === "sending") return;

  const requestedId = selectedSessionId.value;
  interruptStatus.value = "sending";

  try {
    const res = await fetch(`/api/mobile/terminal-sessions/${encodeURIComponent(requestedId)}/interrupt`, { method: "POST" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const body = await jsonBody(res);
    if (!isMobileInterruptResult(body)) throw new Error("invalid /api/mobile/terminal-sessions/:id/interrupt response");
    if (selectedSessionId.value !== requestedId) return;
    interruptStatus.value = "idle";
    await loadScreen(requestedId);
  } catch {
    if (selectedSessionId.value !== requestedId) return;
    interruptStatus.value = "error";
    await refreshSessionList();
  }
}

async function stopConfirmedSession(requestedId: string): Promise<void> {
  if (stopStatus.value === "sending") return;

  stopStatus.value = "sending";

  try {
    const res = await fetch(`/api/mobile/terminal-sessions/${encodeURIComponent(requestedId)}/stop`, { method: "POST" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const body = await jsonBody(res);
    if (!isMobileStopResult(body)) throw new Error("invalid /api/mobile/terminal-sessions/:id/stop response");
    await refreshSessionList();
    stopStatus.value = "idle";
  } catch {
    if (selectedSessionId.value !== requestedId) {
      stopStatus.value = "idle";
      await refreshSessionList();
      return;
    }
    stopStatus.value = "error";
    await refreshSessionList();
  }
}

async function createTerminal(): Promise<void> {
  if (createStatus.value === "creating") return;
  const cwd = newTerminalCwd.value.trim();
  if (!cwd) {
    createStatus.value = "error";
    createError.value = "Working directory is required.";
    return;
  }

  createStatus.value = "creating";
  createError.value = "";
  await waitForSessionListIdle();
  sessionListRefreshInFlight = true;

  try {
    const res = await fetch("/api/mobile/terminal-sessions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ agent: newTerminalAgent.value, cwd }),
    });
    const body = await jsonBody(res);
    if (!res.ok) throw new Error(typeof body.error === "string" ? body.error : `HTTP ${res.status}`);
    if (!isMobileCreateResult(body)) throw new Error("invalid /api/mobile/terminal-sessions response");

    const parsed = await fetchSessionList();
    mobileHome.value = parsed.home;
    sessions.value = parsed.sessions;
    changeSelectedSession(
      parsed.sessions.some((session) => session.id === body.sessionId)
        ? body.sessionId
        : (parsed.sessions.find((session) => session.live)?.id ?? parsed.sessions[0]?.id ?? null),
    );
    writeCachedMobileState();
    createStatus.value = "idle";
  } catch (err) {
    createStatus.value = "error";
    createError.value = err instanceof Error && err.message ? err.message : "Failed to create terminal.";
  } finally {
    sessionListRefreshInFlight = false;
  }
}

const manualMobileRefreshInFlight = ref(false);

function isNearScrollBottom(el: HTMLElement): boolean {
  return el.scrollHeight - el.clientHeight - el.scrollTop <= MAIN_SCROLL_BOTTOM_TOLERANCE_PX;
}

async function preserveMainScrollDuring(refresh: () => Promise<void>): Promise<void> {
  const scrollEl = mainScrollEl.value;
  const scrollTop = scrollEl?.scrollTop ?? 0;
  const scrollLeft = scrollEl?.scrollLeft ?? 0;
  const wasNearBottom = scrollEl ? isNearScrollBottom(scrollEl) : false;

  try {
    await refresh();
  } finally {
    await nextTick();
    if (scrollEl) {
      scrollEl.scrollTop = wasNearBottom ? Math.max(0, scrollEl.scrollHeight - scrollEl.clientHeight) : scrollTop;
      scrollEl.scrollLeft = scrollLeft;
    }
  }
}

async function refreshMobileData(): Promise<void> {
  if (manualMobileRefreshInFlight.value) return;
  if (status.value === "loading") return;
  if (sessionListRefreshInFlight) return;
  if (screenIsLoading()) return;

  manualMobileRefreshInFlight.value = true;
  try {
    await preserveMainScrollDuring(async () => {
      if (status.value !== "local") {
        await load();
        return;
      }

      const selectedBeforeRefresh = selectedSessionId.value;
      await refreshSessionList();
      if (!selectedSessionId.value) return;

      if (selectedSessionId.value !== selectedBeforeRefresh) {
        await selectionScreenLoadPromise;
        return;
      }

      if (!screenIsLoading()) await loadScreen(selectedSessionId.value);
    });
  } finally {
    manualMobileRefreshInFlight.value = false;
  }
}

// Refetches the session list and the selected session's screen whenever the tab comes back from
// the background — covering the phone-locked-then-unlocked case, where both would otherwise be
// however old they were when the tab went away. The session list refresh runs unconditionally
// (subject only to the `status === "local"` guard inside refreshSessionList itself); the screen
// refresh keeps its own independent guards below. Independent of the screen Retry cooldown in
// both directions: it fires even while that cooldown is running, and it never starts or resets
// it. Only the existing stale-response guard inside loadScreen applies; hidden itself changes
// nothing.
function handleVisibilityChange(): void {
  if (document.visibilityState !== "visible") return;
  if (status.value !== "local") return;

  void refreshSessionList();

  if (!selectedSessionId.value) return;
  if (screenStatus.value === "loading") return;

  void loadScreen(selectedSessionId.value);
}

onMounted(() => {
  const restored = restoreCachedMobileState();
  void load({ keepStale: restored }).then(() => {
    if (!restored) return;
    if (!selectedSessionId.value) return;
    if (screenStatus.value === "loading") return;
    void loadScreen(selectedSessionId.value);
  });
  document.addEventListener("visibilitychange", handleVisibilityChange);
  // Keeps activity (working/waiting/workPhase) and live/detached current while the list is on
  // screen. Runs for the lifetime of the component regardless of `status` — refreshSessionList
  // itself no-ops outside "local" — so a Retry that recovers into "local" is covered by the same
  // timer rather than needing to (re)start one.
  sessionListTimer = setInterval(pollSessionListIfVisible, SESSION_LIST_POLL_MS);
});

onUnmounted(() => {
  if (cooldownTimeoutId !== null) clearTimeout(cooldownTimeoutId);
  document.removeEventListener("visibilitychange", handleVisibilityChange);
  if (sessionListTimer !== null) clearInterval(sessionListTimer);
});
</script>

<template>
  <div class="flex h-dvh flex-col overflow-hidden bg-base text-fg">
    <!-- h-dvh keeps the page bound to the dynamic viewport as browser chrome (address bar, etc.)
         expands or collapses, and overflow-hidden stops the page itself from growing past it.
         On supporting Android browsers, index.html's interactive-widget=resizes-content also
         makes the layout viewport — and with it, this h-dvh — shrink when the on-screen keyboard
         opens, so the footer below stays above the keyboard instead of behind it. No
         VisualViewport or window.innerHeight JavaScript is used here; iOS and other browsers'
         keyboard behavior can still differ and needs real-device verification. Only `main` below
         scrolls; header and footer stay put via flex-none.
         (Kept as the first child rather than above the root <div>: a comment before a template's
         single root element makes Vue treat it as a multi-root fragment, and @vue/test-utils'
         wrapper.element/.classes() then resolve to that comment node instead of the div.) -->
    <header class="flex h-10 flex-none items-center justify-between border-b border-border bg-panel px-4">
      <div class="flex min-w-0 items-baseline gap-2">
        <span class="font-sans text-[14px] font-semibold tracking-[0.02em]">MulmoTerminal</span>
        <span class="truncate text-[12px] text-secondary">Local mobile terminal</span>
      </div>
      <button
        type="button"
        class="flex h-8 w-8 flex-none items-center justify-center rounded-md border border-border bg-panel text-fg hover:bg-hover disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-panel"
        aria-label="Refresh mobile terminal data"
        title="Refresh"
        data-testid="mobile-refresh-button"
        :disabled="status === 'loading' || sessionListRefreshBusy || screenStatus === 'loading' || manualMobileRefreshInFlight"
        @click="refreshMobileData"
      >
        <span class="material-symbols-outlined text-[18px] leading-none" aria-hidden="true">refresh</span>
      </button>
    </header>

    <!-- min-h-0 overrides the flex item's default min-height:auto, which otherwise lets this
         grow to fit its content instead of clipping to the space flex-1 gives it — without it,
         overflow-y-auto never kicks in and the page grows past the viewport instead of scrolling.
         overscroll-contain stops a scroll-past-the-end here from dragging the whole page (and,
         with it, the fixed footer) along with it. -->
    <main ref="mainScrollEl" class="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4">
      <p v-if="status === 'loading'" class="text-[13px] text-secondary">Loading…</p>

      <div v-else-if="status === 'error'" class="flex flex-col gap-2 text-[13px]">
        <p class="text-err-text">Failed to load terminal sessions.</p>
        <button type="button" class="w-fit rounded-md border border-border bg-panel px-2.5 py-1 text-[12px] text-fg hover:bg-hover" @click="() => load()">
          Retry
        </button>
      </div>

      <template v-else>
        <MobileWebPushPanel :session-id="selectedSessionId" />

        <MobileNewTerminalPanel
          :agent="newTerminalAgent"
          :cwd="newTerminalCwd"
          :error="createError"
          :status="createStatus"
          @create="createTerminal"
          @cwd-touched="newTerminalCwdTouched = true"
          @update:agent="newTerminalAgent = $event"
          @update:cwd="newTerminalCwd = $event"
        />

        <p v-if="sessions.length === 0" class="text-[13px] text-secondary">No terminal sessions.</p>

        <template v-else>
          <ul class="flex flex-col gap-2">
            <li v-for="session in sessions" :key="session.id">
              <button
                type="button"
                class="w-full rounded-md border px-3 py-2 text-left"
                :class="session.id === selectedSessionId ? 'border-accent bg-accent-bg text-on-accent' : 'border-border bg-elevated text-fg hover:bg-hover'"
                @click="selectSession(session.id)"
              >
                <div class="flex items-center justify-between gap-2">
                  <span class="truncate text-[13px] font-medium">{{ session.title }}</span>
                  <!-- Activity (running/planning/…/idle) alongside the connection state (live/detached) —
                       two different concepts (docs/grid-view-modes.md's desktop equivalent keeps them
                       as separate signals too), shown together since the phone has one line of room. -->
                  <span class="flex-none text-[11px]" :class="session.id === selectedSessionId ? 'text-on-accent' : activityClassOf(session)">
                    {{ activityStatusOf(session) }} · {{ session.live ? "live" : "detached" }}
                  </span>
                </div>
                <div class="truncate text-[11px]" :class="session.id === selectedSessionId ? 'text-on-accent' : 'text-secondary'" :title="session.cwd">
                  {{ displayCwd(session.cwd) }}
                </div>
                <div v-if="session.agent" class="text-[11px] text-muted">{{ session.agent }}</div>
              </button>
            </li>
          </ul>

          <div v-if="selectedSession" class="mt-4 flex flex-col gap-2">
            <div class="flex items-center justify-between gap-2">
              <h2 class="truncate text-[13px] font-medium text-fg">{{ selectedSession.title }}</h2>
            </div>

            <MobileSessionActions
              :session="selectedSession"
              :interrupt-status="interruptStatus"
              :stop-status="stopStatus"
              @interrupt="interruptSelectedSession"
              @stop="stopConfirmedSession"
            />
            <div v-if="selectedSession.agent === 'shell'" class="flex flex-wrap items-center gap-2">
              <button
                type="button"
                class="inline-flex items-center gap-1 rounded-md border border-border bg-panel px-3 py-1.5 text-[12px] text-fg hover:bg-hover disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-panel"
                :disabled="copyStatus === 'copying' || !lastCommandCopyText"
                :title="lastCommandCopyText ? 'Copy last command output' : 'Run a command to enable copy'"
                @click="copyLastCommandOutput"
              >
                <span class="material-symbols-outlined text-[16px] leading-none" aria-hidden="true">content_copy</span>
                {{ copyStatus === "copying" ? "Copying…" : copyStatus === "copied" ? "Copied" : "Copy last command" }}
              </button>
              <span v-if="!lastCommandCopyText" class="text-[11px] text-secondary">Run a command to enable copy</span>
            </div>

            <p v-if="screenStatus === 'loading'" class="text-[13px] text-secondary">Loading terminal screen…</p>

            <div v-else-if="screenStatus === 'error'" class="flex flex-col gap-2 text-[13px]">
              <p class="text-err-text">Failed to load terminal screen.</p>
              <button
                type="button"
                class="w-fit rounded-md border border-border bg-panel px-2.5 py-1 text-[12px] text-fg hover:bg-hover disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-panel"
                :disabled="manualRefreshCoolingDown"
                @click="manualRefreshScreen"
              >
                Retry
              </button>
            </div>

            <!--
            Two renderings of the same "loaded" state, never both at once. Styled rows are
            preferred whenever the server sent a valid one (isMobileScreen already checked its
            shape); a row's OWN text still reaches the DOM only through `{{ }}` interpolation,
            so `<script>`/HTML in terminal output is escaped exactly as it always was in the
            plain-text pre below — the row/segment split only adds structure (line breaks,
            colour), never a new way for content to become markup. The fixed dark background
            here (rather than the page's own bg-elevated) is deliberate: ANSI's 16-colour
            palette (server/session/ansiSegments.ts) is tuned for a dark terminal background and
            would lose contrast against a light theme's page background otherwise — see the
            palette's own comment. A row with no segments (a blank terminal line) falls back to
            BLANK_ROW_FILLER so its <div> still has a line box — see that constant's comment.
          -->
            <pre
              v-else-if="screenStatus === 'loaded' && screenStyledRows"
              class="overflow-x-auto whitespace-pre rounded-md border border-border p-2 font-mono text-[12px]"
              style="background-color: #1e1e1e; color: #d4d4d4"
            ><div v-for="(row, rowIndex) in screenStyledRows" :key="rowIndex"><span v-if="row.length === 0">{{ BLANK_ROW_FILLER }}</span><span v-for="(segment, segIndex) in row" :key="segIndex" :style="segmentStyle(segment)">{{ segment.text }}</span></div></pre>
            <pre
              v-else-if="screenStatus === 'loaded'"
              class="overflow-x-auto whitespace-pre rounded-md border border-border bg-elevated p-2 font-mono text-[12px] text-fg"
              >{{ screenText }}</pre>

            <p v-if="screenStatus === 'loaded' && !selectedSession.live" class="text-[12px] text-muted">Detached sessions are read-only.</p>
          </div>
        </template>
      </template>
    </main>

    <!-- Outside `main` on purpose: the input has to stay on screen while the session list and
         terminal output scroll past it, not scroll away with them. flex-none plus the column
         layout above is what pins it to the bottom — no position:fixed/sticky needed, and so
         nothing here has to account for header height or scroll offset the way those would. -->
    <footer
      v-if="status === 'local' && screenStatus === 'loaded' && selectedSession?.live"
      class="flex-none border-t border-border bg-panel px-4 pt-2 pb-[max(0.5rem,env(safe-area-inset-bottom))]"
    >
      <form class="flex items-end gap-2" @submit.prevent="sendTerminalInput">
        <textarea
          ref="inputTextareaEl"
          v-model="inputText"
          data-testid="mobile-terminal-input"
          rows="1"
          placeholder="Type…"
          class="min-h-[42px] min-w-0 flex-1 resize-none rounded-md border border-border bg-elevated px-2.5 py-2 text-[16px] leading-6 text-fg placeholder:text-muted disabled:cursor-not-allowed disabled:opacity-50"
          :disabled="inputStatus === 'sending'"
        />
        <button
          type="submit"
          class="flex-none rounded-md border border-border bg-panel px-3 py-2 text-[13px] text-fg hover:bg-hover disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-panel"
          :disabled="inputStatus === 'sending' || inputText.trim() === ''"
        >
          Send
        </button>
      </form>

      <p v-if="inputStatus === 'error'" class="mt-1 text-[12px] text-err-text">Failed to send terminal input.</p>
    </footer>

    <div v-if="manualCopyText" class="fixed inset-0 z-50 flex items-center justify-center bg-black/45 px-4" role="dialog" aria-modal="true">
      <div class="flex max-h-[80vh] w-full max-w-lg flex-col gap-2 rounded-md border border-border bg-panel p-4 shadow-lg">
        <p class="text-[13px] text-fg">Copy command output</p>
        <p class="text-[12px] text-secondary">Clipboard access is blocked here. The text is selected below.</p>
        <textarea
          :ref="setManualCopyTextareaEl"
          readonly
          data-testid="mobile-last-command-manual-copy"
          class="h-[45vh] w-full resize-none rounded-md border border-border bg-elevated p-2 font-mono text-[12px] text-fg"
          :value="manualCopyText"
        />
        <button type="button" class="self-end rounded-md border border-border bg-panel px-3 py-1.5 text-[13px] text-fg hover:bg-hover" @click="closeManualCopy">
          Close
        </button>
      </div>
    </div>
  </div>
</template>
