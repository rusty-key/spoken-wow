import "server-only";

import { cache } from "react";

import type { Lang } from "@/lib/lang";

import { VOICES, type Voice } from "./voices";

type Voices = Record<string, Voice[]>;

const load = async (lang: Lang): Promise<Voices> => (await import(`./voices/${lang}.json`)).default;

/**
 * The voice samples of the page's language, a part at a time. English keeps the lines in
 * voices.ts and takes its boss stories from its file. A part the language has no recording for
 * plays the English clips, since a sample in the wrong language still shows what the part does.
 * Loaded on the server so a visitor is sent one language's data, not twelve.
 */
export const voicesFor = cache(async (lang: Lang): Promise<Voices> => {
  const parts: Voices = { ...VOICES, ...(await load("enUS")) };
  if (lang === "enUS") return parts;
  for (const [part, clips] of Object.entries(await load(lang))) if (clips.length) parts[part] = clips;
  return parts;
});
