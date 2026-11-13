/**
 * Turning the address the addon produced back into corpus lines.
 *
 * The addon builds its URL from what the client can see - a quest id and an event, or a unit
 * GUID - and never from anything the data module resolved, because a module that failed to
 * load is the failure most worth reporting. So resolution happens here, against the corpus,
 * and is allowed to fail: an address that matches nothing still deserves a form.
 */
import type { Corpus, CorpusLine } from "@/lib/corpus";
import { corpus as questCorpus } from "@/lib/quests/catalogue";

/**
 * The three of lib/line-fields.ts's SOURCES that a quest address can name. `gossip` has no
 * quest to hang an id on and travels as an NPC address instead, and so do `chatter` and
 * `followup`, which has a quest but is neither of its dialogs (lib/reports/line-target.ts).
 */
const QUEST_EVENTS = ["accept", "progress", "complete"] as const;

type QuestEvent = (typeof QUEST_EVENTS)[number];

/**
 * Creature and gameobject ids overlap (creature 68 is a guard, gameobject 68 a poster), so
 * each has its own address: npc/{id} and object/{id}.
 */
export type Target =
  | { kind: "quest"; questId: number; event: QuestEvent }
  | { kind: "npc"; npcId: number }
  | { kind: "object"; objectId: number };

function positiveInt(value: string): number | null {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function isQuestEvent(value: string): value is QuestEvent {
  return (QUEST_EVENTS as readonly string[]).includes(value);
}

export function parseTarget(segments: string[]): Target | null {
  if (segments[0] === "quest" && segments.length === 3) {
    const questId = positiveInt(segments[1]);
    if (questId === null || !isQuestEvent(segments[2])) return null;
    return { kind: "quest", questId, event: segments[2] };
  }
  if (segments[0] === "npc" && segments.length === 2) {
    const npcId = positiveInt(segments[1]);
    if (npcId === null) return null;
    return { kind: "npc", npcId };
  }
  if (segments[0] === "object" && segments.length === 2) {
    const objectId = positiveInt(segments[1]);
    if (objectId === null) return null;
    return { kind: "object", objectId };
  }
  return null;
}

/** The form stored in report."target", and the path the addon builds. */
export function formatTarget(target: Target): string {
  if (target.kind === "quest") return `quest/${target.questId}/${target.event}`;
  return target.kind === "object" ? `object/${target.objectId}` : `npc/${target.npcId}`;
}

/**
 * Every line the address could mean, in corpus order.
 *
 * An array rather than a line because an NPC address means all of that creature's lines and
 * the reporter picks one, and because a quest can hold separate male and female variants.
 */
export async function resolveTarget(target: Target, corpus?: Corpus): Promise<CorpusLine[]> {
  const lines = corpus ?? (await questCorpus());
  if (target.kind === "quest") {
    return lines.lines.filter(
      (line) => line.questId === target.questId && line.source === target.event,
    );
  }
  if (target.kind === "object") {
    return lines.lines.filter(
      (line) => line.npcType === "gameobject" && line.npcId === target.objectId,
    );
  }
  const speakers = lines.lines.filter(
    (line) => line.npcType !== "gameobject" && line.npcId === target.npcId,
  );
  // Builds up to 3.4.0 sent npc/{id} for an object too: with no creature of that id, the
  // address can only have meant the object.
  return speakers.length > 0
    ? speakers
    : lines.lines.filter((line) => line.npcType === "gameobject" && line.npcId === target.npcId);
}
