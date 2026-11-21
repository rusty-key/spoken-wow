import "server-only";

import { cache } from "react";

import type { Lang } from "@/lib/lang";

import type { HeroLineData } from "./HeroLine";

/** The hero's subtitle lines in the page's language, or English when it has no corpus lines yet. */
export const heroFor = cache(async (lang: Lang): Promise<HeroLineData[]> => {
  const file: { default: HeroLineData[] } = await import(`./hero/${lang}.json`).catch(() => import("./hero/enUS.json"));
  return file.default;
});
