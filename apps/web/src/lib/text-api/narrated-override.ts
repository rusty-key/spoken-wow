import "server-only";

import { clearTextOverride, writeTextOverride } from "@/lib/text-overrides/store";
import type { NarratedSource } from "@/lib/text-overrides/types";

import { checkOriginalVersion, untranslated } from "./errors";
import type { SectionApi } from "./types";

type Args = Parameters<SectionApi["saveOverride"]>[0];

/**
 * A place, readable or boss override in the acting team. `original` is the line's text in the
 * language, null where it has none, and `version` that text's version.
 */
export async function saveNarratedOverride(
  source: NarratedSource,
  { lang, id, text, by, expectedVersion, audit }: Args,
  original: string | null,
  version: number | null,
): ReturnType<SectionApi["saveOverride"]> {
  // Taking an override back needs no original under it, so one over a retired line can still go.
  if (text === null) {
    const removed = await clearTextOverride({ source, lang, lineId: id, by, audit });
    return { version, lines: [id], wrote: removed, removed };
  }
  if (original === null) throw untranslated(lang);
  checkOriginalVersion(version, expectedVersion);
  const { wrote } = await writeTextOverride({ source, lang, lineId: id, text: text.trim(), original, userId: by, audit });
  return { version, lines: [id], wrote, removed: false };
}
