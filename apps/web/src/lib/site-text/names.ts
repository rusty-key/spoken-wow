import type { Lang } from "@/lib/lang";

/**
 * Each language's name in that language, which is how a reader looks for theirs in a list.
 * The English names in LOCALES stay what the API and the admin pages show.
 */
export const NATIVE_NAMES: Record<Lang, string> = {
  enUS: "English",
  deDE: "Deutsch",
  esES: "Español (España)",
  esMX: "Español (Latinoamérica)",
  frFR: "Français",
  itIT: "Italiano",
  plPL: "Polski",
  ptBR: "Português (Brasil)",
  ruRU: "Русский",
  koKR: "한국어",
  zhCN: "简体中文",
  zhTW: "繁體中文",
  viVN: "Tiếng Việt",
};

/**
 * The languages the front page is written in, which are the ones with a dictionary beside this file (and
 * English). The front page's language select offers only these: any other would show English words under
 * its name. A new dictionary goes here and in the loaders of index.ts.
 */
export const FRONT_PAGE_LANGS: readonly Lang[] = [
  "enUS", "deDE", "esES", "esMX", "frFR", "itIT", "ptBR", "ruRU", "koKR", "zhCN", "zhTW", "viVN",
];

export function nativeName(lang: Lang): string {
  return NATIVE_NAMES[lang];
}
