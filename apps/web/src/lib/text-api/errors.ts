/** What a failed write tells the caller. */
import "server-only";

import { StoryConflict, StoryMissing } from "@/lib/bosses/story";
import { NameConflict, NameMissing } from "@/lib/names/store";
import { LoreConflict, LoreMissing } from "@/lib/places/lore";
import { QuestTextConflict, QuestTextMissing } from "@/lib/quests/text";
import { BookConflict, BookMissing } from "@/lib/readables/text";

export type ErrorCode = "conflict" | "unknown_id" | "invalid" | "internal";

const CONFLICTS = [LoreConflict, StoryConflict, BookConflict, QuestTextConflict, NameConflict];
const MISSING = [LoreMissing, StoryMissing, BookMissing, QuestTextMissing, NameMissing];

/**
 * What a store refuses is a plain Error, with its reason. A driver's error has a code or a class of
 * its own, and so does a bug: neither is anything the caller can fix by changing the text, and
 * their messages name tables and code, so they are logged here and not passed on.
 */
export function describeError(error: unknown): { code: ErrorCode; message: string } {
  const message = error instanceof Error ? error.message : String(error);
  if (CONFLICTS.some((type) => error instanceof type)) return { code: "conflict", message };
  if (MISSING.some((type) => error instanceof type)) return { code: "unknown_id", message };
  if (error instanceof Error && error.constructor === Error && !("code" in error)) return { code: "invalid", message };
  console.error("text-api: a write failed", error);
  return { code: "internal", message: "this failed on the server; try it again" };
}
