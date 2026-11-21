import { languageInfo, type Lang } from "@/lib/lang";

/**
 * The languages the front page is written in. The front page's language select offers only these: any
 * other would show English words under its name. Italian, Vietnamese and any other team's language are
 * not here: their text is their team's, not the project's.
 */
export const FRONT_PAGE_LANGS = [
  "enUS", "deDE", "esES", "esMX", "frFR", "ptBR", "ruRU", "koKR", "zhCN", "zhTW",
] as const;

export type FrontPageLang = (typeof FRONT_PAGE_LANGS)[number];

export function isFrontPageLang(lang: Lang): lang is FrontPageLang {
  return (FRONT_PAGE_LANGS as readonly string[]).includes(lang);
}

/** A language's name in that language, which is how a reader looks for theirs in a list. */
export function nativeName(lang: Lang): string {
  return languageInfo(lang)?.native ?? lang;
}
