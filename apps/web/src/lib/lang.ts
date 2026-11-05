/**
 * Which language a page, a query or a take is in.
 *
 * CLIENT-SAFE: the header's switcher and every URL builder need the list as a value, and
 * the URL rewrites validate a URL prefix against it without reaching the database. Whether a
 * language is switched ON is a different question with a different answer at runtime -- the
 * `language` table -- and is asked on the server.
 *
 * THE SAME LIST AS pipelines/lib/locales.mjs, restated here as a literal so the type of a
 * code is the twelve codes rather than `string`. lang.test.ts fails if the two drift, the way
 * pipelines/places/tools/validate.mjs guards the addon's copy.
 *
 * It was here before as lib/places/lang.ts, and went when zones lost its language axis in
 * 4939d3f because nothing had been translated. It comes back for all three sections at once.
 */
export const LOCALES = [
  { code: "enUS", name: "English", bcp47: "en-US", elevenLabs: "en" },
  { code: "deDE", name: "German", bcp47: "de-DE", elevenLabs: "de" },
  { code: "esES", name: "Spanish (EU)", bcp47: "es-ES", elevenLabs: "es" },
  { code: "esMX", name: "Spanish (AL)", bcp47: "es-MX", elevenLabs: "es" },
  { code: "frFR", name: "French", bcp47: "fr-FR", elevenLabs: "fr" },
  { code: "itIT", name: "Italian", bcp47: "it-IT", elevenLabs: "it", client: false },
  { code: "plPL", name: "Polish", bcp47: "pl-PL", elevenLabs: "pl", client: false },
  { code: "ptBR", name: "Portuguese", bcp47: "pt-BR", elevenLabs: "pt" },
  { code: "ruRU", name: "Russian", bcp47: "ru-RU", elevenLabs: "ru" },
  { code: "koKR", name: "Korean", bcp47: "ko-KR", elevenLabs: "ko" },
  { code: "zhCN", name: "Chinese (S)", bcp47: "zh-CN", elevenLabs: "zh" },
  { code: "zhTW", name: "Chinese (T)", bcp47: "zh-TW", elevenLabs: "zh" },
  { code: "viVN", name: "Vietnamese", bcp47: "vi-VN", elevenLabs: "vi", client: false },
] as const;

export type Lang = (typeof LOCALES)[number]["code"];

export const CODES: readonly Lang[] = LOCALES.map((locale) => locale.code);

/**
 * English: what every other language is translated from, what line ids and file names are
 * derived from, and what a bare URL means.
 */
export const BASE_LANG: Lang = "enUS";

export function isLang(value: unknown): value is Lang {
  return typeof value === "string" && (CODES as readonly string[]).includes(value);
}

/**
 * Whether a game client runs in this language. Italian and Vietnamese are translated by a
 * community and chosen by a player in the addons; no client ever reports it, so nothing that comes from a
 * client -- a contribution above all -- is in it. See `client` in pipelines/lib/locales.mjs.
 */
export function isClientLang(lang: Lang): boolean {
  const locale = LOCALES.find((entry) => entry.code === lang);
  return !(locale && "client" in locale && locale.client === false);
}

/**
 * The language a WoW client's GetLocale() stands for, or null for one the site does not know.
 *
 * enGB is the EU English client: the same text and the same English packs as enUS, so a
 * contribution from it is an English one. Anything else must already be one of ours, and one a
 * client runs in: an envelope claiming Italian was not written by the game.
 */
export function clientLang(locale: string): Lang | null {
  if (locale === "enGB") return BASE_LANG;
  return isLang(locale) && isClientLang(locale) ? locale : null;
}

export function langName(lang: Lang): string {
  return LOCALES.find((locale) => locale.code === lang)?.name ?? lang;
}

/** The ISO 639-1 code a synthesis request in this language sends as language_code. */
export function elevenLabsCode(lang: Lang): string {
  return LOCALES.find((locale) => locale.code === lang)?.elevenLabs ?? "en";
}

export function langTag(lang: Lang): string {
  return LOCALES.find((locale) => locale.code === lang)?.bcp47 ?? "en-US";
}

/**
 * A page's address in a language: the bare path for English, `/ptBR/...` for the rest.
 *
 * English keeps the addresses it has always had -- every link already out there, from the
 * addons' Report buttons to a bookmark, is a bare path, and the rewrites (lib/locale-routes.ts)
 * answers one as English. Only a path on this site gets a prefix: an API route is addressed
 * by `?lang=` instead (see withLang), and an external URL is not ours to rewrite.
 */
export function localeHref(lang: Lang, href: string): string {
  if (lang === BASE_LANG || !href.startsWith("/") || href.startsWith("//")) return href;
  if (href.startsWith("/api/") || href === "/api") return href;
  return href === "/" ? `/${lang}` : `/${lang}${href}`;
}

/**
 * The same path without its language, for the switcher: what `/ptBR/quests?q=1` is in
 * any other language. A path with no prefix is already English.
 */
export function stripLang(href: string): { lang: Lang; path: string } {
  const match = href.match(/^\/([a-z]{2}[A-Z]{2})(?=\/|\?|#|$)(.*)$/);
  if (match && isLang(match[1])) {
    const rest = match[2];
    return { lang: match[1], path: rest.startsWith("/") ? rest : `/${rest}` };
  }
  return { lang: BASE_LANG, path: href };
}

/**
 * An API URL asking for a language's rows. English sends no parameter, so every URL the
 * site requested before languages existed is byte for byte what it requests now -- the
 * audio routes' cache entries included.
 */
export function withLang(lang: Lang, url: string): string {
  if (lang === BASE_LANG) return url;
  const [base, hash] = url.split("#", 2);
  const joined = `${base}${base.includes("?") ? "&" : "?"}lang=${lang}`;
  return hash === undefined ? joined : `${joined}#${hash}`;
}
