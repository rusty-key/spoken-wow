// Boss stories as the explorer sees them: one language's versions of one boss's story, and the
// writes that change them.
//
// SERVER ONLY. Each language reads and writes its own boss_line rows; nothing here looks at
// another language's row, so a German save never needs an English story and never copies one.
// Versioning matches recordStory in pipelines/places/tools/bosses/store.mjs: one current row per
// (bossId, lang), the next version is the highest plus one, and an unchanged text records
// nothing.

import "server-only";

import type { PoolClient } from "pg";

import { recordActivity } from "@/lib/activity/store";
import { query, withTeam } from "@/lib/db";
import { ownerOrAll } from "@/lib/teams/store";
import type { Lang } from "@/lib/lang";

/** The line id, which is also the addon's clip key. The key is frozen, so this never moves. */
export function bossLineId(map: number, key: string): string {
  return `boss:${map}:${key}`;
}

/** The map and key a line id names, or null when it is not a boss line. Keys may hold colons. */
export function parseBossLineId(lineId: string): { map: number; key: string } | null {
  const match = /^boss:(-?\d+):(.+)$/.exec(lineId);
  return match ? { map: Number(match[1]), key: match[2] } : null;
}

/** One version of a boss's story in one language. */
export type StoryVersion = {
  lineId: string;
  version: number;
  isCurrent: boolean;
  origin: "rewritten" | "edited";
  text: string;
  source: string | null;
  editedBy: string | null;
  note: string | null;
  createdAt: string;
};

type Row = Omit<StoryVersion, "lineId" | "createdAt"> & { createdAt: Date };

const COLUMNS = `"version", "isCurrent", "origin", "text", "source", "editedBy", "note", "createdAt"`;

function toVersion(lineId: string, row: Row): StoryVersion {
  return { lineId, ...row, createdAt: row.createdAt.toISOString() };
}

export class StoryConflict extends Error {}
export class StoryMissing extends Error {}

/**
 * The id of the live boss a line names, locked for the transaction so two first saves of one
 * language cannot both claim version 1. A retired boss is not listed, so it cannot be edited.
 */
async function lockBoss(client: PoolClient, lineId: string): Promise<number> {
  const parsed = parseBossLineId(lineId);
  const { rows } = parsed
    ? await client.query<{ id: number }>(
        `select "id" from "boss" where "map" = $1 and "key" = $2 and not "retired" for update`,
        [parsed.map, parsed.key],
      )
    : { rows: [] };
  if (!rows[0]) throw new StoryMissing(`${lineId} is not a boss on the site`);
  return rows[0].id;
}

async function bossIdOf(lineId: string): Promise<number | null> {
  const parsed = parseBossLineId(lineId);
  if (!parsed) return null;
  const rows = await query<{ id: number }>(
    `select "id" from "boss" where "map" = $1 and "key" = $2`,
    [parsed.map, parsed.key],
  );
  return rows[0]?.id ?? null;
}

/** Every version of one boss's story in one language, newest first. */
export async function storyHistory(lineId: string, lang: Lang): Promise<StoryVersion[]> {
  const bossId = await bossIdOf(lineId);
  if (bossId === null) return [];
  const rows = await query<Row>(
    `select ${COLUMNS} from "boss_line" where "bossId" = $1 and "lang" = $2 order by "version" desc`,
    [bossId, lang],
  );
  return rows.map((row) => toVersion(lineId, row));
}

/**
 * Saves a person's story as the new live version in its language.
 *
 * `expectedVersion` turns two editors overwriting each other's paragraph into a conflict the
 * second one sees. The source rides along from the version it replaces: an edit of wiki text
 * is a derivative of it, so the attribution follows. A first story in a language has none.
 */
export async function saveStory(args: {
  lang: Lang;
  lineId: string;
  text: string;
  note?: string | null;
  editedBy: string;
  expectedVersion?: number | null;
}): Promise<StoryVersion> {
  const { lang, lineId } = args;
  return withTeam(await ownerOrAll(lang), async (client) => {
    const bossId = await lockBoss(client, lineId);

    const { rows: currentRows } = await client.query<Row>(
      `select ${COLUMNS} from "boss_line" where "bossId" = $1 and "lang" = $2 and "isCurrent"`,
      [bossId, lang],
    );
    const current = currentRows[0];

    if (
      current &&
      args.expectedVersion !== undefined &&
      args.expectedVersion !== null &&
      args.expectedVersion !== current.version
    ) {
      throw new StoryConflict(`this story moved to v${current.version} while you were editing it`);
    }

    const text = args.text.trim();
    if (!text) throw new Error("the text cannot be empty");

    // The history records what the story has been, not who opened the dialog.
    if (current && text === current.text) {
      return toVersion(lineId, current);
    }

    const { rows: maxRows } = await client.query<{ version: number }>(
      `select coalesce(max("version"), 0)::int as "version"
         from "boss_line" where "bossId" = $1 and "lang" = $2`,
      [bossId, lang],
    );
    const version = maxRows[0].version + 1;
    const note = args.note?.trim() || null;

    await client.query(
      `update "boss_line" set "isCurrent" = false where "bossId" = $1 and "lang" = $2 and "isCurrent"`,
      [bossId, lang],
    );
    const { rows: inserted } = await client.query<Row>(
      `insert into "boss_line" ("bossId", "lang", "version", "isCurrent", "origin", "text", "source", "editedBy", "note")
       values ($1, $2, $3, true, 'edited', $4, $5, $6, $7)
       returning ${COLUMNS}`,
      [bossId, lang, version, text, current?.source ?? null, args.editedBy, note],
    );
    await recordActivity(
      {
        kind: "text.edited",
        lang,
        actorId: args.editedBy,
        source: "bosses",
        subject: lineId,
        lineId,
        detail: { version, text, note },
      },
      client,
    );

    return toVersion(lineId, inserted[0]);
  });
}

/**
 * Puts an earlier version back by moving the live flag, as restoring a take does: restoring
 * says which existing text is right rather than writing a new one.
 *
 * `by` is who asked, for the activity log: moving the flag writes nothing that names them.
 */
export async function restoreStory(
  lineId: string,
  version: number,
  lang: Lang,
  by: string | null,
): Promise<StoryVersion> {
  return withTeam(await ownerOrAll(lang), async (client) => {
    const bossId = await lockBoss(client, lineId);

    const { rows } = await client.query<Row>(
      `select ${COLUMNS} from "boss_line" where "bossId" = $1 and "lang" = $2 and "version" = $3`,
      [bossId, lang, version],
    );
    if (!rows[0]) throw new StoryMissing(`${lineId} has no version ${version}`);

    // Two statements: the partial unique index is checked per row, so one statement flipping
    // both would briefly hold two current rows and be refused.
    const { rows: was } = await client.query<{ version: number }>(
      `update "boss_line" set "isCurrent" = false
        where "bossId" = $1 and "lang" = $2 and "isCurrent"
        returning "version"`,
      [bossId, lang],
    );
    const { rows: restored } = await client.query<Row>(
      `update "boss_line" set "isCurrent" = true
        where "bossId" = $1 and "lang" = $2 and "version" = $3
        returning ${COLUMNS}`,
      [bossId, lang, version],
    );
    await recordActivity(
      {
        kind: "text.restored",
        lang,
        actorId: by,
        source: "bosses",
        subject: lineId,
        lineId,
        detail: { version, from: was[0]?.version ?? null },
      },
      client,
    );

    return toVersion(lineId, restored[0]);
  });
}
