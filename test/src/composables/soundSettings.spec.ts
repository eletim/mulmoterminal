// @vitest-environment node
import { describe, it, expect } from "vitest";
import { customSoundLabel, isCustomSound, readSoundMap, toggledKinds, withKindSound, type SoundMap } from "../../../src/composables/soundSettings";
import { NOTIFY_KINDS } from "../../../common/notifyKinds";

// The map is persisted WHOLE on every change, so anything dropped here is a setting the user
// silently loses. That is why these are pure and tested without mounting anything.

describe("withKindSound", () => {
  it("sets the kind it is given and leaves the others alone", () => {
    const before: SoundMap = { finished: "preset:coin" };
    expect(withKindSound(before, "waiting", "preset:gong")).toEqual({ finished: "preset:coin", waiting: "preset:gong" });
  });

  // "" is the picker's "Default" row, and the fallback is the ABSENCE of an entry — storing an
  // empty string would resolve to no sound at all rather than to the fallback.
  it("removes the entry when the value is empty", () => {
    expect(withKindSound({ finished: "preset:coin", waiting: "preset:gong" }, "finished", "")).toEqual({ waiting: "preset:gong" });
    expect(withKindSound({ finished: "preset:coin" }, "finished", "")).toEqual({});
  });

  it("does not mutate the map it was given", () => {
    const before: SoundMap = { finished: "preset:coin" };
    withKindSound(before, "waiting", "preset:gong");
    expect(before).toEqual({ finished: "preset:coin" });
  });

  // The regression Codex caught: two picks made before the first save answers must compound,
  // not each start from the same snapshot. Passing the PREVIOUS RESULT is what the component
  // now does, and this is the property that makes it correct.
  it("compounds across back-to-back edits", () => {
    const first = withKindSound({}, "finished", "preset:coin");
    const second = withKindSound(first, "waiting", "preset:meow");
    expect(second).toEqual({ finished: "preset:coin", waiting: "preset:meow" });
  });

  it("keeps a value the picker has no option for (a hand-configured path)", () => {
    const before: SoundMap = { finished: "/abs/mine.mp3" };
    expect(withKindSound(before, "waiting", "preset:coin")).toEqual({ finished: "/abs/mine.mp3", waiting: "preset:coin" });
  });

  it("drops a key that is not a known kind", () => {
    const before = { finished: "preset:coin", bogus: "preset:gong" } as SoundMap;
    expect(withKindSound(before, "waiting", "preset:meow")).toEqual({ finished: "preset:coin", waiting: "preset:meow" });
  });

  it("emits keys in NOTIFY_KINDS order, so the saved file is stable", () => {
    const built = withKindSound({ "pr-ci-failed": "preset:gong", finished: "preset:coin" }, "waiting", "preset:meow");
    expect(Object.keys(built)).toEqual(NOTIFY_KINDS.filter((k) => k in built));
  });
});

describe("toggledKinds", () => {
  it("adds and removes", () => {
    expect(toggledKinds(["finished"], "waiting")).toEqual(["finished", "waiting"]);
    expect(toggledKinds(["finished", "waiting"], "finished")).toEqual(["waiting"]);
  });

  it("returns NOTIFY_KINDS order however it was clicked", () => {
    expect(toggledKinds(["pr-ci-failed"], "finished")).toEqual(["finished", "pr-ci-failed"]);
  });

  it("can empty the list — that is the user asking for silence", () => {
    expect(toggledKinds(["finished"], "finished")).toEqual([]);
  });

  it("does not mutate its input", () => {
    const before = ["finished"] as const;
    toggledKinds(before, "waiting");
    expect(before).toEqual(["finished"]);
  });
});

describe("isCustomSound / customSoundLabel", () => {
  it("tells a preset from the user's own file", () => {
    expect(isCustomSound("preset:coin")).toBe(false);
    expect(isCustomSound("/Users/me/alert.mp3")).toBe(true);
    expect(isCustomSound("")).toBe(false);
    // An unknown preset id is not a preset, so it is shown as-is rather than silently dropped.
    expect(isCustomSound("preset:nope")).toBe(true);
  });

  it("labels a file by its basename, on either separator", () => {
    expect(customSoundLabel("/Users/me/sounds/alert.mp3")).toBe("Your file — alert.mp3");
    expect(customSoundLabel("C:\\Users\\me\\alert.mp3")).toBe("Your file — alert.mp3");
    expect(customSoundLabel("alert.mp3")).toBe("Your file — alert.mp3");
  });
});

describe("readSoundMap", () => {
  it("keeps known kinds with a string value", () => {
    expect(readSoundMap({ finished: "preset:coin", waiting: "/abs/x.mp3" })).toEqual({ finished: "preset:coin", waiting: "/abs/x.mp3" });
  });

  it("drops unknown keys and unusable values", () => {
    expect(readSoundMap({ finished: "preset:coin", bogus: "preset:gong", waiting: "", "command-done": 7, "pr-ci-failed": null })).toEqual({
      finished: "preset:coin",
    });
  });

  it("answers an empty response with an empty map", () => {
    expect(readSoundMap({})).toEqual({});
  });
});
