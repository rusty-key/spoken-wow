/**
 * Revise: Gemini drafts the next version of a slot from its review. It hears the game reference
 * and the version's first sample line, and reads the reviewer's note, the notes on the race's
 * other flavors ("trolls need a Jamaican accent" holds for every troll) and the old prompt.
 * The draft goes to the Design form; nothing is spent at ElevenLabs until Design is pressed.
 */
import "server-only";

import type { Lang } from "@/lib/lang";

import { DesignError } from "./access";
import { gameClip } from "./analyse";
import { readDesignAudio } from "./audio";
import { found } from "./design";
import { reviseVoice, type ReviseInput, type Revision } from "./gemini";
import { listDesigns, readDesign } from "./store";
import type { Design } from "./types";

export type ReviseDeps = {
  read: (lang: Lang, id: string) => Promise<Design | null>;
  all: (lang: Lang) => Promise<Design[]>;
  reference: (slot: string, lang: Lang) => Promise<Buffer | null>;
  audio: (sha256: string, lang: Lang) => Promise<Buffer | null>;
  revise: (input: ReviseInput & { apiKey: string; reference: Buffer; sample: Buffer }) => Promise<Revision>;
};

const LIVE: ReviseDeps = { read: readDesign, all: listDesigns, reference: gameClip, audio: readDesignAudio, revise: reviseVoice };

const raceOf = (slot: string) => slot.split("-")[0];

/** Each other flavor of the race's newest note, from its newest version back. */
export function siblingNotes(designs: readonly Design[], slot: string): Record<string, string> {
  const notes: Record<string, string> = {};
  // listDesigns orders each slot's versions newest first.
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
): Promise<Revision> {
  const design = await found(deps.read, input.lang, input.id);
  const last = design.reviews.at(-1);
  if (last?.status === "good") throw new DesignError(`v${design.version} is marked good; nothing to revise`, 409);
  const first = design.samples[0];
  if (!first) throw new DesignError(`voice v${design.version}'s sample lines first: Gemini listens to one`, 409);

  const [reference, sample, designs] = await Promise.all([
    deps.reference(design.slot, input.lang),
    deps.audio(first.sha256, input.lang),
    deps.all(input.lang),
  ]);
  if (!reference) throw new DesignError(`${design.slot} has no game clip on the site to compare with`, 409);
  if (!sample) throw new DesignError(`v${design.version}'s first sample line is missing from the archive`, 409);

  const archetype = design.analysis?.archetype;
  return deps.revise({
    apiKey: input.apiKey,
    slot: design.slot,
    version: design.version,
    status: last?.status ?? "not reviewed yet",
    note: last?.note ?? "",
    siblings: siblingNotes(designs, design.slot),
    archetype: typeof archetype === "string" ? archetype : "",
    prompt: design.prompt,
    previewText: design.previewText,
    reference,
    sample,
  });
}
