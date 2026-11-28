/** What What's different and revise both read: a sample line's live take and who the voice is for. */
import "server-only";

import fs from "node:fs/promises";

import { audioRelPath } from "@/lib/audio";
import { blobBytes } from "@/lib/blobs/where";
import type { CorpusLine } from "@/lib/corpus";
import type { Lang } from "@/lib/lang";
import { lineIndex } from "@/lib/quests/catalogue";
import { livePath } from "@/lib/takes/store";

import type { Analysis, Design } from "./types";

export async function liveTake(line: CorpusLine, lang: Lang): Promise<Buffer | null> {
  const bytes = await livePath("quests", audioRelPath(line), lang);
  if (bytes.kind === "blob") return blobBytes(bytes.key, bytes.lang ?? lang);
  if (bytes.kind === "file") return fs.readFile(bytes.path).catch(() => null);
  return null;
}

export const corpusLine = async (lang: Lang, lineId: string): Promise<CorpusLine | null> => (await lineIndex(lang)).get(lineId)?.[0] ?? null;

/** Who the voice is for: the version's own description, else the blind comparison it came from. */
export async function archetypeOf(
  design: Design,
  lang: Lang,
  analysis: (lang: Lang, id: string) => Promise<Analysis | null>,
): Promise<string> {
  const own = design.analysis?.archetype;
  if (typeof own === "string") return own;
  if (!design.analysisId) return "";
  const found = await analysis(lang, design.analysisId);
  const label = Object.entries(found?.labels ?? {}).find(([, slot]) => slot === design.slot)?.[0];
  return (label && found?.result.voices[label]?.archetype) || "";
}
