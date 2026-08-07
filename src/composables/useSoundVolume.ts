import { ref, watch } from "vue";

const STORAGE_KEY = "sound_volume_percent";
export const DEFAULT_SOUND_VOLUME_PERCENT = 100;

export function readSoundVolumePercent(raw: unknown): number {
  if (typeof raw !== "string" || raw.trim() === "") return DEFAULT_SOUND_VOLUME_PERCENT;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 100) return DEFAULT_SOUND_VOLUME_PERCENT;
  return Math.round(parsed);
}

export function clampSoundVolumePercent(raw: unknown): number {
  let parsed = Number.NaN;
  if (typeof raw === "number") parsed = raw;
  else if (typeof raw === "string") parsed = Number(raw);
  if (!Number.isFinite(parsed)) return DEFAULT_SOUND_VOLUME_PERCENT;
  return Math.min(100, Math.max(0, Math.round(parsed)));
}

export function soundVolumeScale(percent: unknown): number {
  return clampSoundVolumePercent(percent) / 100;
}

function readStoredVolume(): number {
  if (typeof localStorage === "undefined") return DEFAULT_SOUND_VOLUME_PERCENT;
  try {
    return readSoundVolumePercent(localStorage.getItem(STORAGE_KEY));
  } catch {
    return DEFAULT_SOUND_VOLUME_PERCENT;
  }
}

const volume = ref(readStoredVolume());

watch(volume, (v) => {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, String(clampSoundVolumePercent(v)));
  } catch {
    // Storage can be unavailable in hardened browser contexts; the in-memory value still works.
  }
});

export function currentSoundVolumeScale(): number {
  return soundVolumeScale(volume.value);
}

export function useSoundVolume() {
  const setVolume = (next: unknown) => {
    volume.value = clampSoundVolumePercent(next);
  };
  return { volume, setVolume };
}
