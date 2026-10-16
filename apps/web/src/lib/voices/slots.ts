/**
 * Which voices this project needs, and what a valid voice name is.
 *
 * Roster and player catalogue membership keep slot names safe to use as path segments.
 * A slot can receive references before any dialogue is recorded for it.
 */
import { corpus } from "@/lib/quests/catalogue";
import { hasNarration, NARRATOR_VOICE } from "@/lib/generation/narration";
import { COMBAT_VOICES } from "@/lib/combat/catalogue";

import { loadRoster } from "./roster-store";

export type VoiceSlot = {
  /** e.g. "orc-male-shady" — the ElevenLabs voice name this project resolves by. */
  name: string;
  /** Quest and combat lines this voice would speak. */
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

  for (const voice of COMBAT_VOICES) lines.set(voice.id, (lines.get(voice.id) ?? 0) + voice.lines.length);
  const names = new Set([...(await loadRoster()).voiceNames, ...COMBAT_VOICES.map((voice) => voice.id)]);
  return [...names].map((name) => ({
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
 * Membership avoids the corpus query needed to count lines for slots().
 */
export async function isVoiceSlot(name: string): Promise<boolean> {
  // Unassigned NPC model voices cannot receive references until their voices are decided.
  return COMBAT_VOICES.some((voice) => voice.id === name) || (await loadRoster()).voiceNames.includes(name);
}
