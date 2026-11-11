import "server-only";

import { cache } from "react";

import type { Lang } from "@/lib/lang";

import { EN, type SiteText } from "./en";

import { merge } from "./merge";
import type { Dictionary } from "./types";

export type { SiteText } from "./en";

const LOADERS: Partial<Record<Lang, () => Promise<{ default: Dictionary }>>> = {
  deDE: () => import("./deDE"),
  esES: () => import("./esES"),
  esMX: () => import("./esMX"),
  frFR: () => import("./frFR"),
  itIT: () => import("./itIT"),
  ptBR: () => import("./ptBR"),
  ruRU: () => import("./ruRU"),
  koKR: () => import("./koKR"),
  zhCN: () => import("./zhCN"),
  zhTW: () => import("./zhTW"),
  viVN: () => import("./viVN"),
};

/** The front page's words in a language. English is the fallback for any string not yet translated. */
export const siteText = cache(async (lang: Lang): Promise<SiteText> => {
  const load = LOADERS[lang];
  if (!load) return EN as SiteText;
  return merge(EN as SiteText, (await load()).default);
});
