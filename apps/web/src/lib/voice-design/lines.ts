/**
 * Which corpus lines a designed voice is judged on, and who it has to suit.
 *
 * A voice must suit the NPCs who use the slot, not the flavor's name, and is judged best on varied
 * lines: a long quest text, a short bark, a plain gossip line.
 */
import type { CorpusLine } from "@/lib/corpus";
import { segments } from "@/lib/generation/narration";
import { shuffle } from "@/lib/shuffle";

/** Longer lines cost credits and tell a listener nothing a 400-character one does not. */
export const MAX_SAMPLE_CHARS = 400;
export const MIN_BARK_CHARS = 20;

/** A line spoken by the slot alone: narration or a marker would hand part of it to another voice. */
export function soloLine(line: CorpusLine, slot: string): boolean {
  if (line.voice !== slot || !line.generatable) return false;
  return segments(line.text).every((segment) => segment.speaker === "npc" && !segment.voice);
}

export function slotNpcs(lines: readonly CorpusLine[], slot: string, limit = 12): string[] {
  const counts = new Map<string, number>();
  for (const line of lines) {
    if (line.voice !== slot || !line.generatable) continue;
    counts.set(line.npcName, (counts.get(line.npcName) ?? 0) + 1);
  }
  return [...counts]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([name]) => name);
}

/** slotNpcs for many slots at once: one pass over the corpus rather than one per slot. */
export function slotExamples(lines: readonly CorpusLine[], slots: readonly string[], limit = 3): Map<string, string[]> {
  const wanted = new Set(slots);
  const bySlot = new Map<string, CorpusLine[]>();
  for (const line of lines) {
    if (!wanted.has(line.voice)) continue;
    const own = bySlot.get(line.voice);
    if (own) own.push(line);
    else bySlot.set(line.voice, [line]);
  }
  return new Map(slots.map((slot) => [slot, slotNpcs(bySlot.get(slot) ?? [], slot, limit)]));
}

const kind = (line: CorpusLine) => line.lineId.slice(0, 2);
const byLength = (a: CorpusLine, b: CorpusLine) => a.text.length - b.text.length || a.lineId.localeCompare(b.lineId);

function usableLines(lines: readonly CorpusLine[], slot: string): CorpusLine[] {
  const seen = new Set<string>();
  return lines
    .filter((line) => soloLine(line, slot) && line.text.length <= MAX_SAMPLE_CHARS)
    .filter((line) => !seen.has(line.lineId) && seen.add(line.lineId))
    .sort(byLength);
}

const isBark = (line: CorpusLine) => kind(line) === "f:" && line.text.length >= MIN_BARK_CHARS;

/** Tops `picked` up to three from `rest`, in the order given. */
function topUp(picked: (CorpusLine | undefined)[], rest: readonly CorpusLine[]): CorpusLine[] {
  const chosen = picked.filter((line): line is CorpusLine => line !== undefined);
  for (const line of rest) {
    if (chosen.length >= 3) break;
    if (!chosen.includes(line)) chosen.push(line);
  }
  return chosen;
}

const pickDefaults = (usable: readonly CorpusLine[]): CorpusLine[] => {
  const gossip = usable.filter((line) => kind(line) === "g:");
  return topUp([usable.filter((line) => kind(line) === "q:").at(-1), usable.find(isBark), gossip[Math.floor(gossip.length / 2)]], [...usable].reverse());
};

/**
 * Up to three lines: the longest quest text, the shortest bark, a middling gossip line. A slot
 * without one of the kinds gets the next-longest of what it has instead, so it still has three.
 */
export function defaultSampleLines(lines: readonly CorpusLine[], slot: string): CorpusLine[] {
  return pickDefaults(usableLines(lines, slot));
}

/** Topped up from the default lines where the corpus lost one, so a new take is judged on the same lines. */
export function sameSampleLines(lines: readonly CorpusLine[], slot: string, heard: readonly string[]): CorpusLine[] {
  const usable = usableLines(lines, slot);
  const byId = new Map(usable.map((line) => [line.lineId, line]));
  return topUp(
    heard.map((id) => byId.get(id)),
    pickDefaults(usable),
  );
}

/**
 * Three other lines of the same kinds, picked at random, for when the usual ones say little about
 * the voice. A slot with too few lines to avoid every one already heard repeats some.
 */
export function otherSampleLines(lines: readonly CorpusLine[], slot: string, heard: readonly string[], random = Math.random): CorpusLine[] {
  const usable = usableLines(lines, slot);
  const old = new Set(heard);
  const fresh = usable.filter((line) => !old.has(line.lineId));
  const pick = (list: readonly CorpusLine[]) => list[Math.floor(random() * list.length)];
  return topUp(
    [pick(fresh.filter((line) => kind(line) === "q:")), pick(fresh.filter(isBark)), pick(fresh.filter((line) => kind(line) === "g:"))],
    [...shuffle(fresh, random), ...shuffle(usable.filter((line) => old.has(line.lineId)), random)],
  );
}

/** Lines long enough to be Voice Design's preview text, in the character's own register. */
export function previewTextCandidates(lines: readonly CorpusLine[], slot: string, limit = 8): string[] {
  const texts = new Set<string>();
  for (const line of lines) {
    if (soloLine(line, slot) && line.text.length >= 100 && line.text.length <= 300) texts.add(line.text.trim());
  }
  return [...texts].sort((a, b) => a.length - b.length).slice(0, limit);
}
