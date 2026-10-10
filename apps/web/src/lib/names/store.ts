/**
 * entity_name, written from the site: a translator naming a quest, an NPC, a book's owner
 * or a place in their language. The only module here that writes the table; the catalogues
 * read it, and English is kept in step by trigger (migration 0036), written here only by a
 * moderator's override.
 */
import "server-only";

import { recordActivity } from "@/lib/activity/store";
import { db, query } from "@/lib/db";
import { BASE_LANG, type Lang } from "@/lib/lang";

export const NAME_KINDS = ["quest", "creature", "gameobject", "item", "zone", "subzone"] as const;
export type NameKind = (typeof NAME_KINDS)[number];

export function isNameKind(value: unknown): value is NameKind {
  return typeof value === "string" && (NAME_KINDS as readonly string[]).includes(value);
}

export type NameVersion = {
  version: number;
  isCurrent: boolean;
  origin: "extracted" | "edited" | "contributed" | "community";
  name: string;
  editedBy: string | null;
  note: string | null;
  createdAt: string;
};

type Row = Omit<NameVersion, "createdAt"> & { createdAt: Date };

export class NameConflict extends Error {}
export class NameMissing extends Error {}

export async function nameHistory(kind: NameKind, entityId: string, lang: Lang): Promise<NameVersion[]> {
  const rows = await query<Row>(
    `select "version", "isCurrent", "origin", "name", "editedBy", "note", "createdAt"
       from "entity_name" where "kind" = $1 and "entityId" = $2 and "lang" = $3
      order by "version" desc`,
    [kind, entityId, lang],
  );
  return rows.map((row) => ({ ...row, createdAt: row.createdAt.toISOString() }));
}

/**
 * Name a thing in a language. Only something with an English name can be named, which is
 * what keeps a typo in an id from becoming a row nothing will ever show.
 *
 * `anyLanguage` is a moderator's override of an NPC they are looking at: English too, and no
 * English name needed. An edited English name is one the import's trigger leaves alone.
 */
export async function saveName(args: {
  kind: NameKind;
  entityId: string;
  lang: Lang;
  name: string;
  note?: string | null;
  editedBy: string;
  expectedVersion?: number | null;
  anyLanguage?: boolean;
}): Promise<NameVersion> {
  if (args.lang === BASE_LANG && !args.anyLanguage) {
    throw new Error("English names come from the corpus, not from here");
  }
  const name = args.name.trim();
  if (!name) throw new Error("the name cannot be empty");

  const client = await db().connect();
  try {
    await client.query("begin");
    if (!args.anyLanguage) {
      const { rows: english } = await client.query(
        `select 1 from "entity_name"
          where "kind" = $1 and "entityId" = $2 and "lang" = $3 and "isCurrent"`,
        [args.kind, args.entityId, BASE_LANG],
      );
      if (!english[0]) throw new NameMissing(`${args.kind} ${args.entityId} has no English name`);
    }

    const { rows: currentRows } = await client.query<Row>(
      `select "version", "isCurrent", "origin", "name", "editedBy", "note", "createdAt"
         from "entity_name"
        where "kind" = $1 and "entityId" = $2 and "lang" = $3 and "isCurrent" for update`,
      [args.kind, args.entityId, args.lang],
    );
    const current = currentRows[0];
    if (
      current &&
      args.expectedVersion !== undefined &&
      args.expectedVersion !== null &&
      args.expectedVersion !== current.version
    ) {
      throw new NameConflict(`this name moved to v${current.version} while you were editing it`);
    }
    if (current && current.name === name) {
      await client.query("commit");
      return { ...current, createdAt: current.createdAt.toISOString() };
    }

    await client.query(
      `update "entity_name" set "isCurrent" = false
        where "kind" = $1 and "entityId" = $2 and "lang" = $3 and "isCurrent"`,
      [args.kind, args.entityId, args.lang],
    );
    const { rows } = await client.query<Row>(
      `insert into "entity_name"
         ("kind", "entityId", "lang", "version", "isCurrent", "origin", "name", "editedBy", "note")
       select $1, $2, $3, coalesce(max("version"), 0) + 1, true, 'edited', $4, $5, $6
         from "entity_name" where "kind" = $1 and "entityId" = $2 and "lang" = $3
       returning "version", "isCurrent", "origin", "name", "editedBy", "note", "createdAt"`,
      [args.kind, args.entityId, args.lang, name, args.editedBy, args.note?.trim() || null],
    );
    await recordActivity(
      {
        kind: "name.edited",
        lang: args.lang,
        actorId: args.editedBy,
        subject: `${args.kind}:${args.entityId}`,
        detail: { version: rows[0].version, name, note: rows[0].note },
      },
      client,
    );
    await client.query("commit");
    return { ...rows[0], createdAt: rows[0].createdAt.toISOString() };
  } catch (error) {
    await client.query("rollback").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}
