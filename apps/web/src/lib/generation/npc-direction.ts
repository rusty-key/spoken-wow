/**
 * Each file's NPC direction, in one place because regenerating, the staleness check and an
 * override's spoken hashes must hash the same string.
 */
import type { CorpusLine } from "@/lib/corpus";
import type { Lang } from "@/lib/lang";
import { listDirections } from "@/lib/npc/store";
import { lineIndex } from "@/lib/quests/catalogue";
import { npcDirection } from "./narration";

/** Judged over every line sharing the line's file. */
export type NpcDirectionOf = (line: Pick<CorpusLine, "lineId" | "npcType" | "npcId">) => string | undefined;

export async function npcDirections(lang: Lang): Promise<NpcDirectionOf> {
  const directions = await listDirections();
  // Most of the time no NPC has one, and the corpus's line index is not worth its stamp check.
  if (directions.size === 0) return () => undefined;
  const groups = await lineIndex(lang);
  return (line) => npcDirection(groups.get(line.lineId) ?? [line], directions);
}
