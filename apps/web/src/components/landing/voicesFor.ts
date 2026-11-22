import "server-only";

import { cache } from "react";

import type { Lang } from "@/lib/lang";

import { VOICES, type Voice } from "./voices";

type Voices = Record<string, Voice[]>;

// A team's own language has no samples file; it hears English rather than failing the page.
const load = async (lang: Lang): Promise<Voices> =>
  (await import(`./voices/${lang}.json`).catch(() => ({ default: {} }))).default;

/**
 * The page language's voice samples, with English for each part it has no recording of: a sample
 * in the wrong language still shows what the part does. Loaded on the server so a visitor is sent
 * one language's data, not thirteen.
 */
export const voicesFor = cache(async (lang: Lang): Promise<Voices> => {
  const parts: Voices = { ...VOICES, ...(await load("enUS")) };
  if (lang === "enUS") return parts;
  for (const [part, clips] of Object.entries(await load(lang))) if (clips.length) parts[part] = clips;
  return parts;
});
