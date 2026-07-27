import { describe, it, expect } from "vitest";
import { SOUND_PRESETS, SOUND_PRESET_BASE_URL, parsePresetRef, presetRef, soundPresetById } from "../../common/notifySounds.js";

describe("sound presets", () => {
  it("round-trips a preset id through its reference form", () => {
    for (const preset of SOUND_PRESETS) expect(parsePresetRef(presetRef(preset.id))).toBe(preset.id);
  });

  it("rejects a reference to a preset that does not exist", () => {
    expect(parsePresetRef("preset:nope")).toBeNull();
    expect(parsePresetRef("preset:")).toBeNull();
  });

  // The other arm of a sound value is a file path, and it must not be mistaken for a preset —
  // a path that merely CONTAINS "preset:" still isn't one, because the prefix has to start it.
  it("treats a path as a path", () => {
    expect(parsePresetRef("/Users/me/preset:coin.mp3")).toBeNull();
    expect(parsePresetRef("/Users/me/sounds/coin.mp3")).toBeNull();
    expect(parsePresetRef("")).toBeNull();
  });

  it("has unique ids and unique files", () => {
    expect(new Set(SOUND_PRESETS.map((p) => p.id)).size).toBe(SOUND_PRESETS.length);
    expect(new Set(SOUND_PRESETS.map((p) => p.file)).size).toBe(SOUND_PRESETS.length);
  });

  it("looks a preset up by id", () => {
    expect(soundPresetById("coin")?.file).toBe("sound_coin.mp3");
    expect(soundPresetById("nope")).toBeNull();
  });

  // Pinned to a commit, not a branch — otherwise the bytes behind a cached preset could change
  // and a user who picked "coin" would get something else on a machine that hadn't cached it.
  it("fetches from a pinned commit", () => {
    expect(SOUND_PRESET_BASE_URL).toMatch(/\/[0-9a-f]{40}\/public\/$/);
  });
});
