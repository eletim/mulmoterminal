import { onUnmounted, watch, type Ref } from "vue";
import { usePubSub } from "./usePubSub";
import { notifyKindOf, isActivityMsg, type ActivityState } from "./notifyKind";
import { NOTIFY_KINDS, type NotifyKind } from "../../common/notifyKinds";
import { parsePresetRef } from "../../common/notifySounds";

// What the player needs from the user's config: which moments beep, and what each plays.
// `soundFile` is the all-kind fallback a `sounds` entry overrides.
export interface SoundConfig {
  kinds: NotifyKind[];
  sounds: Partial<Record<NotifyKind, string>>;
  soundFile: string | null;
}

let audioCtx: AudioContext | null = null;

function getCtx(): AudioContext | null {
  try {
    audioCtx = audioCtx ?? new AudioContext();
    return audioCtx;
  } catch {
    return null;
  }
}

// Autoplay policy: an AudioContext starts suspended until a user gesture, so a beep
// fired from an event (not a gesture) would be silent. Arm a one-shot listener that
// resumes the context on the first click/keypress anywhere; after that, beeps play.
let unlockArmed = false;
function armUnlock() {
  if (unlockArmed) return;
  unlockArmed = true;
  const unlock = () => {
    const ctx = getCtx();
    if (ctx && ctx.state === "suspended") ctx.resume().catch(() => {});
    window.removeEventListener("pointerdown", unlock);
    window.removeEventListener("keydown", unlock);
  };
  window.addEventListener("pointerdown", unlock);
  window.addEventListener("keydown", unlock);
}

// The synthesized fallback, one two-note figure per kind. Rising and bright means the agent
// wants you; falling and low means something ended or broke. Frequencies rather than assets,
// so the fallback still works with no network and nothing configured.
const CHIME_NOTES: Record<NotifyKind, readonly [number, number]> = {
  waiting: [784, 1047], // G5→C6 — it stopped to ask
  finished: [1047, 784], // C6→G5 — the turn ended
  "command-done": [659, 988], // E5→B5
  "command-failed": [440, 330], // A4→E4
  "session-exited": [523, 392], // C5→G4
  "pr-ci-failed": [415, 311], // G#4→D#4
};

function playChime(kind: NotifyKind) {
  const ctx = getCtx();
  if (!ctx) return;
  if (ctx.state === "suspended") ctx.resume().catch(() => {});
  const tone = (freq: number, start: number, dur: number) => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.value = freq;
    const t = ctx.currentTime + start;
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.25, t + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(gain).connect(ctx.destination);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  };
  try {
    const [first, second] = CHIME_NOTES[kind];
    tone(first, 0, 0.16);
    tone(second, 0.14, 0.22);
  } catch {
    // no Web Audio — stay silent
  }
}

// Decoded audio, keyed by a string that changes when the SOURCE changes, so a settings edit
// reloads rather than replaying the old file. `null` means "asked, and this source has no
// sound" and is remembered on purpose — a directory without one must not be refetched on
// every beep. A key left UNKNOWN is retried instead.
const buffers = new Map<string, AudioBuffer | null>();
const loading = new Map<string, Promise<void>>();

/**
 * Whether a non-OK response is this source saying it HAS no sound (remember it) rather than
 * "ask again later". A 5xx is the second: the server reached for a preset and could not get
 * it, which one offline moment must not turn into a permanently silent kind.
 */
export const isDefinitiveMiss = (status: number): boolean => status < 500;

function loadBuffer(key: string, url: string): Promise<void> {
  const existing = loading.get(key);
  if (existing) return existing;
  const pending = (async () => {
    const ctx = getCtx();
    if (!ctx) return; // no AudioContext yet — leave the key unknown so a later beep retries
    let response: Response;
    try {
      response = await fetch(url);
    } catch {
      return; // the request never completed — unknown, so the next beep tries again
    }
    if (!response.ok) {
      if (isDefinitiveMiss(response.status)) buffers.set(key, null);
      return;
    }
    try {
      buffers.set(key, await ctx.decodeAudioData(await response.arrayBuffer()));
    } catch {
      // Served, but not audio: the configured file is wrong, not the network. Remember it
      // rather than decoding the same bad bytes on every beep.
      buffers.set(key, null);
    }
  })();
  loading.set(
    key,
    pending.finally(() => loading.delete(key)),
  );
  return pending;
}

function playBuffer(buf: AudioBuffer) {
  const ctx = getCtx();
  if (!ctx) return;
  if (ctx.state === "suspended") ctx.resume().catch(() => {});
  const src = ctx.createBufferSource();
  const gain = ctx.createGain();
  gain.gain.value = 0.6;
  src.buffer = buf;
  src.connect(gain).connect(ctx.destination);
  src.start();
}

/** The user's configured sound for a kind, or null when only the built-in chime applies. */
export function globalSoundValue(kind: NotifyKind, config: SoundConfig): string | null {
  return config.sounds[kind] ?? config.soundFile;
}

// Cache keys. The parts are joined with an explicit NUL, the same separator rosterCellsKey
// uses and for the same reason: it cannot occur in a path or a config value, so a cwd holding
// the separator character cannot forge a boundary and make two different sources collide.
const SEP = "\u0000";
// A directory's sound is resolved SERVER-side (its per-kind entry, then its all-kind one), so
// the key is just what identifies the request.
const dirKey = (cwd: string, kind: NotifyKind) => `dir${SEP}${cwd}${SEP}${kind}`;
// The global key is the RESOLVED VALUE and not the kind: the value already says which entry
// won, so two kinds left on the same fallback file share one download and one decoded buffer
// rather than fetching identical bytes once per kind. Picking a different sound changes the
// value, which is what invalidates the cache.
const globalKey = (value: string) => `app${SEP}${value}`;

const dirUrl = (cwd: string, kind: NotifyKind) => `/api/dir-sound?cwd=${encodeURIComponent(cwd)}&kind=${encodeURIComponent(kind)}`;

// A preset is addressed DIRECTLY rather than through /api/sound?kind=. Same bytes either way,
// but the preset route answers from the fixed catalog instead of the saved config — which is
// what lets the Settings preview play a sound the user has only just picked, before the POST
// that saves it has come back. A file path still goes through the config route: the path is
// server-side by design and is never put in a request.
const globalUrl = (kind: NotifyKind, value: string) => {
  const presetId = parsePresetRef(value);
  return presetId ? `/api/sound-preset/${encodeURIComponent(presetId)}` : `/api/sound?kind=${encodeURIComponent(kind)}&v=${encodeURIComponent(value)}`;
};

// The sources to try for one beep, nearest first: the session directory's own sound, then the
// user's global one. Each entry is a cache key plus where to fetch it; the caller plays the
// first that is already decoded and starts loading the first that isn't.
export function soundSources(kind: NotifyKind, cwd: string | null, config: SoundConfig): { key: string; url: string }[] {
  const sources = cwd ? [{ key: dirKey(cwd, kind), url: dirUrl(cwd, kind) }] : [];
  const value = globalSoundValue(kind, config);
  if (value) sources.push({ key: globalKey(value), url: globalUrl(kind, value) });
  return sources;
}

/**
 * Play the notification for a kind: the nearest configured sound that is already decoded,
 * else the built-in chime. A source not yet decoded is loaded in the background, so the FIRST
 * beep for it falls back and later ones use it — the beep itself never waits on a fetch.
 */
export function playNotify(kind: NotifyKind, cwd: string | null, config: SoundConfig) {
  for (const { key, url } of soundSources(kind, cwd, config)) {
    const buf = buffers.get(key);
    if (buf) return playBuffer(buf);
    if (buf === undefined) void loadBuffer(key, url);
  }
  playChime(kind);
}

/** Test-button variant: AWAIT the load so a just-picked sound is actually heard. Pass the value
 *  the user is LOOKING at, not the saved one — a preset resolves without the server's config, so
 *  the preview is right even while the save is still in flight. */
export async function previewNotify(kind: NotifyKind, config: SoundConfig): Promise<void> {
  const value = globalSoundValue(kind, config);
  if (value) {
    const key = globalKey(value);
    await loadBuffer(key, globalUrl(kind, value));
    const buf = buffers.get(key);
    if (buf) return playBuffer(buf);
  }
  playChime(kind);
}

/**
 * Beep when a session raises a notification, across every page/view, by listening to the same
 * "sessions" activity stream the cells use — so the beep tracks the amber header exactly.
 * `enabled` is the master toggle; `config.kinds` says which moments qualify (#873).
 */
export function useAttentionSound(enabled: Ref<boolean>, config: Ref<SoundConfig>) {
  armUnlock();
  // Preload each enabled kind's global sound whenever the config changes, so the first beep
  // can already use it instead of falling back to the chime.
  watch(
    config,
    (c) =>
      NOTIFY_KINDS.filter((kind) => c.kinds.includes(kind)).forEach((kind) => {
        const value = globalSoundValue(kind, c);
        if (value) void loadBuffer(globalKey(value), globalUrl(kind, value));
      }),
    { immediate: true, deep: true },
  );
  const prev = new Map<string, ActivityState>();
  const { subscribe } = usePubSub();
  const unsubscribe = subscribe("sessions", (d) => {
    if (!isActivityMsg(d)) return;
    const kind = notifyKindOf(prev, d);
    if (kind && enabled.value && config.value.kinds.includes(kind)) playNotify(kind, d.cwd ?? null, config.value);
  });
  onUnmounted(unsubscribe);
}
