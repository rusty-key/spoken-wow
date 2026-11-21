import { languageInfo, type Lang } from "@/lib/lang";

/** A language's name in that language, which is how a reader looks for theirs in a list. */
export function nativeName(lang: Lang): string {
  return languageInfo(lang)?.native ?? lang;
}
