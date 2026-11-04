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
  ptBR: "Português (Brasil)",
  ruRU: "Русский",
  koKR: "한국어",
  zhCN: "简体中文",
  zhTW: "繁體中文",
  viVN: "Tiếng Việt",
};

export function nativeName(lang: Lang): string {
  return NATIVE_NAMES[lang];
}
