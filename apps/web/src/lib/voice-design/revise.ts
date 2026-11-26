/**
 * Revise: Gemini drafts a slot's next version from its review. The race's other flavors' notes go
 * with it, since "trolls need a Jamaican accent" holds for every troll. Nothing is spent at
 * ElevenLabs until Design is pressed.
 */
import "server-only";

import type { Lang } from "@/lib/lang";

import { DesignError } from "./access";
import { gameClip } from "./analyse";
import { readDesignAudio } from "./audio";
import { found } from "./design";
import { reviseVoice, type ReviseInput, type Revision } from "./gemini";
import { isRevisable } from "./groups";
import { listDesigns, readAnalysis, readDesign } from "./store";
import type { Analysis, Design } from "./types";

export type ReviseDeps = {
  read: (lang: Lang, id: string) => Promise<Design | null>;
  all: (lang: Lang) => Promise<Design[]>;
  reference: (slot: string, lang: Lang) => Promise<Buffer | null>;
  audio: (sha256: string, lang: Lang) => Promise<Buffer | null>;
  analysis: (lang: Lang, id: string) => Promise<Analysis | null>;
  revise: (input: ReviseInput & { apiKey: string; reference: Buffer; sample: Buffer }) => Promise<Revision>;
};

const LIVE: ReviseDeps = {
  read: readDesign,
  all: listDesigns,
  reference: gameClip,
  audio: readDesignAudio,
  analysis: readAnalysis,
  revise: reviseVoice,
};

/** Who the voice is for: the version's own description, else the blind comparison it came from. */
async function archetypeOf(design: Design, lang: Lang, deps: ReviseDeps): Promise<string> {
  const own = design.analysis?.archetype;
  if (typeof own === "string") return own;
  if (!design.analysisId) return "";
  const analysis = await deps.analysis(lang, design.analysisId);
  const label = Object.entries(analysis?.labels ?? {}).find(([, slot]) => slot === design.slot)?.[0];
  return (label && analysis?.result.voices[label]?.archetype) || "";
}

const raceOf = (slot: string) => slot.split("-")[0];

/** Each other flavor of the race's newest note, from its newest version back. */
export function siblingNotes(designs: readonly Design[], slot: string): Record<string, string> {
  const notes: Record<string, string> = {};
  // Each slot's versions arrive newest first, so the first note found per slot is its newest.
  for (const design of designs) {
    if (design.slot === slot || raceOf(design.slot) !== raceOf(slot) || design.slot in notes) continue;
    const note = [...design.reviews].reverse().find((review) => review.note)?.note;
    if (note) notes[design.slot] = note;
  }
  return notes;
}

export async function reviseDesign(
  input: { lang: Lang; id: string; apiKey: string },
  deps: ReviseDeps = LIVE,
): Promise<Revision & { archetype: string }> {
  const design = await found(deps.read, input.lang, input.id);
  const last = design.reviews.at(-1);
  if (!isRevisable(design)) {
    throw new DesignError(
      last?.status === "good"
        ? `v${design.version} is marked good; nothing to revise`
        : `voice v${design.version}'s sample lines first: Gemini listens to one`,
      409,
    );
  }
  const first = design.samples[0];

  const [reference, sample, designs, archetype] = await Promise.all([
    deps.reference(design.slot, input.lang),
    deps.audio(first.sha256, input.lang),
    deps.all(input.lang),
    archetypeOf(design, input.lang, deps),
  ]);
  if (!reference) throw new DesignError(`${design.slot} has no game clip on the site to compare with`, 409);
  if (!sample) throw new DesignError(`v${design.version}'s first sample line is missing from the archive`, 409);

  const revision = await deps.revise({
    apiKey: input.apiKey,
    slot: design.slot,
    version: design.version,
    status: last?.status ?? "not reviewed yet",
    // A later verdict without words does not take back what an earlier one said.
    note: [...design.reviews].reverse().find((review) => review.note)?.note ?? "",
    siblings: siblingNotes(designs, design.slot),
    archetype,
    prompt: design.prompt,
    previewText: design.previewText,
    reference,
    sample,
  });
  // Handed back so the version it becomes keeps it: a revision of a revision has no comparison to ask.
  return { ...revision, archetype };
}
