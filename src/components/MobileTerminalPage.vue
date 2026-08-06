<script setup lang="ts">
// The mobile entry point (/mobile/terminals), mounted by App.vue instead of
// DesktopAppShell — never alongside it. Wired to the local mobile terminal API: which transport
// mode the server is running (GET /api/mobile-mode), only in local mode the terminal session
// roster (GET /api/mobile/terminal-sessions), the selected session's current terminal screen
// (GET /api/mobile/terminal-sessions/:id/screen), and — for a live session — sending it one line
// of input (POST /api/mobile/terminal-sessions/:id/input). Launching a terminal is still a
// follow-up change.
import { computed, onMounted, onUnmounted, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { isMobileMode } from "../../common/mobileMode";
import { SESSION_AGENTS } from "../../common/sessionAgent";
import { isRecord } from "../../common/isRecord";
import { isUnknownArray } from "../../common/isUnknownArray";
import { isAnsiScreen, type AnsiRow, type AnsiSegment } from "../../common/ansiStyle";
import { jsonBody } from "../jsonBody";
import {
  MOBILE_WEB_PUSH_PUBLIC_KEY,
  mobileTerminalNotificationUrl,
  mobileWebPushSupport,
  readSessionIdQuery,
  registerMobileWebPushServiceWorker,
  urlBase64ToUint8Array,
} from "../mobileWebPushClient";
import { isWorkPhase, mobileActivityStatus, type WorkPhase } from "./mobileActivityStatus";

const router = useRouter();
const route = useRoute();
const notificationRequestedSessionId = ref(readSessionIdQuery(route.query.sessionId));

function backToDesktop(): void {
  void router.push("/terminals");
}

// The activity local mode alone adds to a session row (server/routes/local-mobile-terminal-
// routes.ts's LocalSessionActivity) — never present on remote mobile's Firestore-backed rows,
// but this page only ever talks to the local route, so it is required here rather than optional.
// Present-but-idle (false/false/null/null) for a session activity has never observed — a fresh
// launch, a shell, a tmux-only survivor of a restart — never an absent field.
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

// The fields this page reads off a GET /api/mobile/terminal-sessions row. The backend's
// TerminalSessionSummary (server/backends/remoteHost/terminalScreen.ts) carries more
// (work, …) — nothing here needs it yet, so it stays off this shape rather than pulled in.
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

type Status = "loading" | "remote-disabled" | "local" | "error";

const status = ref<Status>("loading");
const sessions = ref<MobileSession[]>([]);
const selectedSessionId = ref<string | null>(null);
const selectedSession = computed(() => sessions.value.find((candidate) => candidate.id === selectedSessionId.value) ?? null);

type PushStatus = "checking" | "ready" | "unsupported" | "error";
type PushBusy = "enable" | "disable" | "test" | null;

const pushSupport = mobileWebPushSupport();
const pushStatus = ref<PushStatus>(pushSupport.supported ? "checking" : "unsupported");
const pushBusy = ref<PushBusy>(null);
const pushPermission = ref<NotificationPermission | "unknown">(pushSupport.supported ? Notification.permission : "unknown");
const pushSubscribed = ref(false);
const pushSubscriptionJson = ref<PushSubscriptionJSON | null>(null);
const pushError = ref<string | null>(pushSupport.supported ? null : pushSupport.reason);

const permissionLabel = computed(() => {
  if (pushPermission.value === "granted") return "Allowed";
  if (pushPermission.value === "denied") return "Blocked";
  if (pushPermission.value === "default") return "Not asked";
  return "Unknown";
});
const subscriptionLabel = computed(() => (pushSubscribed.value ? "Active" : "Off"));
const pushSummaryLabel = computed(() => {
  if (pushBusy.value) return "Working";
  if (pushStatus.value === "unsupported") return "Unsupported";
  if (pushStatus.value === "error") return "Needs attention";
  return pushSubscribed.value ? "On" : "Off";
});
const canEnablePush = computed(() => pushSupport.supported && !pushBusy.value && !pushSubscribed.value && pushPermission.value !== "denied");
const canDisablePush = computed(() => pushSupport.supported && !pushBusy.value && pushSubscribed.value);
const canTestPush = computed(() => pushSupport.supported && !pushBusy.value && pushPermission.value !== "denied");

// The two fields this page reads off GET /api/mobile/terminal-sessions/:id/screen. The backend's
// SessionScreen also carries suggestion, quickCommands and meta (cwd, branch, memo, summary,
// prompt, githubUrl) — none of it is used or shown here yet, so it stays off this shape.
//
// styledScreen is optional on the wire (server/routes/local-mobile-terminal-routes.ts): an
// older server, or a session the styling step itself failed for, sends `screen` alone, and this
// page falls back to the plain-text display it has always had (see the template below) rather
// than showing nothing.
interface MobileScreen {
  screen: string;
  styledScreen: AnsiRow[] | undefined;
}

const isMobileScreen = (value: unknown): value is MobileScreen =>
  isRecord(value) && typeof value.screen === "string" && (value.styledScreen === undefined || isAnsiScreen(value.styledScreen));

type ScreenStatus = "idle" | "loading" | "loaded" | "error";

const screenStatus = ref<ScreenStatus>("idle");
const screenText = ref("");
// null covers both "no styled rows on this response" and "reset because the session changed" —
// either way the template's v-else-if falls back to the plain-text screen below.
const screenStyledRows = ref<AnsiRow[] | null>(null);

// segment.fg/bg are pre-resolved "#rrggbb" strings or null (never raw terminal bytes — see
// common/ansiStyle.ts) and are applied here as a `:style` OBJECT, which Vue sets via direct
// CSSStyleDeclaration property assignment. That is what keeps this safe without a sanitizer: a
// value that isn't a valid CSS colour is simply dropped by the browser, never parsed as markup,
// and the segment's actual text only ever reaches the DOM through `{{ }}` interpolation below,
// which HTML-escapes it the same way the plain-text screen always has.
function segmentStyle(segment: AnsiSegment): Record<string, string> {
  const style: Record<string, string> = {};
  if (segment.fg) style.color = segment.fg;
  if (segment.bg) style.backgroundColor = segment.bg;
  if (segment.bold) style.fontWeight = "700";
  return style;
}

// An empty AnsiRow (a genuinely blank terminal line) renders as a `<div>` with no text content
// at all — and an empty block element has no line box, so the row collapses to zero height and
// the blank line disappears from the styled view (unlike the plain-text <pre> below, where the
// same blank line is a real "\n" and keeps its height for free). A no-break space gives the div
// content to lay out without being visible or copy-pasted as a stray glyph.
const BLANK_ROW_FILLER = "\u00A0";

// Rate limit for the manual Refresh/Retry button alone — session switches bypass it entirely
// (section 9 of the spec this implements). Counted from when a refresh STARTS, not when its
// request resolves, so a slow or failing request doesn't extend the cooldown.
const MANUAL_REFRESH_COOLDOWN_MS = 5000;
const manualRefreshCoolingDown = ref(false);
let cooldownTimeoutId: ReturnType<typeof setTimeout> | null = null;

// One line of input, sent to a live session's PTY as-is. Sanitization, control-character
// stripping, bracketed paste and Enter handling are all the existing POST /input route's job
// (server/backends/remoteHost/terminalInput.ts) — this page only forwards what was typed.
const inputText = ref("");
type InputStatus = "idle" | "sending" | "error";
const inputStatus = ref<InputStatus>("idle");

interface MobileInputResult {
  sent: true;
}

const isMobileInputResult = (value: unknown): value is MobileInputResult => isRecord(value) && value.sent === true;

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

  if (next) {
    void loadScreen(next);
  } else {
    screenStatus.value = "idle";
    screenText.value = "";
    screenStyledRows.value = null;
  }
}

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

function syncPushPermission(): void {
  if (!pushSupport.supported) return;
  pushPermission.value = Notification.permission;
}

function reflectSubscription(subscription: PushSubscription | null): void {
  pushSubscribed.value = subscription !== null;
  pushSubscriptionJson.value = subscription?.toJSON() ?? null;
}

async function refreshPushState(): Promise<void> {
  if (!pushSupport.supported) return;

  pushStatus.value = "checking";
  pushError.value = null;
  syncPushPermission();

  try {
    const registration = await registerMobileWebPushServiceWorker();
    reflectSubscription(await registration.pushManager.getSubscription());
    syncPushPermission();
    pushStatus.value = "ready";
  } catch {
    pushStatus.value = "error";
    pushError.value = "Failed to register notifications.";
  }
}

async function ensureNotificationPermission(): Promise<boolean> {
  if (!pushSupport.supported) return false;
  if (Notification.permission === "default") await Notification.requestPermission();
  syncPushPermission();

  if (Notification.permission === "granted") return true;
  pushError.value = Notification.permission === "denied" ? "Notifications are blocked in this browser." : "Notification permission was not granted.";
  return false;
}

async function enablePushNotifications(): Promise<void> {
  if (!pushSupport.supported || pushBusy.value) return;

  pushBusy.value = "enable";
  pushError.value = null;
  try {
    if (!(await ensureNotificationPermission())) return;

    const registration = await registerMobileWebPushServiceWorker();
    const existing = await registration.pushManager.getSubscription();
    const subscription =
      existing ??
      (await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(MOBILE_WEB_PUSH_PUBLIC_KEY),
      }));
    reflectSubscription(subscription);
    pushStatus.value = "ready";
  } catch {
    pushStatus.value = "error";
    pushError.value = "Failed to subscribe to notifications.";
  } finally {
    pushBusy.value = null;
    syncPushPermission();
  }
}

async function disablePushNotifications(): Promise<void> {
  if (!pushSupport.supported || pushBusy.value) return;

  pushBusy.value = "disable";
  pushError.value = null;
  try {
    const registration = await registerMobileWebPushServiceWorker();
    const subscription = await registration.pushManager.getSubscription();
    if (subscription) await subscription.unsubscribe();
    reflectSubscription(null);
    pushStatus.value = "ready";
  } catch {
    pushStatus.value = "error";
    pushError.value = "Failed to unsubscribe from notifications.";
  } finally {
    pushBusy.value = null;
    syncPushPermission();
  }
}

async function showLocalTestNotification(): Promise<void> {
  if (!pushSupport.supported || pushBusy.value) return;

  pushBusy.value = "test";
  pushError.value = null;
  try {
    if (!(await ensureNotificationPermission())) return;
    const registration = await registerMobileWebPushServiceWorker();
    await registration.showNotification("MulmoTerminal test", {
      body: "Mobile notifications are working.",
      tag: "mulmoterminal-mobile-test",
      data: { url: mobileTerminalNotificationUrl(selectedSessionId.value) },
    });
  } catch {
    pushStatus.value = "error";
    pushError.value = "Failed to show the test notification.";
  } finally {
    pushBusy.value = null;
    syncPushPermission();
  }
}

// Parses a GET /api/mobile/terminal-sessions response, throwing on anything malformed. Shared by
// the initial load (a bad response fails the whole page) and the poll (a bad response is caught
// by the caller and simply skipped, leaving the list as it was).
async function fetchSessionList(): Promise<MobileSession[]> {
  const sessionsRes = await fetch("/api/mobile/terminal-sessions");
  if (!sessionsRes.ok) throw new Error(`HTTP ${sessionsRes.status}`);
  const sessionsBody = await jsonBody(sessionsRes);
  if (!isUnknownArray(sessionsBody.sessions)) throw new Error("invalid /api/mobile/terminal-sessions response");
  // Every row must be well-formed. Silently dropping a bad one would make the count, the empty
  // state and the first-live/first-session selection all quietly disagree with what the server
  // actually reported, so one invalid row fails the whole load instead.
  if (!sessionsBody.sessions.every(isMobileSession)) throw new Error("invalid session row in /api/mobile/terminal-sessions response");
  return sessionsBody.sessions;
}

// Guards every call to fetchSessionList() — the initial load and every poll tick (interval or
// visibilitychange) share this one flag, so at most one GET /api/mobile/terminal-sessions is ever
// in flight. Without it, two overlapping fetches (a slow response plus a poll tick, or the
// interval firing at the same moment as a tab-resume refresh) can resolve out of order and the
// older one's applySessionList() call would overwrite the newer one's state with stale data.
let sessionListRefreshInFlight = false;

async function withSessionListGuard(fetchAndApply: () => Promise<void>): Promise<void> {
  if (sessionListRefreshInFlight) return;
  sessionListRefreshInFlight = true;
  try {
    await fetchAndApply();
  } finally {
    sessionListRefreshInFlight = false;
  }
}

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

    await withSessionListGuard(async () => applySessionList(await fetchSessionList()));
    status.value = "local";
  } catch {
    status.value = "error";
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
      applySessionList(await fetchSessionList());
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
    screenStatus.value = "loaded";
  } catch {
    if (selectedSessionId.value !== requestedId) return;
    screenStatus.value = "error";
  }
}

// The manual Refresh button and the screen error's Retry button are the same action: re-fetch
// only the currently selected session's screen — never the mode check or the session list,
// which have their own Retry — rate-limited to one call per MANUAL_REFRESH_COOLDOWN_MS.
function manualRefreshScreen(): void {
  if (!selectedSessionId.value) return;
  if (screenStatus.value === "loading") return;
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

// Refetches the session list and the selected session's screen whenever the tab comes back from
// the background — covering the phone-locked-then-unlocked case, where both would otherwise be
// however old they were when the tab went away. The session list refresh runs unconditionally
// (subject only to the `status === "local"` guard inside refreshSessionList itself); the screen
// refresh keeps its own independent guards below. Independent of the manual Refresh cooldown in
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
  void load();
  void refreshPushState();
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
      <button type="button" class="flex-none rounded-md border border-border bg-panel px-2.5 py-1 text-[12px] text-fg hover:bg-hover" @click="backToDesktop">
        Back to desktop
      </button>
    </header>

    <!-- min-h-0 overrides the flex item's default min-height:auto, which otherwise lets this
         grow to fit its content instead of clipping to the space flex-1 gives it — without it,
         overflow-y-auto never kicks in and the page grows past the viewport instead of scrolling.
         overscroll-contain stops a scroll-past-the-end here from dragging the whole page (and,
         with it, the fixed footer) along with it. -->
    <main class="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4">
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

      <template v-else>
        <section class="mb-4 rounded-md border border-border bg-panel p-3 text-[12px]" data-testid="mobile-web-push-panel">
          <div class="mb-2 flex items-center justify-between gap-2">
            <h2 class="text-[13px] font-medium text-fg">Notifications</h2>
            <span class="flex-none text-secondary">{{ pushSummaryLabel }}</span>
          </div>

          <div class="grid grid-cols-2 gap-x-3 gap-y-1">
            <span class="text-muted">Permission</span>
            <span class="text-fg">{{ permissionLabel }}</span>
            <span class="text-muted">Subscription</span>
            <span class="text-fg">{{ subscriptionLabel }}</span>
          </div>

          <p v-if="pushSubscriptionJson" class="mt-2 text-muted">Subscription ready for server storage.</p>
          <p v-if="pushError" class="mt-2 text-err-text">{{ pushError }}</p>

          <div class="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              class="rounded-md border border-border bg-elevated px-2.5 py-1 text-[12px] text-fg hover:bg-hover disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-elevated"
              :disabled="!canEnablePush"
              @click="enablePushNotifications"
            >
              Enable
            </button>
            <button
              type="button"
              class="rounded-md border border-border bg-elevated px-2.5 py-1 text-[12px] text-fg hover:bg-hover disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-elevated"
              :disabled="!canDisablePush"
              @click="disablePushNotifications"
            >
              Disable
            </button>
            <button
              type="button"
              class="rounded-md border border-border bg-elevated px-2.5 py-1 text-[12px] text-fg hover:bg-hover disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-elevated"
              :disabled="!canTestPush"
              @click="showLocalTestNotification"
            >
              Test notification
            </button>
          </div>
        </section>

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
                <div class="truncate text-[11px]" :class="session.id === selectedSessionId ? 'text-on-accent' : 'text-secondary'">{{ session.cwd }}</div>
                <div v-if="session.agent" class="text-[11px] text-muted">{{ session.agent }}</div>
              </button>
            </li>
          </ul>

          <div v-if="selectedSession" class="mt-4 flex flex-col gap-2">
            <div class="flex items-center justify-between gap-2">
              <h2 class="truncate text-[13px] font-medium text-fg">{{ selectedSession.title }}</h2>
              <button
                type="button"
                class="flex-none rounded-md border border-border bg-panel px-2.5 py-1 text-[12px] text-fg hover:bg-hover disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-panel"
                :disabled="screenStatus === 'loading' || manualRefreshCoolingDown"
                @click="manualRefreshScreen"
              >
                Refresh
              </button>
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
      <form class="flex gap-2" @submit.prevent="sendTerminalInput">
        <input
          v-model="inputText"
          type="text"
          placeholder="Type a line…"
          class="min-w-0 flex-1 rounded-md border border-border bg-elevated px-2.5 py-2 text-[16px] text-fg placeholder:text-muted disabled:cursor-not-allowed disabled:opacity-50"
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
  </div>
</template>
