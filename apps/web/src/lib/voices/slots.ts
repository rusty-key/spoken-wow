/**
 * Which voices this project needs, and what a valid voice name is.
 *
 * The set is the roster (roster-store.ts), so a voice exists here -- and can be given clips and
 * cloned -- before the first line for it is accepted. The corpus only counts what each one
 * carries. The names are the ones tts_cli/voices.py matches on: `race-gender-flavor`, and
 * nothing else is usable, because a stock library voice's name cannot express that mapping.
 *
 * Being a closed set also makes it a whitelist, which is what keeps a slot name safe to use as
 * a path segment. Same reasoning as isSafeAudioPath in range.ts.
 */
import { corpus } from "@/lib/quests/catalogue";
import { hasNarration, NARRATOR_VOICE } from "@/lib/generation/narration";

import { loadRoster } from "./roster-store";

export type VoiceSlot = {
  /** e.g. "orc-male-shady" — the ElevenLabs voice name this project resolves by. */
  name: string;
  /** Corpus lines this voice would speak. */
  lineCount: number;
  /** Distinct NPCs using it, which is the better measure of how much it carries. */
  npcCount: number;
};

/**
 * Every voice on the roster, with what it carries.
 *
 * Alphabetical rather than busiest-first: at fifty-odd voices the list is something you
 * navigate to find one row, and the flavors of a race-gender then sit together.
 *
 * Only generatable lines count: progress text and lines with unresolved template tokens are
 * never voiced. The narrator also reads the stage directions inside other NPCs' lines
 * (generation/narration.ts), so those count towards it as well as the lines it speaks itself.
 */
export async function voiceSlots(): Promise<VoiceSlot[]> {
  const lines = new Map<string, number>();
  const npcs = new Map<string, Set<number>>();
  const count = (voice: string, npcId: number) => {
    lines.set(voice, (lines.get(voice) ?? 0) + 1);
    if (!npcs.has(voice)) npcs.set(voice, new Set());
    npcs.get(voice)!.add(npcId);
  };

  for (const line of (await corpus()).lines) {
    if (hasNarration(line.text) && line.voice !== NARRATOR_VOICE) count(NARRATOR_VOICE, line.npcId);
    if (line.generatable) count(line.voice, line.npcId);
  }

  return (await loadRoster()).voiceNames.map((name) => ({
    name,
    lineCount: lines.get(name) ?? 0,
    npcCount: npcs.get(name)?.size ?? 0,
  })).sort((a, b) => a.name.localeCompare(b.name));
}

const cacheKey = Symbol.for("wow-voiceover.slots");
type CacheHolder = { [cacheKey]?: { lines: unknown; roster: unknown; slots: VoiceSlot[] } };

/**
 * Tied to the catalogue's own array rather than memoised forever: the counts come from the
 * lines, and the lines are a table now -- an edit that moves a line to another voice moves
 * the counts with it.
 */
export async function slots(): Promise<VoiceSlot[]> {
  const lines = (await corpus()).lines;
  // A voice an admin just added is a slot before any line speaks in it.
  const roster = await loadRoster();
  const holder = globalThis as CacheHolder;

  if (!holder[cacheKey] || holder[cacheKey].lines !== lines || holder[cacheKey].roster !== roster) {
    holder[cacheKey] = { lines, roster, slots: await voiceSlots() };
  }
  return holder[cacheKey].slots;
}

/**
 * Whether a string names a voice this project uses.
 *
 * Every route that takes a voice name from the URL goes through this before touching the
 * filesystem or ElevenLabs. Membership of a fixed set, not pattern matching: `../` and an
 * absolute path fail for the same reason `orc-mail` does.
 *
 * Asked of the roster directly rather than of slots(): the names are the same, and slots()
 * costs a corpus stamp query per call, which /voices paid once per slot and once per voice
 * in the ElevenLabs account, in series.
 */
export async function isVoiceSlot(name: string): Promise<boolean> {
  // The roster alone, not isVoice: a model slot (voices.ts isModelVoice) names the voice some
  // lines are in, but nothing may be cloned, cut or uploaded for one until which voice each
  // model gets has been decided.
  return (await loadRoster()).voiceNames.includes(name);
}
