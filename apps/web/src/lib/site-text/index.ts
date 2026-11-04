import "server-only";

import type { Lang } from "@/lib/lang";

import { EN, type SiteText } from "./en";

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

function merge<T>(base: T, over: unknown): T {
  if (over === undefined || over === null) return base;
  if (Array.isArray(base)) return (Array.isArray(over) ? over.map((item, i) => merge(base[i], item)) : base) as T;
  if (typeof base === "object" && base !== null) {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(base)) out[key] = merge((base as Record<string, unknown>)[key], (over as Record<string, unknown>)[key]);
    return out as T;
  }
  return (typeof over === typeof base ? over : base) as T;
}

/** The front page's words in a language. English is the fallback for any string not yet translated. */
export async function siteText(lang: Lang): Promise<SiteText> {
  const load = LOADERS[lang];
  if (!load) return EN as SiteText;
  return merge(EN as SiteText, (await load()).default);
}
