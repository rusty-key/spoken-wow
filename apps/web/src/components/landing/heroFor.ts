import "server-only";

import { cache } from "react";

import type { Lang } from "@/lib/lang";

import type { HeroLineData } from "./HeroLine";

/** One file per language, written by apps/web/scripts/landing-voices.py. */
const LOADERS: Partial<Record<Lang, () => Promise<{ default: HeroLineData[] }>>> = {
  enUS: () => import("./hero/enUS.json"),
  deDE: () => import("./hero/deDE.json"),
  esES: () => import("./hero/esES.json"),
  esMX: () => import("./hero/esMX.json"),
  frFR: () => import("./hero/frFR.json"),
  ptBR: () => import("./hero/ptBR.json"),
  ruRU: () => import("./hero/ruRU.json"),
  koKR: () => import("./hero/koKR.json"),
  zhCN: () => import("./hero/zhCN.json"),
  zhTW: () => import("./hero/zhTW.json"),
};

/** The hero's subtitle lines in the page's language. Italian and Vietnamese have no corpus lines yet, so they show English. */
export const heroFor = cache(async (lang: Lang): Promise<HeroLineData[]> => {
  const load = LOADERS[lang] ?? LOADERS.enUS!;
  return (await load()).default;
});
