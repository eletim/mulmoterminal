import { describe, it, expect } from "vitest";
import { globalSoundValue, soundSources, type SoundConfig } from "../../../src/composables/useAttentionSound";

const config = (over: Partial<SoundConfig> = {}): SoundConfig => ({
  kinds: ["finished", "waiting"],
  sounds: {},
  soundFile: null,
  ...over,
});

describe("globalSoundValue", () => {
  it("prefers the kind's own sound over the all-kind file", () => {
    const c = config({ sounds: { waiting: "preset:coin" }, soundFile: "/abs/fallback.mp3" });
    expect(globalSoundValue("waiting", c)).toBe("preset:coin");
    expect(globalSoundValue("finished", c)).toBe("/abs/fallback.mp3");
  });

  it("is null when neither is configured — the chime's cue", () => {
    expect(globalSoundValue("finished", config())).toBeNull();
  });
});

describe("soundSources", () => {
  // The order IS the feature: a directory's own sound is what makes one project distinguishable
  // from another, so it has to be tried before the user's global choice.
  it("puts the session directory ahead of the global sound", () => {
    const sources = soundSources("finished", "/repo/app", config({ soundFile: "/abs/fallback.mp3" }));
    expect(sources.map((s) => s.url)).toEqual(["/api/dir-sound?cwd=%2Frepo%2Fapp&kind=finished", "/api/sound?kind=finished&v=%2Fabs%2Ffallback.mp3"]);
  });

  it("asks for nothing global when no sound is configured", () => {
    expect(soundSources("finished", null, config())).toEqual([]);
  });

  it("still asks the directory when the user configured no global sound", () => {
    const sources = soundSources("waiting", "/repo/app", config());
    expect(sources).toHaveLength(1);
    expect(sources[0].url).toBe("/api/dir-sound?cwd=%2Frepo%2Fapp&kind=waiting");
  });

  // The cache key has to change with the CONFIGURED VALUE, or picking a different sound would
  // keep replaying the decoded buffer of the old one.
  it("keys the global source on the chosen sound", () => {
    const coin = soundSources("finished", null, config({ sounds: { finished: "preset:coin" } }))[0].key;
    const gong = soundSources("finished", null, config({ sounds: { finished: "preset:gong" } }))[0].key;
    expect(coin).not.toBe(gong);
  });

  it("keys each kind separately, so two kinds sharing a file still cache apart", () => {
    const c = config({ soundFile: "/abs/one.mp3" });
    expect(soundSources("finished", null, c)[0].key).not.toBe(soundSources("waiting", null, c)[0].key);
  });

  it("escapes a directory containing characters the query would otherwise break on", () => {
    const [dir] = soundSources("finished", "/repo/a b&c", config());
    expect(dir.url).toBe("/api/dir-sound?cwd=%2Frepo%2Fa%20b%26c&kind=finished");
  });
});
