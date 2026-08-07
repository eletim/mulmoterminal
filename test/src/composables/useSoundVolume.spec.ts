// @vitest-environment node
import { describe, it, expect } from "vitest";
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
