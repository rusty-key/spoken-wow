import "server-only";

import { StoryConflict, StoryMissing } from "@/lib/bosses/story";
import { NameConflict, NameMissing } from "@/lib/names/store";
import { LoreConflict, LoreMissing } from "@/lib/places/lore";
import { QuestTextConflict, QuestTextMissing } from "@/lib/quests/text";
import { BookConflict, BookMissing } from "@/lib/readables/text";

export type ErrorCode = "conflict" | "unknown_id" | "invalid" | "internal";

/** The API turning a write down, with a reason the caller can act on. */
export class Refused extends Error {}

const CONFLICTS = [LoreConflict, StoryConflict, BookConflict, QuestTextConflict, NameConflict];
const MISSING = [LoreMissing, StoryMissing, BookMissing, QuestTextMissing, NameMissing];

/**
 * Anything else is not the caller's to fix, plain Errors included, since the pg pool throws those
 * when it runs out of connections. Such messages name tables and code, so they stay in the log.
 */
export function describeError(error: unknown): { code: ErrorCode; message: string } {
  const message = error instanceof Error ? error.message : String(error);
  if (CONFLICTS.some((type) => error instanceof type)) return { code: "conflict", message };
  if (MISSING.some((type) => error instanceof type)) return { code: "unknown_id", message };
  if (error instanceof Refused) return { code: "invalid", message };
  console.error("text-api: a write failed", error);
  return { code: "internal", message: "this failed on the server; try it again" };
}
