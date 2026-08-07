// @vitest-environment node
import { describe, it, expect, vi } from "vitest";
import { clampSoundVolumePercent, DEFAULT_SOUND_VOLUME_PERCENT, readSoundVolumePercent, soundVolumeScale } from "../../../src/composables/useSoundVolume";

describe("readSoundVolumePercent", () => {
  it("accepts saved browser percentages in the 0-100 range", () => {
    expect(readSoundVolumePercent("0")).toBe(0);
    expect(readSoundVolumePercent("42")).toBe(42);
    expect(readSoundVolumePercent("100")).toBe(100);
  });

  it("falls back for malformed or out-of-range saved values", () => {
    for (const raw of [null, undefined, "", "loud", "-1", "101", "Infinity"]) {
      expect(readSoundVolumePercent(raw)).toBe(DEFAULT_SOUND_VOLUME_PERCENT);
    }
  });
});

describe("clampSoundVolumePercent / soundVolumeScale", () => {
  it("clamps live UI values into the slider range", () => {
    expect(clampSoundVolumePercent(-10)).toBe(0);
    expect(clampSoundVolumePercent(40.4)).toBe(40);
    expect(clampSoundVolumePercent(140)).toBe(100);
  });

  it("turns percent into the playback multiplier", () => {
    expect(soundVolumeScale(0)).toBe(0);
    expect(soundVolumeScale(50)).toBe(0.5);
    expect(soundVolumeScale(100)).toBe(1);
  });
});

describe("useSoundVolume storage fallback", () => {
  it("falls back when the browser denies localStorage access during import", async () => {
    vi.resetModules();
    const original = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      get() {
        throw new Error("storage denied");
      },
    });

    try {
      const { useSoundVolume } = await import("../../../src/composables/useSoundVolume");
      expect(useSoundVolume().volume.value).toBe(DEFAULT_SOUND_VOLUME_PERCENT);
    } finally {
      if (original) Object.defineProperty(globalThis, "localStorage", original);
      else Reflect.deleteProperty(globalThis, "localStorage");
      vi.resetModules();
    }
  });

  it("keeps the in-memory volume when localStorage writes throw", async () => {
    vi.resetModules();
    const original = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: {
        getItem: () => "30",
        setItem: () => {
          throw new Error("quota denied");
        },
      },
    });

    try {
      const { useSoundVolume } = await import("../../../src/composables/useSoundVolume");
      const soundVolume = useSoundVolume();
      expect(soundVolume.volume.value).toBe(30);
      soundVolume.setVolume(20);
      await Promise.resolve();
      expect(soundVolume.volume.value).toBe(20);
    } finally {
      if (original) Object.defineProperty(globalThis, "localStorage", original);
      else Reflect.deleteProperty(globalThis, "localStorage");
      vi.resetModules();
    }
  });
});
