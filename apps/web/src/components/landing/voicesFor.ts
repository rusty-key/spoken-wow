import "server-only";

import { cache } from "react";

import type { Lang } from "@/lib/lang";

import { VOICES, type Voice } from "./voices";

type Voices = Record<string, Voice[]>;

/** One file per language, written by apps/web/scripts/landing-voices.py. */
const LOADERS: Record<Lang, () => Promise<{ default: Voices }>> = {
  enUS: () => import("./voices/enUS.json"),
  deDE: () => import("./voices/deDE.json"),
  esES: () => import("./voices/esES.json"),
  esMX: () => import("./voices/esMX.json"),
  frFR: () => import("./voices/frFR.json"),
  itIT: () => import("./voices/itIT.json"),
  plPL: () => import("./voices/plPL.json"),
  ptBR: () => import("./voices/ptBR.json"),
  ruRU: () => import("./voices/ruRU.json"),
  koKR: () => import("./voices/koKR.json"),
  zhCN: () => import("./voices/zhCN.json"),
  zhTW: () => import("./voices/zhTW.json"),
  viVN: () => import("./voices/viVN.json"),
};

/**
 * The voice samples of the page's language, a part at a time. English keeps the lines in
 * voices.ts and takes its boss stories from its file. A part the language has no recording for
 * plays the English clips, since a sample in the wrong language still shows what the part does.
 * Loaded on the server so a visitor is sent one language's data, not twelve.
 */
export const voicesFor = cache(async (lang: Lang): Promise<Voices> => {
  const english = { ...VOICES, ...(await LOADERS.enUS()).default };
  if (lang === "enUS") return english;
  const own = (await LOADERS[lang]()).default;
  const parts: Voices = { ...english };
  for (const [part, clips] of Object.entries(own)) if (clips.length) parts[part] = clips;
  return parts;
});
