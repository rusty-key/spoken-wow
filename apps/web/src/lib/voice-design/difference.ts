/**
 * What's different: Gemini hears a sample line's live take and its take in a designed version, on
 * the caller's Gemini key. Nothing is kept; asking again asks Gemini again.
 */
import "server-only";

import fs from "node:fs/promises";

import { audioRelPath } from "@/lib/audio";
import { blobBytes } from "@/lib/blobs/where";
import type { CorpusLine } from "@/lib/corpus";
import type { Lang } from "@/lib/lang";
import { lineIndex } from "@/lib/quests/catalogue";
import { livePath } from "@/lib/takes/store";

import { DesignError } from "./access";
import { readDesignAudio } from "./audio";
import { found } from "./design";
import { describeDifference, type Difference } from "./gemini";
import { readDesign } from "./store";
import type { Design } from "./types";

export type DifferenceDeps = {
  read: (lang: Lang, id: string) => Promise<Design | null>;
  line: (lang: Lang, lineId: string) => Promise<CorpusLine | null>;
  live: (line: CorpusLine, lang: Lang) => Promise<Buffer | null>;
  audio: (sha256: string, lang: Lang) => Promise<Buffer | null>;
  describe: typeof describeDifference;
};

async function liveTake(line: CorpusLine, lang: Lang): Promise<Buffer | null> {
  const bytes = await livePath("quests", audioRelPath(line), lang);
  if (bytes.kind === "blob") return blobBytes(bytes.key, bytes.lang ?? lang);
  if (bytes.kind === "file") return fs.readFile(bytes.path).catch(() => null);
  return null;
}

const LIVE: DifferenceDeps = {
  read: readDesign,
  line: async (lang, lineId) => (await lineIndex(lang)).get(lineId)?.[0] ?? null,
  live: liveTake,
  audio: readDesignAudio,
  describe: (input) => describeDifference(input),
};

export async function differenceFromLive(
  input: { lang: Lang; id: string; position: number; apiKey: string },
  deps: DifferenceDeps = LIVE,
): Promise<Difference> {
  const design = await found(deps.read, input.lang, input.id);
  const sample = design.samples.find((s) => s.position === input.position);
  if (!sample) throw new DesignError(`v${design.version} has no sample line ${input.position + 1}`, 404);
  const line = await deps.line(input.lang, sample.lineId);
  if (!line) throw new DesignError(`${sample.lineId} is no longer in the corpus`, 409);
  const [live, audio] = await Promise.all([deps.live(line, input.lang), deps.audio(sample.sha256, input.lang)]);
  if (!live) throw new DesignError(`${sample.lineId} has no live take to compare with`, 409);
  if (!audio) throw new DesignError(`v${design.version}'s take of ${sample.lineId} is missing from the archive`, 409);
  return deps.describe({ apiKey: input.apiKey, slot: design.slot, version: design.version, text: sample.text, live, sample: audio });
}
