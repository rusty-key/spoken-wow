// The languages this project knows about, for every half of it: the places and readables
// pipelines and the site (apps/web/src/lib/lang.ts). What a language IS lives here; what
// one section does with it -- the folder a places pack ships in, say -- lives with that
// section.
//
// The languages here that a client runs in must stay in step with the addons' built-in list
// (Languages.BUILTIN in addons/Spoken/Languages.lua); pipelines/places/tools/validate.mjs fails
// the build if they drift, and apps/web/src/lib/lang.test.ts does the same for the site.
//
// The ten languages a Classic-family client runs in: the project's own. A language a team brings
// to the site, one no client runs in, lives in the database `language` table alone, not here.

export const BASE_LOCALE = "enUS";

// `script` is what a client's fonts must be able to draw -- the addon uses it to
// hide a language a player's client would render as boxes.
//
// `elevenLabs` is the language_code sent with a synthesis request: ISO 639-1, which
// is what the multilingual models take. It names the language, not the region, so
// both Spanishes say "es" and both Chineses say "zh" -- the voice picked for each
// carries the accent. Sent so a short line does not leave the model to guess the
// language from a handful of proper nouns.
//
// `bcp47` is what a page in the language declares in <html lang>, so a screen reader and a
// browser's translate prompt know what they are looking at.
//
// `vmangos` is the N in the world database's *_locN columns. 1 to 8 are vmangos's own; 9 is
// Portuguese, which 1.12 never shipped and the Classic Era client does -- a fresh dump has no
// *_loc9 column, and pipelines/quests/tools/fill_locales_from_tdb.py adds and fills it. Null is
// a language the world database has no text for at all.
//
// isClientLocale is false for a team's language: GetLocale() never returns it, so nothing keyed by
// what the client shows (aliases, gossip locale text, a page index) is built for it.
export const LOCALES = [
  { code: "enUS", name: "English", script: "latin", elevenLabs: "en", bcp47: "en-US", vmangos: 0 },
  { code: "deDE", name: "German", script: "latin", elevenLabs: "de", bcp47: "de-DE", vmangos: 3 },
  { code: "esES", name: "Spanish (EU)", script: "latin", elevenLabs: "es", bcp47: "es-ES", vmangos: 6 },
  { code: "esMX", name: "Spanish (AL)", script: "latin", elevenLabs: "es", bcp47: "es-MX", vmangos: 7 },
  { code: "frFR", name: "French", script: "latin", elevenLabs: "fr", bcp47: "fr-FR", vmangos: 2 },
  { code: "ptBR", name: "Portuguese", script: "latin", elevenLabs: "pt", bcp47: "pt-BR", vmangos: 9 },
  { code: "ruRU", name: "Russian", script: "cyrillic", elevenLabs: "ru", bcp47: "ru-RU", vmangos: 8 },
  { code: "koKR", name: "Korean", script: "korean", elevenLabs: "ko", bcp47: "ko-KR", vmangos: 1 },
  { code: "zhCN", name: "Chinese (S)", script: "simplifiedchinese", elevenLabs: "zh", bcp47: "zh-CN", vmangos: 4 },
  { code: "zhTW", name: "Chinese (T)", script: "traditionalchinese", elevenLabs: "zh", bcp47: "zh-TW", vmangos: 5 },
];

export const CODES = LOCALES.map((l) => l.code);

export function localeInfo(code) {
  return LOCALES.find((l) => l.code === code) || null;
}

export function isLocale(code) {
  return CODES.includes(code);
}

/** Whether a game client runs in this language. */
export function isClientLocale(code) {
  return isLocale(code);
}

/** The language_code a synthesis request for this language sends. */
export function elevenLabsCode(locale) {
  return localeInfo(locale)?.elevenLabs ?? null;
}
