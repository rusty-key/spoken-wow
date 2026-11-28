/**
 * Revise: Gemini drafts a slot's next version from every version's review, so what an earlier
 * note fixed stays fixed. The race's other flavors' notes go with it, since "trolls need a
 * Jamaican accent" holds for every troll. Nothing is spent at ElevenLabs until Design is pressed.
 */
import "server-only";

import type { CorpusLine } from "@/lib/corpus";
import type { Lang } from "@/lib/lang";

import { DesignError } from "./access";
import { gameClip } from "./analyse";
import { readDesignAudio } from "./audio";
import { found } from "./design";
import { evidenceTable } from "./evidence";
import { reviseVoice, type HistoryVersion, type ReviseInput, type Revision, type SiblingNote } from "./gemini";
import { isRevisable } from "./groups";
import { measureAudio } from "./measure";
import { archetypeOf, corpusLine, liveTake } from "./sources";
import { listDesigns, readAnalysis, readDesign } from "./store";
import type { Analysis, Design, Measures } from "./types";

export type ReviseDeps = {
  read: (lang: Lang, id: string) => Promise<Design | null>;
  all: (lang: Lang) => Promise<Design[]>;
  reference: (slot: string, lang: Lang) => Promise<Buffer | null>;
  audio: (sha256: string, lang: Lang) => Promise<Buffer | null>;
  line: (lang: Lang, lineId: string) => Promise<CorpusLine | null>;
  live: (line: CorpusLine, lang: Lang) => Promise<Buffer | null>;
  measure: (clips: Buffer[]) => Promise<(Measures | null)[] | null>;
  analysis: (lang: Lang, id: string) => Promise<Analysis | null>;
  revise: (input: Omit<ReviseInput, "hasLive"> & { apiKey: string; reference: Buffer; live: Buffer | null; sample: Buffer }) => Promise<Revision>;
};

const LIVE: ReviseDeps = {
  read: readDesign,
  all: listDesigns,
  reference: gameClip,
  audio: readDesignAudio,
  line: corpusLine,
  live: liveTake,
  measure: (clips) => measureAudio(clips),
  analysis: readAnalysis,
  revise: reviseVoice,
};

const raceOf = (slot: string) => slot.split("-")[0];

/** Each other flavor of the race's newest note, from its newest version back, labelled with its slot. */
export function siblingNotes(designs: readonly Design[], slot: string): SiblingNote[] {
  const notes = new Map<string, SiblingNote>();
  // Each slot's versions arrive newest first, so the first note found per slot is its newest.
  for (const design of designs) {
    if (design.slot === slot || raceOf(design.slot) !== raceOf(slot) || notes.has(design.slot)) continue;
    const note = [...design.reviews].reverse().find((review) => review.note)?.note;
    if (note) notes.set(design.slot, { slot: design.slot, version: design.version, note });
  }
  return [...notes.values()];
}

/**
 * The slot's versions up to `upTo`, oldest first, each with its verdicts and the first later version
 * marked good. Versions after the one revised are left out: their notes are about voices it never was.
 */
export function slotHistory(designs: readonly Design[], slot: string, upTo = Infinity): HistoryVersion[] {
  const versions = designs.filter((design) => design.slot === slot && design.version <= upTo).sort((a, b) => a.version - b.version);
  return versions.map((design) => ({
    version: design.version,
    prompt: design.prompt,
    reviews: design.reviews.map((review) => ({
      status: review.status,
      note: review.note,
      observations: review.observations ?? [],
      players: review.players,
    })),
    satisfiedBy: versions.find((later) => later.version > design.version && later.reviews.some((review) => review.status === "good"))?.version ?? null,
  }));
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
  // The line a reviewer marked off is the one worth hearing; else the first. Marks from before
  // the lines were voiced again name other lines.
  const marks = last && (!design.sampledAt || last.createdAt >= design.sampledAt) ? last.clips : {};
  const chosen = design.samples.find((sample) => marks[`sample:${sample.position}`] === "off") ?? design.samples[0];

  const [reference, sample, line, designs, archetype] = await Promise.all([
    deps.reference(design.slot, input.lang),
    deps.audio(chosen.sha256, input.lang),
    deps.line(input.lang, chosen.lineId),
    deps.all(input.lang),
    archetypeOf(design, input.lang, deps.analysis),
  ]);
  if (!reference) throw new DesignError(`${design.slot} has no reference clip on the site to compare with`, 409);
  if (!sample) throw new DesignError(`v${design.version}'s sample line is missing from the archive`, 409);
  // A line gone from the corpus or never voiced still has its take in the version to hear.
  const live = line ? await deps.live(line, input.lang) : null;

  const label = `v${design.version}`;
  const measured = await deps.measure(live ? [reference, live, sample] : [reference, sample]);
  const numbers = measured
    ? evidenceTable({ reference: measured[0], live: live ? measured[1] : null, sample: measured.at(-1) ?? null, label })
    : "";

  const revision = await deps.revise({
    apiKey: input.apiKey,
    slot: design.slot,
    version: design.version,
    status: last?.status ?? "not reviewed yet",
    history: slotHistory(designs, design.slot, design.version),
    siblings: siblingNotes(designs, design.slot),
    archetype,
    prompt: design.prompt,
    previewText: design.previewText,
    line: chosen.text,
    numbers,
    reference,
    live,
    sample,
  });
  // Handed back so the version it becomes keeps it: a revision of a revision has no comparison to ask.
  return { ...revision, archetype };
}
