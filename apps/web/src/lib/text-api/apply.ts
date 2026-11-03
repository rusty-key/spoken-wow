/**
 * One item of an update, and a run of them. Each item stands alone: its failure is reported in
 * its result, because one bad id must not throw away a 500-line run.
 */
import "server-only";

import type { ApiAudit } from "@/lib/activity/kinds";
import { StoryConflict, StoryMissing } from "@/lib/bosses/story";
import { NameConflict, nameHistory, NameMissing, saveName } from "@/lib/names/store";
import { LoreConflict, LoreMissing } from "@/lib/places/lore";
import { QuestTextConflict, QuestTextMissing } from "@/lib/quests/text";
import { BookConflict, BookMissing } from "@/lib/readables/text";

import { createBatch } from "./batches";
import type { TokenContext } from "./guard";
import { keyOf, sections } from "./index";
import type { NameTarget, Section } from "./types";

export const MAX_ITEMS = 1000;
export const MAX_TEXT = 5000;
export const MAX_NAME = 200;

export type ItemInput = {
  id: string;
  variant?: unknown;
  text?: unknown;
  short?: unknown;
  name?: unknown;
  note?: unknown;
  expectedVersion?: unknown;
  expectedNameVersion?: unknown;
};

type ErrorCode = "conflict" | "unknown_id" | "invalid" | "internal";

export type FieldResult =
  | { status: "updated" | "unchanged"; version: number; lines?: string[]; entity?: NameTarget }
  | { status: "error"; code: ErrorCode; message: string };

export type ItemResult = {
  id: string | null;
  variant?: number;
  text?: FieldResult;
  name?: FieldResult;
  error?: { code: ErrorCode; message: string };
};

const CONFLICTS = [LoreConflict, StoryConflict, BookConflict, QuestTextConflict, NameConflict];
const MISSING = [LoreMissing, StoryMissing, BookMissing, QuestTextMissing, NameMissing];

function fieldError(error: unknown): FieldResult {
  const message = error instanceof Error ? error.message : String(error);
  if (CONFLICTS.some((type) => error instanceof type)) return { status: "error", code: "conflict", message };
  if (MISSING.some((type) => error instanceof type)) return { status: "error", code: "unknown_id", message };
  // What a store refuses is a plain Error, with its reason. A driver's error has a code, is
  // nothing the caller can fix by changing the text, and must not read as if they could.
  if (error instanceof Error && "code" in error) {
    console.error("text-api: a save failed", error);
    return { status: "error", code: "internal", message: "the save failed; try this item again" };
  }
  return { status: "error", code: "invalid", message };
}

const refused = (message: string): FieldResult => ({ status: "error", code: "invalid", message });

function optionalVersion(value: unknown): value is number | null | undefined {
  return value === undefined || value === null || Number.isInteger(value);
}

/** Why the item's shape is wrong, or null. Fields' own values are judged where they are written. */
function shapeError(section: Section, input: ItemInput): string | null {
  if (input.text === undefined && input.short === undefined && input.name === undefined) {
    return "give text, name or both";
  }
  if (input.note !== undefined && input.note !== null && typeof input.note !== "string") {
    return "note must be a string or null";
  }
  if (!optionalVersion(input.expectedVersion)) return "expectedVersion must be a whole number";
  if (!optionalVersion(input.expectedNameVersion)) return "expectedNameVersion must be a whole number";
  if (input.short !== undefined && section !== "places") return "only places have short";
  if (input.variant !== undefined) {
    if (section !== "quests") return "only quest lines have variant";
    if (!Number.isInteger(input.variant) || (input.variant as number) < 0) return "variant must be a whole number";
  }
  return null;
}

function checkedText(input: ItemInput): string | null {
  if (input.text !== undefined) {
    if (typeof input.text !== "string" || !input.text.trim()) return "text must be a string that is not empty";
    if (input.text.length > MAX_TEXT) return `text is at most ${MAX_TEXT} characters`;
  }
  if (input.short !== undefined && input.short !== null) {
    if (typeof input.short !== "string") return "short must be a string or null";
    if (input.short.length > MAX_TEXT) return `short is at most ${MAX_TEXT} characters`;
  }
  return null;
}

async function writeText(
  section: Section,
  context: TokenContext,
  input: ItemInput,
  variant: number,
  note: string | null,
  audit: ApiAudit,
): Promise<FieldResult> {
  const problem = checkedText(input);
  if (problem) return refused(problem);
  const api = sections[section];
  try {
    const before = await api.version(context.lang, input.id, variant);
    const saved = await api.saveText({
      lang: context.lang,
      id: input.id,
      variant,
      text: input.text as string | undefined,
      short: input.short as string | null | undefined,
      note,
      by: context.userId,
      expectedVersion: (input.expectedVersion as number | null | undefined) ?? null,
      audit,
    });
    return {
      status: saved.version === before ? "unchanged" : "updated",
      version: saved.version,
      lines: saved.lines,
    };
  } catch (error) {
    return fieldError(error);
  }
}

async function writeName(
  section: Section,
  context: TokenContext,
  input: ItemInput,
  variant: number,
  note: string | null,
  audit: ApiAudit,
): Promise<FieldResult> {
  if (typeof input.name !== "string" || !input.name.trim()) return refused("name must be a string that is not empty");
  if (input.name.length > MAX_NAME) return refused(`name is at most ${MAX_NAME} characters`);
  try {
    const target = await sections[section].nameTarget(context.lang, input.id, variant);
    if (!target) return refused("this item has no name of its own to write");
    const before = (await nameHistory(target.kind, target.entityId, context.lang)).find((v) => v.isCurrent);
    const saved = await saveName({
      ...target,
      lang: context.lang,
      name: input.name,
      note,
      editedBy: context.userId,
      expectedVersion: (input.expectedNameVersion as number | null | undefined) ?? null,
      audit,
    });
    return {
      status: saved.version === before?.version ? "unchanged" : "updated",
      version: saved.version,
      entity: target,
    };
  } catch (error) {
    return fieldError(error);
  }
}

export async function applyItem(
  section: Section,
  context: TokenContext,
  input: ItemInput,
  known: Set<string>,
  audit: ApiAudit,
): Promise<ItemResult> {
  const problem = shapeError(section, input);
  if (problem) return { id: input.id, error: { code: "invalid", message: problem } };

  const variant = (input.variant as number | undefined) ?? 0;
  const head = { id: input.id, ...(section === "quests" ? { variant } : {}) };
  if (!known.has(keyOf(input.id, variant))) {
    return { ...head, error: { code: "unknown_id", message: `no item ${input.id} in ${section}` } };
  }

  const note = typeof input.note === "string" ? input.note : null;
  return {
    ...head,
    ...(input.text !== undefined || input.short !== undefined
      ? { text: await writeText(section, context, input, variant, note, audit) }
      : {}),
    ...(input.name !== undefined ? { name: await writeName(section, context, input, variant, note, audit) } : {}),
  };
}

function isItem(value: unknown): value is ItemInput {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { id?: unknown }).id === "string" &&
    (value as { id: string }).id !== ""
  );
}

/**
 * A mass update, one item at a time: run together they would take the whole connection pool away
 * from the site. Known ids are asked once, before the first write, since each write moves the
 * stamp the catalogue behind that answer is checked against.
 *
 * The batch row comes first so that a run cut off partway can still be found and undone.
 */
export async function applyItems(
  section: Section,
  context: TokenContext,
  items: unknown[],
  note: string | null,
): Promise<{ batchId: string; results: ItemResult[] }> {
  const wanted = items.filter(isItem).map((item) => ({
    id: item.id,
    variant: Number.isInteger(item.variant) ? (item.variant as number) : 0,
  }));
  const known = await sections[section].known(context.lang, wanted);
  const batchId = await createBatch({
    userId: context.userId,
    tokenId: context.tokenId,
    lang: context.lang,
    section,
    itemCount: items.length,
    note,
  });
  const audit: ApiAudit = { tokenId: context.tokenId, batchId };

  const seen = new Set<string>();
  const results: ItemResult[] = [];
  for (const item of items) {
    if (!isItem(item)) {
      results.push({ id: null, error: { code: "invalid", message: "each item is an object with an id" } });
      continue;
    }
    const key = keyOf(item.id, Number.isInteger(item.variant) ? (item.variant as number) : 0);
    if (seen.has(key)) {
      results.push({
        id: item.id,
        error: { code: "invalid", message: "this item appears twice in the update; only the first was applied" },
      });
      continue;
    }
    seen.add(key);
    results.push(await applyItem(section, context, { note, ...item }, known, audit));
  }
  return { batchId, results };
}

const STATUS: Record<ErrorCode, number> = { conflict: 409, unknown_id: 404, invalid: 400, internal: 500 };

/** A single update's status: the error's, when nothing in it succeeded. */
export function statusOf(result: ItemResult): number {
  if (result.error) return STATUS[result.error.code];
  const fields = [result.text, result.name].filter((field) => field !== undefined);
  const failed = fields.filter((field) => field.status === "error");
  return failed.length === fields.length && failed[0]?.status === "error" ? STATUS[failed[0].code] : 200;
}
