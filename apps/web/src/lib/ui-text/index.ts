import "server-only";

import { cache } from "react";

import type { Lang } from "@/lib/lang";

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

export type DeepPartial<T> = T extends readonly (infer U)[]
  ? DeepPartial<U>[]
  : T extends object
    ? { [K in keyof T]?: DeepPartial<T[K]> }
    : T;

/** A language's file: whatever it has translated, over English for what it has not. */
export type Dictionary = DeepPartial<UiText>;

/** `over` laid over `base`: whatever `over` lacks, or has the wrong kind of, stays as `base` has it. */
export function merge<T>(base: T, over: unknown): T {
  if (over === undefined || over === null) return base;
  if (typeof base === "object" && base !== null) {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(base)) out[key] = merge((base as Record<string, unknown>)[key], (over as Record<string, unknown>)[key]);
    return out as T;
  }
  return (typeof over === typeof base ? over : base) as T;
}

/** Cached per render: the layout and every page under it ask for the same language. */
export const uiText = cache(async (lang: Lang): Promise<UiText> => {
  const load = Object.hasOwn(LOADERS, lang) ? LOADERS[lang] : undefined;
  return load ? merge(EN, (await load()).default) : EN;
});
