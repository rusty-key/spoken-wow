import { BASE_LANG, isClientLang, type Lang } from "@/lib/lang";

/**
 * English has no names to review: its names are the corpus's. Nor does a language no client runs in.
 * Kept out of a server-only module: the contributions tabs call it on the client.
 */
export function hasObservedNames(lang: Lang): boolean {
  return lang !== BASE_LANG && isClientLang(lang);
}
