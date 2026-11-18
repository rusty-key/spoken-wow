import "server-only";

import { fileIndex } from "@/lib/audio";
import { momentOf } from "@/lib/contributions/naming";
import { ALL_TEAMS, query, withTeam, type TeamId } from "@/lib/db";
import type { Lang } from "@/lib/lang";
import { restoreName, retireName, type NameKind } from "@/lib/names/store";
import { clearOverride, readOverrides, writeOverride } from "@/lib/quests/overrides";
import type { Source } from "@/lib/sections";
import { asTeam } from "@/lib/teams/acting";
import { readTextOverrides } from "@/lib/text-overrides/store";

import { describeError } from "./errors";
import type { Layer } from "./guard";
import { sections } from "./index";
import type { NameTarget } from "./types";

export async function createBatch(args: {
  userId: string;
  tokenId: string;
  lang: Lang;
  section: Source;
  itemCount: number;
  note: string | null;
}): Promise<string> {
  const rows = await query<{ id: string }>(
    `insert into "api_batch" ("userId", "tokenId", "lang", "section", "itemCount", "note")
     values ($1, $2, $3, $4, $5, $6)
     returning "id"`,
    [args.userId, args.tokenId, args.lang, args.section, args.itemCount, args.note],
  );
  return rows[0].id;
}

type Batch = {
  id: string;
  userId: string;
  lang: Lang;
  section: Source;
  itemCount: number;
  note: string | null;
  createdAt: string;
};

type BatchRow = Omit<Batch, "createdAt"> & { createdAt: Date };

const toBatch = ({ createdAt, ...row }: BatchRow): Batch => ({ ...row, createdAt: createdAt.toISOString() });

const COLUMNS = `"id", "userId", "lang", "section", "itemCount", "note", "createdAt"`;

export async function getBatch(id: string): Promise<Batch | null> {
  const rows = await query<BatchRow>(`select ${COLUMNS} from "api_batch" where "id" = $1`, [id]);
  return rows[0] ? toBatch(rows[0]) : null;
}

export async function listBatches(userId: string, lang: Lang): Promise<Batch[]> {
  const rows = await query<BatchRow>(
    `select ${COLUMNS} from "api_batch"
      where "userId" = $1 and "lang" = $2
      order by "createdAt" desc, "id"
      limit 50`,
    [userId, lang],
  );
  return rows.map(toBatch);
}

type UndoResult = {
  /** The line id, or for a name the entity id: a name belongs to its entity, not to one line. */
  id: string;
  variant?: number;
  entity?: NameTarget;
  field: "text" | "name" | "override";
  status: "restored" | "retired" | "skipped";
  reason?: "edited_since" | "gender_split" | "not_allowed" | "error";
  message?: string;
};

type Outcome = Pick<UndoResult, "status" | "reason">;

type Edit = {
  kind: "text.edited" | "name.edited" | "override.set" | "override.cleared";
  source: Source;
  /** The line id, or for a name its entity, or for a quest override its file. */
  subject: string;
  lineId: string | null;
  teamId: TeamId | null;
  detail: { version: number; previous?: number | null; variant?: number; replaces?: string[] };
  /** An override's text before the edit and after it, null where there was none. */
  before: string | null;
  after: string | null;
};

const isOverride = (edit: Edit) => edit.kind === "override.set" || edit.kind === "override.cleared";

/**
 * As every team: the batch's owner has already been checked, and the language may have moved
 * team or have none since the edits were logged, which must not hide them from the undo.
 */
async function editsOf(batchId: string): Promise<Edit[]> {
  return withTeam(ALL_TEAMS, async (client) => {
    const { rows } = await client.query<Edit>(
      `select "kind", "source", "subject", "lineId", "teamId",
              "detail" - 'text' - 'short' - 'name' - 'note' - 'before' as "detail",
              "detail"->>'before' as "before", "detail"->>'text' as "after"
         from "activity"
        where "detail" ? 'apiBatchId' and "detail"->>'apiBatchId' = $1
          and "kind" in ('text.edited', 'name.edited', 'override.set', 'override.cleared')
        order by "id" desc`,
      [batchId],
    );
    return rows;
  });
}

function nameTargetOf(edit: Edit): NameTarget {
  const at = edit.subject.indexOf(":");
  return { kind: edit.subject.slice(0, at) as NameKind, entityId: edit.subject.slice(at + 1) };
}

type Head = Pick<UndoResult, "id" | "variant" | "entity" | "field">;

/** A quest override is logged by file; its line and variant are the corpus's line for it. */
async function headOf(lang: Lang, section: Source, edit: Edit): Promise<Head> {
  if (isOverride(edit)) {
    if (edit.source !== "quests") return { id: edit.subject, field: "override" };
    const line = (await fileIndex(lang)).get(edit.subject);
    return { id: edit.lineId ?? edit.subject, variant: line?.variant ?? 0, field: "override" };
  }
  if (edit.kind === "name.edited") {
    const entity = nameTargetOf(edit);
    return { id: entity.entityId, entity, field: "name" };
  }
  return { id: edit.subject, ...(section === "quests" ? { variant: edit.detail.variant ?? 0 } : {}), field: "text" };
}

async function undoText(section: Source, lang: Lang, edit: Edit, by: string): Promise<Outcome> {
  const api = sections[section];
  const id = edit.subject;
  const { version, previous = null, replaces } = edit.detail;
  const variant = edit.detail.variant ?? 0;

  // A moment is one plain line or two gendered ones, and moving the flag on one line cannot turn
  // it back into the other shape.
  if (replaces?.length || (previous === null && momentOf(id) !== id)) {
    return { status: "skipped", reason: "gender_split" };
  }
  if ((await api.version(lang, id, variant)) !== version) {
    return { status: "skipped", reason: "edited_since" };
  }
  if (previous === null) {
    await api.retire(lang, id, variant, version, by);
    return { status: "retired" };
  }
  await api.restore(lang, id, variant, previous, by);
  return { status: "restored" };
}

/** Either write refuses a name no longer at `version`, which restoreBatch reports as edited since. */
async function undoName(lang: Lang, edit: Edit, by: string): Promise<Outcome> {
  const { kind, entityId } = nameTargetOf(edit);
  const { version, previous = null } = edit.detail;
  if (previous === null) {
    await retireName(kind, entityId, lang, version, by);
    return { status: "retired" };
  }
  await restoreName(kind, entityId, lang, previous, version, by);
  return { status: "restored" };
}

/** The acting team's override on the edit's line, null where it has none. */
async function currentOverride(lang: Lang, edit: Edit): Promise<string | null> {
  if (edit.source === "quests") return (await readOverrides(lang)).get(edit.subject)?.text ?? null;
  return (await readTextOverrides(edit.source, lang)).get(edit.subject)?.text ?? null;
}

/**
 * In the team that made the edit, which for a site owner undoing a second team's batch is not
 * their own. The write back carries no batch, as an original restore does not.
 */
async function undoOverride(lang: Lang, edit: Edit, by: string): Promise<Outcome> {
  return asTeam(lang, edit.teamId, async () => {
    if ((await currentOverride(lang, edit)) !== edit.after) return { status: "skipped", reason: "edited_since" };
    const { before } = edit;
    if (edit.source === "quests") {
      if (before === null) await clearOverride(lang, edit.subject, by);
      else await writeOverride(lang, edit.subject, edit.lineId ?? edit.subject, before, by);
    } else {
      // Through the section, which reads the original the override's drift hash is taken from.
      const args = { lang, id: edit.subject, variant: 0, text: before, by, expectedVersion: null };
      await sections[edit.source].saveOverride(args);
    }
    return { status: before === null ? "retired" : "restored" };
  });
}

/**
 * Each edit stands alone, as it did when written: one line that fails must not stop the rest.
 * `layers` are what the caller may write now: an edit to a layer they may not is skipped, so
 * an undo never writes what a write would be refused.
 */
export async function restoreBatch(batch: Batch, by: string, layers: Record<Layer, boolean>): Promise<UndoResult[]> {
  const results: UndoResult[] = [];
  for (const edit of await editsOf(batch.id)) {
    const head = await headOf(batch.lang, batch.section, edit);
    if (!layers[isOverride(edit) ? "override" : "original"]) {
      results.push({ ...head, status: "skipped", reason: "not_allowed" });
      continue;
    }
    try {
      const outcome = isOverride(edit)
        ? await undoOverride(batch.lang, edit, by)
        : edit.kind === "name.edited"
          ? await undoName(batch.lang, edit, by)
          : await undoText(batch.section, batch.lang, edit, by);
      results.push({ ...head, ...outcome });
    } catch (error) {
      const { code, message } = describeError(error);
      results.push({ ...head, status: "skipped", reason: code === "conflict" ? "edited_since" : "error", message });
    }
  }
  return results;
}
