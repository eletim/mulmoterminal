import { ref, watch } from "vue";
import { localeToWhisperLanguage } from "@mulmoclaude/core/whisper/client";

// Which language voice input tells whisper to expect.
//
//   locale   — the browser's language (the default, and what this has always done)
//   auto     — let whisper detect it from the audio
//   <code>   — a language you picked, whatever the browser is set to
//
// The setting exists because forcing a language whisper does NOT hear is not a no-op:
// given `language=en` and Japanese speech, the multilingual model emits an English
// *translation* rather than a Japanese transcript. Saying which language you are about
// to speak is both the fix for that and better than detection — per-segment detection
// can guess wrong on a short or noisy clip, and a wrong guess costs you the same
// translation you were trying to avoid.
//
// Per-browser (localStorage), like the terminal font size and the attention sound: the
// mic and the language it hears belong to the device you are speaking into, not to the
// server's config.
const STORAGE_KEY = "voice_language";

/** The languages offered in the picker. Deliberately the set the app already recognizes
 *  as UI locales rather than whisper's full ~99 — every extra row is one more thing to
 *  scroll past, and the codes are plain ISO-639-1, so adding one here is a one-line
 *  change if someone needs it. */
export const VOICE_LANGUAGES = [
  { code: "en", label: "English" },
  { code: "ja", label: "Japanese" },
  { code: "zh", label: "Chinese" },
  { code: "ko", label: "Korean" },
  { code: "es", label: "Spanish" },
  { code: "pt", label: "Portuguese" },
  { code: "fr", label: "French" },
  { code: "de", label: "German" },
] as const;

export const VOICE_LANGUAGE_LOCALE = "locale";
export const VOICE_LANGUAGE_AUTO = "auto";

export type VoiceLanguageCode = (typeof VOICE_LANGUAGES)[number]["code"];
export type VoiceLanguage = typeof VOICE_LANGUAGE_LOCALE | typeof VOICE_LANGUAGE_AUTO | VoiceLanguageCode;

export function isVoiceLanguageCode(raw: string): raw is VoiceLanguageCode {
  return VOICE_LANGUAGES.some((l) => l.code === raw);
}

/** Stored values are validated on the way in, not trusted: an unknown code would otherwise
 *  reach whisper as a language token and quietly mistranscribe every clip. The union type
 *  keeps this code from writing a bad value; it says nothing about what is already on disk. */
export function parseVoiceLanguage(raw: string | null): VoiceLanguage {
  if (raw === VOICE_LANGUAGE_AUTO) return VOICE_LANGUAGE_AUTO;
  if (raw && isVoiceLanguageCode(raw)) return raw;
  return VOICE_LANGUAGE_LOCALE;
}

/** The browser locale as a whisper language code.
 *
 *  `browserLocale()` drops the region (`en-GB` and `en-US` want one translation bundle),
 *  but core's table keys Portuguese as `pt-BR` — its only region-qualified entry — so a
 *  bare `pt` misses it and every Portuguese browser silently falls through to detection.
 *  Where core gives up, take the locale itself if the picker offers it, so the same gap in
 *  a future entry is covered too. */
export function browserVoiceLanguage(locale: string): string {
  const mapped = localeToWhisperLanguage(locale);
  if (mapped !== VOICE_LANGUAGE_AUTO) return mapped;
  return isVoiceLanguageCode(locale) ? locale : VOICE_LANGUAGE_AUTO;
}

/** The `language` value for `/api/transcribe`. `localeLanguage` is the browser locale
 *  already mapped to a whisper code, so this stays free of the locale table. */
export function resolveVoiceLanguage(setting: VoiceLanguage, localeLanguage: string): string {
  return setting === VOICE_LANGUAGE_LOCALE ? localeLanguage : setting;
}

/** A singleton so the settings modal and every terminal's mic read the same value; the
 *  language is re-read per audio segment, so a change applies without restarting. */
export const voiceLanguage = ref<VoiceLanguage>(parseVoiceLanguage(localStorage.getItem(STORAGE_KEY)));
watch(voiceLanguage, (setting) => localStorage.setItem(STORAGE_KEY, setting));
