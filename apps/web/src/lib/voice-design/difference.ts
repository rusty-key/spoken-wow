/**
 * What's different: how a sample line's take in a designed version differs from its live take.
 * Gemini hears both and the game reference; Claude reads a picture and the measurements of the three.
 * Each runs on the caller's own key. Nothing is kept; asking again asks again.
 */
import "server-only";

import type { CorpusLine } from "@/lib/corpus";
import type { Lang } from "@/lib/lang";

import { DesignError } from "./access";
import { gameClip } from "./analyse";
import { readDesignAudio } from "./audio";
import { describeDifferenceClaude } from "./claude";
import { found } from "./design";
import { evidenceTable } from "./evidence";
import { describeDifference } from "./gemini";
import type { Difference } from "./judging";
import { measureAudio, viewAudio } from "./measure";
import { archetypeOf, corpusLine, liveTake } from "./sources";
import { readAnalysis, readDesign } from "./store";
import type { Analysis, Design, Judge } from "./types";

export type DifferenceDeps = {
  read: (lang: Lang, id: string) => Promise<Design | null>;
  line: (lang: Lang, lineId: string) => Promise<CorpusLine | null>;
  live: (line: CorpusLine, lang: Lang) => Promise<Buffer | null>;
  audio: (sha256: string, lang: Lang) => Promise<Buffer | null>;
  reference: (slot: string, lang: Lang) => Promise<Buffer | null>;
  analysis: (lang: Lang, id: string) => Promise<Analysis | null>;
  measure: typeof measureAudio;
  view: typeof viewAudio;
  describe: typeof describeDifference;
  describeClaude: typeof describeDifferenceClaude;
};

const LIVE: DifferenceDeps = {
  read: readDesign,
  line: corpusLine,
  live: liveTake,
  audio: readDesignAudio,
  reference: gameClip,
  analysis: readAnalysis,
  measure: measureAudio,
  view: viewAudio,
  describe: describeDifference,
  describeClaude: describeDifferenceClaude,
};

/** Claude's answer also carries its prompt changes and the picture it read, base64, for the reviewer to see. */
export type JudgedDifference = Difference & { by: Judge; fixes?: string[]; image?: string | null };

export async function differenceFromLive(
  input: { lang: Lang; id: string; position: number; apiKey: string; by: Judge },
  deps: DifferenceDeps = LIVE,
): Promise<JudgedDifference> {
  const design = await found(deps.read, input.lang, input.id);
  const sample = design.samples.find((s) => s.position === input.position);
  if (!sample) throw new DesignError(`v${design.version} has no sample line ${input.position + 1}`, 404);
  // Read beside the takes: it is an ffmpeg cut when the slot has no stored reference window.
  const reading = deps.reference(design.slot, input.lang).catch((error: unknown) => (error instanceof Error ? error : new Error(String(error))));
  const line = await deps.line(input.lang, sample.lineId);
  if (!line) throw new DesignError(`${sample.lineId} is no longer in the corpus`, 409);
  const [live, audio] = await Promise.all([deps.live(line, input.lang), deps.audio(sample.sha256, input.lang)]);
  if (!live) throw new DesignError(`${sample.lineId} has no live take to compare with`, 409);
  if (!audio) throw new DesignError(`v${design.version}'s take of ${sample.lineId} is missing from the archive`, 409);

  if (input.by === "gemini") {
    // Without the game clip Gemini still compares the two takes; accent and persona lose their anchor.
    const read = await reading;
    const reference = read instanceof Error ? null : read;
    const said = await deps.describe({ apiKey: input.apiKey, slot: design.slot, version: design.version, text: sample.text, reference, live, sample: audio });
    return { ...said, by: "gemini" };
  }

  const reference = await reading;
  if (reference instanceof Error) throw reference;
  if (!reference) throw new DesignError(`${design.slot} has no reference clip on the site for Claude to compare with`, 409);
  const label = `v${design.version}`;
  const [measured, image, archetype] = await Promise.all([
    deps.measure([reference, live, audio]),
    deps.view({ reference, live, sample: audio, label }),
    archetypeOf(design, input.lang, deps.analysis),
  ]);
  const numbers = measured ? evidenceTable({ reference: measured[0], live: measured[1], sample: measured[2], label }) : "";
  // Claude cannot hear: with neither picture nor numbers it would only guess.
  if (!image && !numbers) throw new DesignError("Claude reads a picture and measurements of the takes, and the site could not make either", 503);
  const said = await deps.describeClaude({
    apiKey: input.apiKey,
    slot: design.slot,
    version: design.version,
    text: sample.text,
    archetype,
    prompt: design.prompt,
    notes: design.reviews.map((review) => review.note).filter(Boolean),
    numbers,
    image,
  });
  return { ...said, by: "claude", image: image ? image.toString("base64") : null };
}
