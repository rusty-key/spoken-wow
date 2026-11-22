import "server-only";

import { cache } from "react";

import type { Lang } from "@/lib/lang";

import { merge } from "@/lib/site-text/merge";
import type { DeepPartial } from "@/lib/site-text/types";

import { EN, type UiText } from "./en";

/**
 * Backstage's words in one language, as readingLang picks it.
 *
 * A dictionary covers as much as its team wants; whatever it leaves out reads English. That is
 * unlike lib/site-text, whose dictionaries must be complete: a player reading the front page in
 * their language should never meet a stray English sentence, while a volunteer who wants a
 * Chinese interface is helped by one even while it is half done.
 */
const LOADERS: Record<string, () => Promise<{ default: Dictionary }>> = {
  deDE: () => import("./deDE"),
  esES: () => import("./esES"),
  esMX: () => import("./esMX"),
  frFR: () => import("./frFR"),
  koKR: () => import("./koKR"),
  ptBR: () => import("./ptBR"),
  ruRU: () => import("./ruRU"),
  zhCN: () => import("./zhCN"),
  zhTW: () => import("./zhTW"),
};

/** A language's file: whatever it has translated, over English for what it has not. */
export type Dictionary = DeepPartial<UiText>;

/** Cached per render: the layout and every page under it ask for the same language. */
export const uiText = cache(async (lang: Lang): Promise<UiText> => {
  const load = Object.hasOwn(LOADERS, lang) ? LOADERS[lang] : undefined;
  return load ? merge(EN, (await load()).default) : EN;
});
