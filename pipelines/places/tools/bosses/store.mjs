// The boss tables, read and written.
//
// The one seam for boss_instance, boss and boss_line, and for the 'boss' and 'instance' kinds
// of entity_name. Every language goes through here; there is no file fallback. The pipelines
// that write boss data call requireDatabase first and fail with a message rather than writing
// Lua, since the Lua is now an export of these tables.
//
// Versioning is lore/store.mjs's: text unchanged from the current version records nothing, a
// changed text becomes the new current version, and a tool write never overtakes an 'edited'
// current row -- it lands underneath as a non-current version, once (a re-run that brings the
// same text again records nothing).

import { isEnabled, query, transaction, close } from "../voice/db.mjs";

export { isEnabled, close };

export function requireDatabase(tool) {
  if (!isEnabled()) throw new Error(`${tool} writes the boss tables: set DATABASE_URL`);
}

export async function readInstances() {
  const { rows } = await query(
    `select "map", "kind", "zone", "storyMap", "storyKey", "position"
       from "boss_instance" order by "position", "map"`,
  );
  return rows;
}

/** Ordered by instance position, then boss position. Retired bosses only on request. */
export async function readBosses({ includeRetired = false } = {}) {
  const { rows } = await query(
    `select b."id", b."map", b."key", b."position", b."encounterIds", b."creatureId",
            b."displayId", b."zone", b."retired"
       from "boss" b join "boss_instance" i on i."map" = b."map"
      where $1 or not b."retired"
      order by i."position", i."map", b."position", b."id"`,
    [includeRetired],
  );
  return rows;
}

export async function upsertInstances(rows) {
  await transaction(async (client) => {
    for (const r of rows) {
      await client.query(
        `insert into "boss_instance" ("map", "kind", "zone", "storyMap", "storyKey", "position")
         values ($1, $2, $3, $4, $5, $6)
         on conflict ("map") do update set
           "kind" = excluded."kind", "zone" = excluded."zone", "storyMap" = excluded."storyMap",
           "storyKey" = excluded."storyKey", "position" = excluded."position"`,
        [r.map, r.kind, r.zone, r.storyMap ?? null, r.storyKey ?? null, r.position],
      );
    }
  });
}

/** One transaction. The key is written on insert only: a conflict never changes it. */
export async function writeBosses({ upserts, retire }) {
  await transaction(async (client) => {
    for (const b of upserts) {
      await client.query(
        `insert into "boss"
           ("id", "map", "key", "position", "encounterIds", "creatureId", "displayId", "zone", "retired")
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         on conflict ("id") do update set
           "map" = excluded."map", "position" = excluded."position",
           "encounterIds" = excluded."encounterIds", "creatureId" = excluded."creatureId",
           "displayId" = excluded."displayId", "zone" = excluded."zone",
           "retired" = excluded."retired"`,
        [
          b.id, b.map, b.key, b.position, b.encounterIds,
          b.creatureId ?? null, b.displayId ?? null, b.zone ?? null, b.retired ?? false,
        ],
      );
    }
    if (retire.length > 0) {
      await client.query(`update "boss" set "retired" = true where "id" = any($1::int[])`, [retire]);
    }
  });
}

/** Sets a boss's creature and model by (map, key): 'updated', 'unchanged', or 'missing'. */
export async function setCreature(map, key, creature, display) {
  const { rows } = await query(
    `update "boss" b set "creatureId" = $3::int, "displayId" = $4::int
       from "boss" old
      where b."id" = old."id" and old."map" = $1 and old."key" = $2
      returning (old."creatureId" is distinct from $3::int
                 or old."displayId" is distinct from $4::int) as "changed"`,
    [map, key, creature ?? null, display ?? null],
  );
  if (rows.length === 0) return "missing";
  return rows[0].changed ? "updated" : "unchanged";
}

/**
 * Records one name from the game under the entity_name rules: unchanged records nothing, a
 * changed name replaces an extracted one, and an edited current name stays current.
 */
export async function recordName(kind, entityId, lang, name) {
  return transaction(async (client) => {
    const { rows } = await client.query(
      `select "version", "isCurrent", "origin", "name" from "entity_name"
        where "kind" = $1 and "entityId" = $2 and "lang" = $3
        order by "version" desc`,
      [kind, entityId, lang],
    );
    const current = rows.find((r) => r.isCurrent);
    if (current?.name === name) return "unchanged";

    const edited = current?.origin === "edited";
    // An edit that stands, with the same game name already recorded beneath it.
    if (edited && rows[0].name === name) return "kept-edit";

    const version = (rows[0]?.version ?? 0) + 1;
    if (current && !edited) {
      await client.query(
        `update "entity_name" set "isCurrent" = false
          where "kind" = $1 and "entityId" = $2 and "lang" = $3 and "isCurrent"`,
        [kind, entityId, lang],
      );
    }
    await client.query(
      `insert into "entity_name" ("kind", "entityId", "lang", "version", "isCurrent", "origin", "name")
       values ($1, $2, $3, $4, $5, 'extracted', $6)`,
      [kind, entityId, lang, version, !edited, name],
    );
    return edited ? "kept-edit" : "inserted";
  });
}

/** Current names of one kind, entityId -> lang -> name. */
export async function readNames(kind) {
  const { rows } = await query(
    `select "entityId", "lang", "name" from "entity_name" where "isCurrent" and "kind" = $1`,
    [kind],
  );
  const out = new Map();
  for (const r of rows) {
    if (!out.has(r.entityId)) out.set(r.entityId, new Map());
    out.get(r.entityId).set(r.lang, r.name);
  }
  return out;
}

/**
 * Where each name of one kind stands, entityId -> lang -> { name, origin, latest }: the current
 * name and its origin, and the newest version's name, which is a game name filed under an edit.
 * What recordName would do with a name, without writing it.
 */
export async function readNameState(kind) {
  const { rows } = await query(
    `select distinct on ("entityId", "lang") "entityId", "lang", "name" as "latest",
            (select c."name" from "entity_name" c where c."kind" = e."kind" and c."entityId" = e."entityId"
                and c."lang" = e."lang" and c."isCurrent") as "name",
            (select c."origin" from "entity_name" c where c."kind" = e."kind" and c."entityId" = e."entityId"
                and c."lang" = e."lang" and c."isCurrent") as "origin"
       from "entity_name" e where e."kind" = $1
      order by "entityId", "lang", "version" desc`,
    [kind],
  );
  const out = new Map();
  for (const r of rows) {
    if (!out.has(r.entityId)) out.set(r.entityId, new Map());
    out.get(r.entityId).set(r.lang, { name: r.name, origin: r.origin, latest: r.latest });
  }
  return out;
}

/** Records a story a tool wrote, in any language. See the header for the rules. */
export async function recordStory({ bossId, lang, text, source = null, origin = "rewritten" }) {
  return transaction(async (client) => {
    const { rows } = await client.query(
      `select "version", "isCurrent", "origin", "text" from "boss_line"
        where "bossId" = $1 and "lang" = $2 order by "version" desc`,
      [bossId, lang],
    );
    const current = rows.find((r) => r.isCurrent);
    if (current?.text === text) return "unchanged";

    const edited = current?.origin === "edited";
    if (edited && rows[0].text === text) return "kept-edit";

    const version = (rows[0]?.version ?? 0) + 1;
    if (current && !edited) {
      await client.query(
        `update "boss_line" set "isCurrent" = false
          where "bossId" = $1 and "lang" = $2 and "isCurrent"`,
        [bossId, lang],
      );
    }
    await client.query(
      `insert into "boss_line" ("bossId", "lang", "version", "isCurrent", "origin", "text", "source")
       values ($1, $2, $3, $4, $5, $6, $7)`,
      [bossId, lang, version, !edited, origin, text, source],
    );
    return edited ? "kept-edit" : "inserted";
  });
}

/** Current stories, every language: bossId -> lang -> { text, source, origin }. */
export async function readStories() {
  const { rows } = await query(
    `select "bossId", "lang", "text", "source", "origin" from "boss_line" where "isCurrent"`,
  );
  const out = new Map();
  for (const r of rows) {
    if (!out.has(r.bossId)) out.set(r.bossId, new Map());
    out.get(r.bossId).set(r.lang, { text: r.text, source: r.source, origin: r.origin });
  }
  return out;
}

/** Live boss takes for one language: what the pack's lookup lists. lineId is boss:{map}:{key}. */
export async function readLiveTakes(lang) {
  const { rows } = await query(
    `select "lineId", "file", "durationSec", "wordTimes", "spokenHash" from "take"
      where "source" = 'bosses' and "lang" = $1 and "isCurrent"`,
    [lang],
  );
  return rows;
}
