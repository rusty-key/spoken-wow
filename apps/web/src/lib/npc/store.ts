/**
 * The only module that knows the npc table's column names, as lib/contributions/store.ts is for
 * contributions. One row per NPC, read for every line it speaks (migration 0070); its name is
 * per language, in entity_name.
 *
 * Every read and write takes the kind as well as the id. The pair is the key, because the two
 * id spaces overlap and a bare id would merge a Stormwind City Guard with a Wanted Poster.
 */
import { db } from "@/lib/db";
import { BASE_LANG, type Lang } from "@/lib/lang";
import { saveName } from "@/lib/names/store";

// Defined in npc.ts, which is free of node imports -- see its own docstring for why that
// split exists (ContributionTable.tsx, a client component, needs PROVENANCES as a value, and
// importing one out of a module that reaches for `@/lib/db` fails the client build). Imported
// (not just re-exported) so this file can still use them as it always did, and re-exported so
// every existing import of these from this module keeps working unchanged.
import { NPC_KINDS, NPC_ROW_KINDS, PROVENANCES, isProvenance, type NpcKind, type NpcRowKind, type Provenance } from "./npc";

export { NPC_KINDS, NPC_ROW_KINDS, PROVENANCES, isProvenance };
export type { NpcKind, NpcRowKind, Provenance };

export type NpcResolution = {
  npcKind: NpcRowKind;
  npcId: number;
  /** English where English names it, otherwise whichever language does. */
  npcName: string | null;
  race: string | null;
  gender: string | null;
  flavor: string | null;
  provenance: Provenance;
  confirmed: boolean;
  /** A moderator's answer flagged for a later look (migration 0054). Still confirmed. */
  doubtful: boolean;
  modelFileId: number | null;
  sex: number | null;
  creatureType: string | null;
  build: string | null;
  note: string | null;
  resolvedBy: string | null;
  updatedAt: string;
};

/** The language an NPC's shown name is in: English where English names it. */
const NAME = `(select e."name" from "entity_name" e
                where e."kind" = n."npcKind" and e."entityId" = n."npcId"::text and e."isCurrent"
                order by e."lang" <> '${BASE_LANG}', e."lang" limit 1)`;

const COLUMNS = `n."npcKind", n."npcId", ${NAME} as "npcName", n."race", n."gender", n."flavor",
                 n."provenance", n."confirmed", n."doubtful", n."modelFileId", n."sex",
                 n."creatureType", n."build", n."note", n."resolvedBy", n."updatedAt"::text`;

export async function getResolution(kind: NpcRowKind, npcId: number): Promise<NpcResolution | null> {
  const { rows } = await db().query<NpcResolution>(
    `select ${COLUMNS} from "npc" n where n."npcKind" = $1 and n."npcId" = $2`,
    [kind, npcId],
  );
  return rows[0] ?? null;
}

// Provenance is a rank, not a set of equally-trusted labels: a submission carrying less
// information must never erase one carrying more. `moderator` outranks everything because a
// person decided; `corpus` outranks `client` because it is exact, flavor included; `display`
// sits between them, because it is the game's own voice set for the appearance the player saw
// and so beats a model guess, but the corpus is the older authority for every NPC it carries;
// `client` outranks `none` because a mapped model id is still an observation where a bare
// envelope is none at all. The ranks are npc_provenance_rank (migration 0070), which must change
// with the npc_provenance_check constraint.

/**
 * `nameLang` is the language `npcName` is in, English unless said otherwise: a contribution's
 * NPC is named in the client's language, and saving that as English would show it on every
 * English page.
 */
export async function upsertResolution(
  input: Omit<NpcResolution, "updatedAt"> & { nameLang?: Lang },
): Promise<NpcResolution> {
  // The `where` compares ranks rather than special-casing `moderator`: without it, a `none`
  // write from an older addon that sends no model at all would wipe a `client` or `corpus`
  // row's race back to null, and `client` would freely overwrite `corpus`'s exact answer.
  // Equal rank still updates (`>=`), so a fresh corpus read can refresh a name and a second
  // moderator edit still lands. An answer identical to the stored one is skipped, so it leaves
  // updatedAt, and with it every catalogue's stamp, alone. A skipped update returns no row -- `do update ... where` makes
  // the row a no-op, not a match failure -- so the read-back below is what keeps this
  // function's return type honest in that case.
  await db().query(
    `insert into "npc" as n
       ("npcKind", "npcId", "race", "gender", "flavor", "provenance", "confirmed",
        "doubtful", "modelFileId", "sex", "creatureType", "build", "note", "resolvedBy")
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
     on conflict ("npcKind", "npcId") do update
       set "race" = excluded."race",
           "gender" = excluded."gender",
           "flavor" = excluded."flavor",
           "provenance" = excluded."provenance",
           "confirmed" = excluded."confirmed",
           "doubtful" = excluded."doubtful",
           "modelFileId" = excluded."modelFileId",
           "sex" = excluded."sex",
           "creatureType" = excluded."creatureType",
           "build" = excluded."build",
           "note" = excluded."note",
           "resolvedBy" = excluded."resolvedBy",
           "updatedAt" = now()
       where "npc_provenance_rank"(n."provenance") <= "npc_provenance_rank"(excluded."provenance")
         and (n."race", n."gender", n."flavor", n."provenance", n."confirmed", n."doubtful",
              n."modelFileId", n."sex", n."creatureType", n."build", n."note", n."resolvedBy")
             is distinct from
             (excluded."race", excluded."gender", excluded."flavor", excluded."provenance",
              excluded."confirmed", excluded."doubtful", excluded."modelFileId", excluded."sex",
              excluded."creatureType", excluded."build", excluded."note", excluded."resolvedBy")`,
    [
      input.npcKind, input.npcId, input.race, input.gender, input.flavor,
      input.provenance, input.confirmed, input.doubtful, input.modelFileId, input.sex, input.creatureType,
      input.build, input.note, input.resolvedBy,
    ],
  );
  if (input.npcName?.trim()) {
    await nameIfUnnamed(input.npcKind, input.npcId, input.npcName.trim(), input.nameLang ?? BASE_LANG);
  }

  // Read back either way: a write the `where` turned into a no-op means the row on disk
  // outranks this submission or already is it, and that row is the answer.
  const stored = await getResolution(input.npcKind, input.npcId);
  if (!stored) throw new Error(`upsertResolution: no row for ${input.npcKind}/${input.npcId}`);
  return stored;
}

/**
 * A moderator's name for an NPC, over whatever is there, in `lang`: the language their rights
 * were checked in, English included.
 */
export async function renameNpc(kind: NpcRowKind, npcId: number, name: string, editedBy: string, lang: Lang): Promise<void> {
  await saveName({ kind, entityId: String(npcId), lang, name, editedBy, anyLanguage: true });
}

/**
 * An NPC's name as a contribution gave it, where its language has no name yet.
 * As 'contributed', so the extract's own name, when it comes, promotes over it.
 */
async function nameIfUnnamed(kind: NpcRowKind, npcId: number, name: string, lang: Lang): Promise<void> {
  await db().query(
    `insert into "entity_name" ("kind", "entityId", "lang", "version", "isCurrent", "origin", "name")
     select $1, $2, $4, 1, true, 'contributed', $3
      where not exists (select 1 from "entity_name"
                         where "kind" = $1 and "entityId" = $2 and "lang" = $4)
     on conflict do nothing`,
    [kind, String(npcId), name, lang],
  );
}

/**
 * Every resolution row for any of the given ids, in either kind, grouped by id.
 *
 * An id-only lookup is safe to *read*: it does not guess anything, it just hands back whatever
 * rows already exist so a caller can see whether the id is ambiguous (a creature and a
 * gameobject sharing a number) before deciding what, if anything, to show. It is not safe to
 * *write* through -- picking one of two rows to update, or inserting a fresh one, would be
 * exactly the guess resolveNpc's own docstring refuses to make, silently filing one entity's
 * data under the other's number. So this stays read-only sugar for display; every write in
 * this module keeps requiring a kind, and this function must never be used to choose one.
 */
export async function getResolutionsById(npcIds: number[]): Promise<Map<number, NpcResolution[]>> {
  if (npcIds.length === 0) return new Map();

  const { rows } = await db().query<NpcResolution>(
    `select ${COLUMNS} from "npc" n where n."npcId" = any($1::int[]) and n."npcKind" <> 'item'`,
    [npcIds],
  );
  const grouped = new Map<number, NpcResolution[]>();
  for (const row of rows) {
    const list = grouped.get(row.npcId) ?? [];
    list.push(row);
    grouped.set(row.npcId, list);
  }
  return grouped;
}

/** The map key getResolutions returns rows under -- the same pair getResolution takes, joined. */
export function resolutionKey(npcKind: NpcRowKind, npcId: number): string {
  return `${npcKind}:${npcId}`;
}

/**
 * getResolution, batched.
 *
 * The export walks every accepted row and each one may name an NPC, so a caller that looked
 * each one up individually would issue one round trip per row rather than one for the whole
 * export. The parallel-unnest join is what buys that: two arrays in, matched pairwise against
 * the table's own two-column key, in a single query.
 */
export async function getResolutions(
  keys: { npcKind: NpcKind; npcId: number }[],
): Promise<Map<string, NpcResolution>> {
  if (keys.length === 0) return new Map();

  const { rows } = await db().query<NpcResolution>(
    `select ${COLUMNS} from "npc" n
      where exists (
        select 1 from unnest($1::text[], $2::int[]) as pairs("npcKind", "npcId")
         where n."npcKind" = pairs."npcKind" and n."npcId" = pairs."npcId"
      )`,
    [keys.map((key) => key.npcKind), keys.map((key) => key.npcId)],
  );
  return new Map(rows.map((row) => [resolutionKey(row.npcKind, row.npcId), row]));
}

/**
 * Every NPC on file, for /npcs: every one the extract carries and every one a contribution
 * named, items included -- an item starts quests, and its type picks who reads them.
 */
export async function listResolutions(): Promise<NpcResolution[]> {
  const { rows } = await db().query<NpcResolution>(
    `select ${COLUMNS} from "npc" n order by n."npcId", n."npcKind"`,
  );
  return rows;
}

/**
 * Every NPC of a kind that nobody has settled: no answer at all, or only a guess.
 *
 * What /contributions/game-data asks the client about. The unconfirmed index covers it.
 */
export async function listUnconfirmed(kind: NpcKind): Promise<NpcResolution[]> {
  const { rows } = await db().query<NpcResolution>(
    `select ${COLUMNS} from "npc" n
      where n."confirmed" = false and n."npcKind" = $1
      order by n."npcId"`,
    [kind],
  );
  return rows;
}
