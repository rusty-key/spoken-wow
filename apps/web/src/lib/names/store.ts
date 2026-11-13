/**
 * entity_name, written from the site: a translator naming a quest, an NPC, a book's owner,
 * a place or a boss in their language. The only module here that writes the table; the catalogues
 * read it, and English is kept in step by trigger (migration 0036), written here only by a
 * moderator's override.
 */
import "server-only";

import type { PoolClient } from "pg";

import { auditDetail, type ApiAudit } from "@/lib/activity/kinds";
import { recordActivity } from "@/lib/activity/store";
import { query, withTeam } from "@/lib/db";
import { ownerOrAll } from "@/lib/teams/store";
import { BASE_LANG, type Lang } from "@/lib/lang";

/** A boss is named by its id as text; instances have no rename control, so no kind here. */
export const NAME_KINDS = ["quest", "creature", "gameobject", "item", "zone", "subzone", "boss"] as const;
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
  audit?: ApiAudit;
}): Promise<NameVersion & { wrote: boolean }> {
  if (!args.anyLanguage) refuseEnglish(args.lang);
  const name = args.name.trim();
  if (!name) throw new Error("the name cannot be empty");

  return withTeam(await ownerOrAll(args.lang), async (client) => {
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
      return { ...current, createdAt: current.createdAt.toISOString(), wrote: false };
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
        detail: {
          version: rows[0].version,
          name,
          note: rows[0].note,
          ...auditDetail(args.audit, current?.version ?? null),
        },
      },
      client,
    );
    return { ...rows[0], createdAt: rows[0].createdAt.toISOString(), wrote: true };
  });
}

function refuseEnglish(lang: Lang): void {
  if (lang === BASE_LANG) throw new Error("English names come from the corpus, not from here");
}

async function leaveCurrent(
  client: PoolClient,
  kind: NameKind,
  entityId: string,
  lang: Lang,
  version: number,
): Promise<void> {
  const { rowCount } = await client.query(
    `update "entity_name" set "isCurrent" = false
      where "kind" = $1 and "entityId" = $2 and "lang" = $3 and "version" = $4 and "isCurrent"`,
    [kind, entityId, lang, version],
  );
  if (!rowCount) throw new NameConflict(`${kind} ${entityId} v${version} is not the current name`);
}

/** Moves the live flag back to `version`, as long as `from` still holds it. */
export async function restoreName(
  kind: NameKind,
  entityId: string,
  lang: Lang,
  version: number,
  from: number,
  by: string | null,
): Promise<void> {
  refuseEnglish(lang);
  return withTeam(await ownerOrAll(lang), async (client) => {
    // Two statements: the partial unique index is checked per row, so one statement flipping
    // both would briefly hold two current rows and be refused.
    await leaveCurrent(client, kind, entityId, lang, from);
    const { rowCount: back } = await client.query(
      `update "entity_name" set "isCurrent" = true
        where "kind" = $1 and "entityId" = $2 and "lang" = $3 and "version" = $4`,
      [kind, entityId, lang, version],
    );
    if (!back) throw new NameMissing(`${kind} ${entityId} has no version ${version}`);
    await recordActivity(
      { kind: "name.restored", lang, actorId: by, subject: `${kind}:${entityId}`, detail: { version, from } },
      client,
    );
  });
}

/** Takes a first name back, so the English shows again. A site translator cannot do this. */
export async function retireName(
  kind: NameKind,
  entityId: string,
  lang: Lang,
  version: number,
  by: string | null,
): Promise<void> {
  refuseEnglish(lang);
  return withTeam(await ownerOrAll(lang), async (client) => {
    await leaveCurrent(client, kind, entityId, lang, version);
    await recordActivity(
      { kind: "name.retired", lang, actorId: by, subject: `${kind}:${entityId}`, detail: { version } },
      client,
    );
  });
}
