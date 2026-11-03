import "server-only";

import { momentOf } from "@/lib/contributions/naming";
import { ALL_TEAMS, query, withTeam } from "@/lib/db";
import type { Lang } from "@/lib/lang";
import { restoreName, retireName, type NameKind } from "@/lib/names/store";
import type { Source } from "@/lib/sections";

import { describeError } from "./errors";
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
  field: "text" | "name";
  status: "restored" | "retired" | "skipped";
  reason?: "edited_since" | "gender_split" | "error";
  message?: string;
};

type Outcome = Pick<UndoResult, "status" | "reason">;

type Edit = {
  kind: "text.edited" | "name.edited";
  subject: string;
  detail: { version: number; previous?: number | null; variant?: number; replaces?: string[] };
};

/**
 * As every team: the batch's owner has already been checked, and the language may have moved
 * team or have none since the edits were logged, which must not hide them from the undo.
 */
async function editsOf(batchId: string): Promise<Edit[]> {
  return withTeam(ALL_TEAMS, async (client) => {
    const { rows } = await client.query<Edit>(
      `select "kind", "subject", "detail" - 'text' - 'short' - 'name' - 'note' as "detail" from "activity"
        where "detail" ? 'apiBatchId' and "detail"->>'apiBatchId' = $1
          and "kind" in ('text.edited', 'name.edited')
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

function headOf(section: Source, edit: Edit): Pick<UndoResult, "id" | "variant" | "entity" | "field"> {
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

/** Each edit stands alone, as it did when written: one line that fails must not stop the rest. */
export async function restoreBatch(batch: Batch, by: string): Promise<UndoResult[]> {
  const results: UndoResult[] = [];
  for (const edit of await editsOf(batch.id)) {
    const head = headOf(batch.section, edit);
    try {
      const outcome =
        edit.kind === "name.edited"
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
