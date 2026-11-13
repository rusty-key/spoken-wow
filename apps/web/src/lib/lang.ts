/**
 * Which language a page, a query or a take is in.
 *
 * CLIENT-SAFE: the header's switcher and every URL builder need the list as a value, and
 * the layout hands it to the browser. The thirteen built-ins are code; any other language is a
 * row of the `language` table, registered here at boot and on every change (languages/catalogue.ts).
 * The URL rewrites do not use it: they match a build-time list of page sections, and the layout
 * validates the prefix. Whether a language is switched ON is a different question with a different
 * answer at runtime, and is asked on the server.
 *
 * THE SAME LIST AS pipelines/lib/locales.mjs, restated here as a literal so the type of a
 * built-in code is the thirteen codes rather than `string`. lang.test.ts fails if the two drift, the way
 * pipelines/places/tools/validate.mjs guards the addon's copy.
 *
 * It was here before as lib/places/lang.ts, and went when zones lost its language axis in
 * 4939d3f because nothing had been translated. It comes back for all three sections at once.
 */
export type LanguageInfo = {
  code: string;
  name: string;
  native: string;
  bcp47: string;
  /** The code the speech provider takes as language_code. */
  provider: string;
  client: boolean;
};

/** The thirteen languages the site ships with. Never overwritten or removed by registration. */
export const BUILTIN = [
  { code: "enUS", name: "English", native: "English", bcp47: "en-US", provider: "en", client: true },
  { code: "deDE", name: "German", native: "Deutsch", bcp47: "de-DE", provider: "de", client: true },
  { code: "esES", name: "Spanish (EU)", native: "Español (EU)", bcp47: "es-ES", provider: "es", client: true },
  { code: "esMX", name: "Spanish (AL)", native: "Español (AL)", bcp47: "es-MX", provider: "es", client: true },
  { code: "frFR", name: "French", native: "Français", bcp47: "fr-FR", provider: "fr", client: true },
  { code: "itIT", name: "Italian", native: "Italiano", bcp47: "it-IT", provider: "it", client: false },
  { code: "plPL", name: "Polish", native: "Polski", bcp47: "pl-PL", provider: "pl", client: false },
  { code: "ptBR", name: "Portuguese", native: "Português", bcp47: "pt-BR", provider: "pt", client: true },
  { code: "ruRU", name: "Russian", native: "Русский", bcp47: "ru-RU", provider: "ru", client: true },
  { code: "koKR", name: "Korean", native: "한국어", bcp47: "ko-KR", provider: "ko", client: true },
  { code: "zhCN", name: "Chinese (S)", native: "简体中文", bcp47: "zh-CN", provider: "zh", client: true },
  { code: "zhTW", name: "Chinese (T)", native: "繁體中文", bcp47: "zh-TW", provider: "zh", client: true },
  { code: "viVN", name: "Vietnamese", native: "Tiếng Việt", bcp47: "vi-VN", provider: "vi", client: false },
] as const satisfies readonly LanguageInfo[];

/** What a language code looks like: two lowercase letters, two uppercase (enUS). A regex source, for the redirects and the validators. */
export const LANG_SHAPE = "[a-z]{2}[A-Z]{2}";

/** The BCP 47 tag and provider code a language code implies: jaJP -> ja-JP, ja. */
export function derivedTags(code: string): { bcp47: string; provider: string } {
  return { bcp47: `${code.slice(0, 2)}-${code.slice(2)}`, provider: code.slice(0, 2) };
}

export type BuiltinLang = (typeof BUILTIN)[number]["code"];

/** A built-in code gets completion; any other string is a language registered at runtime. */
export type Lang = BuiltinLang | (string & {});

const builtinByCode = new Map<string, LanguageInfo>(BUILTIN.map((locale) => [locale.code, locale]));

/**
 * On globalThis because Next loads this module once per bundle layer: the registry the server
 * fills at boot (instrumentation.ts) must be the one a route handler or a page reads. In the
 * browser it is the window's.
 */
const registryKey = Symbol.for("spoken.languages");
/** `langs` and `extrasList` are the sorted lists, built once per registration. */
type Registry = { extras: Map<string, LanguageInfo>; langs?: readonly Lang[]; extrasList?: readonly LanguageInfo[] };
type RegistryHolder = { [registryKey]?: Registry };
const registry: Registry = ((globalThis as RegistryHolder)[registryKey] ??= { extras: new Map() });

/** Replaces the languages beyond the built-in ones. A built-in's code in the list is ignored. */
export function registerLanguages(list: readonly LanguageInfo[]): void {
  registry.extras = new Map(list.filter((info) => !builtinByCode.has(info.code)).map((info) => [info.code, info]));
  registry.langs = undefined;
  registry.extrasList = undefined;
}

/** The registered languages beyond the built-in ones: all a client needs, since it has the rest. */
export function registeredExtras(): readonly LanguageInfo[] {
  return (registry.extrasList ??= [...registry.extras.values()].sort((a, b) => a.code.localeCompare(b.code)));
}

/** Built-ins in their order, then the registered ones by code. */
export function allLangs(): readonly Lang[] {
  return (registry.langs ??= [...BUILTIN.map((locale) => locale.code), ...[...registry.extras.keys()].sort()]);
}

export function languageInfo(lang: string): LanguageInfo | null {
  return builtinByCode.get(lang) ?? registry.extras.get(lang) ?? null;
}

/**
 * English: what every other language is translated from, what line ids and file names are
 * derived from, and what a bare URL means.
 */
export const BASE_LANG: Lang = "enUS";

export function isLang(value: unknown): value is Lang {
  return typeof value === "string" && languageInfo(value) !== null;
}

/**
 * Whether a game client runs in this language. Italian and Vietnamese are translated by a
 * community and chosen by a player in the addons; no client ever reports it, so nothing that comes from a
 * client -- a contribution above all -- is in it. See `client` in pipelines/lib/locales.mjs.
 */
export function isClientLang(lang: Lang): boolean {
  return languageInfo(lang)?.client !== false;
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
  return languageInfo(lang)?.name ?? lang;
}

/** Every language but English with its name, for a picker of the languages a team can have. */
export function languageOptions(): { code: Lang; name: string }[] {
  return allLangs()
    .filter((code) => code !== BASE_LANG)
    .map((code) => ({ code, name: langName(code) }));
}

/** The ISO 639-1 code a synthesis request in this language sends as language_code. */
export function elevenLabsCode(lang: Lang): string {
  return languageInfo(lang)?.provider ?? "en";
}

export function langTag(lang: Lang): string {
  return languageInfo(lang)?.bcp47 ?? "en-US";
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
