// Serving a preset attention sound, fetching it once and keeping it.
//
// The audio is not in this package (see common/notifySounds.ts for why). The first play of
// a preset downloads it into ~/.mulmoterminal/sounds/; every later play — including every
// later RUN — reads that file, so the sound survives being offline. A failed download is
// deliberately NOT cached as a failure: the caller falls back to the built-in chime and the
// next play tries again, because "offline once" must not mean "silent forever".

import { statSync } from "node:fs";
import { readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { writeFileAtomic } from "../files/atomic-write.js";
import { messageOf } from "../errors.js";
import { SOUND_PRESET_BASE_URL, soundPresetById } from "../../common/notifySounds.js";

export const SOUNDS_DIR = path.join(os.homedir(), ".mulmoterminal", "sounds");

const FETCH_TIMEOUT_MS = 10_000;
// A preset is a short notification sound; the largest in the set is ~110 KB. The cap is what
// stops a replaced or redirected URL from writing something huge into the user's home.
const MAX_PRESET_BYTES = 2 * 1024 * 1024;

// The two impure edges, injected so the cache behaviour can be tested without a network call
// or the developer's real home directory.
export interface PresetDeps {
  cacheDir?: string;
  fetchImpl?: typeof fetch;
}

async function downloadPreset(file: string, fetchImpl: typeof fetch): Promise<Buffer | null> {
  const url = `${SOUND_PRESET_BASE_URL}${file}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetchImpl(url, { signal: controller.signal });
    if (!res.ok) {
      console.warn(`[sound] preset download failed (${res.status}): ${url}`);
      return null;
    }
    const bytes = Buffer.from(await res.arrayBuffer());
    if (bytes.byteLength === 0 || bytes.byteLength > MAX_PRESET_BYTES) {
      console.warn(`[sound] preset rejected (${bytes.byteLength} bytes): ${url}`);
      return null;
    }
    return bytes;
  } catch (err) {
    console.warn(`[sound] preset download failed: ${url} — ${messageOf(err)}`);
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

// Several cells beeping at once must not each download the same file, so an in-flight fetch is
// shared. The entry is dropped when it settles — a failure has to stay retryable.
const inFlight = new Map<string, Promise<Buffer | null>>();

function fetchOnce(cachePath: string, file: string, fetchImpl: typeof fetch): Promise<Buffer | null> {
  const existing = inFlight.get(cachePath);
  if (existing) return existing;
  const pending = (async () => {
    const bytes = await downloadPreset(file, fetchImpl);
    if (bytes) {
      try {
        await writeFileAtomic(cachePath, bytes);
      } catch (err) {
        // Serve what we downloaded anyway — an unwritable cache dir costs a re-download,
        // not the sound.
        console.warn(`[sound] preset cache write failed: ${file} — ${messageOf(err)}`);
      }
    }
    return bytes;
  })();
  inFlight.set(
    cachePath,
    pending.finally(() => inFlight.delete(cachePath)),
  );
  return pending;
}

/** A preset's audio bytes, from the cache or the network. Null for an unknown id or a failed fetch. */
export async function readSoundPreset(id: string, deps: PresetDeps = {}): Promise<Buffer | null> {
  const preset = soundPresetById(id);
  if (!preset) return null;
  const cachePath = path.join(deps.cacheDir ?? SOUNDS_DIR, preset.file);
  try {
    if (statSync(cachePath).isFile()) return await readFile(cachePath);
  } catch {
    // Absent, or gone between the stat and the read (a manual clear, a concurrent write) —
    // fall through and fetch it again. The check and the read are inside ONE try on purpose:
    // splitting them lets a file that vanishes in between throw out of here, and the caller
    // would answer 500 rather than quietly re-downloading.
  }
  return fetchOnce(cachePath, preset.file, deps.fetchImpl ?? fetch);
}
