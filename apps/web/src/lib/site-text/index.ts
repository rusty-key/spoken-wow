import "server-only";

import { cache } from "react";

import type { BuiltinLang, Lang } from "@/lib/lang";

import { EN, type SiteText } from "./en";

import { merge } from "./merge";
import type { Dictionary } from "./types";

export type { SiteText } from "./en";

const LOADERS: Record<Exclude<BuiltinLang, "enUS">, () => Promise<{ default: Dictionary }>> = {
  deDE: () => import("./deDE"),
  esES: () => import("./esES"),
  esMX: () => import("./esMX"),
  frFR: () => import("./frFR"),
  ptBR: () => import("./ptBR"),
  ruRU: () => import("./ruRU"),
  koKR: () => import("./koKR"),
  zhCN: () => import("./zhCN"),
  zhTW: () => import("./zhTW"),
};

/**
 * The front page's words in a language. Every language a game client runs in has a dictionary; a team's
 * language reads English, as does any string not yet translated.
 */
export const siteText = cache(async (lang: Lang): Promise<SiteText> => {
  const load = Object.hasOwn(LOADERS, lang) ? LOADERS[lang as keyof typeof LOADERS] : undefined;
  return load ? merge(EN, (await load()).default) : EN;
});
