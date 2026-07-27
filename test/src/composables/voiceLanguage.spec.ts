import { describe, it, expect, vi, afterEach } from "vitest";
import { VOICE_LANGUAGES, browserVoiceLanguage, parseVoiceLanguage, resolveVoiceLanguage } from "../../../src/composables/voiceLanguage";
import { browserLocale } from "../../../src/utils/browserLocale";

describe("parseVoiceLanguage", () => {
  it("defaults to the browser's language when nothing is stored", () => {
    expect(parseVoiceLanguage(null)).toBe("locale");
  });

  it("reads back an explicit detect choice", () => {
    expect(parseVoiceLanguage("auto")).toBe("auto");
  });

  it("reads back every offered language", () => {
    for (const lang of VOICE_LANGUAGES) expect(parseVoiceLanguage(lang.code)).toBe(lang.code);
  });

  // An unrecognized code must not reach whisper as a language token: it would be accepted by
  // the route's length check and then mistranscribe every clip.
  it("falls back to the default for a code that is not offered", () => {
    expect(parseVoiceLanguage("xx")).toBe("locale");
    expect(parseVoiceLanguage("")).toBe("locale");
  });
});

describe("resolveVoiceLanguage", () => {
  // The default must stay bit-for-bit what it always was: whatever the browser locale maps to
  // is what whisper is told, translation quirk included.
  it("uses the locale's language on the default setting", () => {
    expect(resolveVoiceLanguage("locale", "en")).toBe("en");
    expect(resolveVoiceLanguage("locale", "ja")).toBe("ja");
  });

  it("passes the locale's own fallback through untouched", () => {
    expect(resolveVoiceLanguage("locale", "auto")).toBe("auto");
  });

  it("sends the picked language whatever the browser locale is", () => {
    expect(resolveVoiceLanguage("ja", "en")).toBe("ja");
    expect(resolveVoiceLanguage("en", "ja")).toBe("en");
  });

  it("asks whisper to detect on the auto setting", () => {
    expect(resolveVoiceLanguage("auto", "en")).toBe("auto");
  });
});

describe("browserVoiceLanguage", () => {
  it("maps the locales core's table already knows", () => {
    expect(browserVoiceLanguage("ja")).toBe("ja");
    expect(browserVoiceLanguage("en")).toBe("en");
    expect(browserVoiceLanguage("de")).toBe("de");
  });

  // Core keys Portuguese as `pt-BR` — its only region-qualified entry — while every caller
  // hands it a region-stripped tag, so `pt` missed the table and Portuguese speakers got
  // detection under a setting labelled "My browser's language".
  it("recovers Portuguese, which core's table only lists region-qualified", () => {
    expect(browserVoiceLanguage("pt")).toBe("pt");
  });

  it("still detects for a locale nobody offers", () => {
    expect(browserVoiceLanguage("ru")).toBe("auto");
    expect(browserVoiceLanguage("")).toBe("auto");
  });

  // The bug lived in the composition, not in either half: browserLocale drops the region,
  // then the table is keyed with one. Pin the pair end to end.
  describe("composed with browserLocale", () => {
    const withLanguage = (language: string) => vi.spyOn(navigator, "language", "get").mockReturnValue(language);
    afterEach(() => vi.restoreAllMocks());

    it.each([
      ["ja-JP", "ja"],
      ["en-US", "en"],
      ["pt-BR", "pt"],
      ["pt-PT", "pt"],
      ["zh-Hant-TW", "zh"],
      ["ru-RU", "auto"],
    ])("%s dictates as %s", (navigatorLanguage, expected) => {
      withLanguage(navigatorLanguage);
      expect(browserVoiceLanguage(browserLocale())).toBe(expected);
    });
  });
});
