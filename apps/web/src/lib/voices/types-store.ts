/**
 * An admin's edits to the roster (migration 0071): the types an NPC can be, their genders and
 * flavors, and the voice each combination is read with. The only writer of those tables.
 *
 * A refusal is a TypesError whose message is shown to the admin as it stands.
 *
 * The types, genders and flavors are every team's, and every team has a roster of voices and
 * assignments over them. Every edit changes every team's roster in one transaction
 * (ALL_TEAMS): its statements on voice and voice_assignment reach every team's rows, and each
 * insert writes a row per team. So no team is left with a type it cannot voice, and the rosters
 * stay the one roster they were copied from: a site owner's edit on /enUS/voices still reaches
 * every language. Phase 2 makes the voice assignments each team's own (assignVoice).
 */
import type { PoolClient } from "pg";

import { ALL_TEAMS, withTeam } from "@/lib/db";

import { newVoiceName, type Gender } from "./roster";
import { GENDERS } from "./voices";

export class TypesError extends Error {}

/** An edit of the roster, which every team keeps a copy of: as every team. */
function asEveryRoster<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
  return withTeam(ALL_TEAMS, work);
}

/**
 * A first gender for a genderless type, or a first flavor for a race-gender read by a bare voice,
 * splits a voice NPCs already speak with. Which of the new combinations takes it over -- `map`,
 * its files and takes with it -- or whether it goes unused (`discard`) is the admin's to say, so
 * nothing is written until they have.
 */
export class NeedsChoice extends Error {
  constructor(readonly choice: { voice: string; into: string; npcs: number; lines: number }) {
    super(`${choice.voice} is in use: map it to ${choice.into}, or throw it away`);
  }
}

export type Existing = "map" | "discard";

function existing(value: unknown): Existing | null {
  return value === "map" || value === "discard" ? value : null;
}

/** NPCs of a type, gender and flavor (null meaning none), and the lines they speak. */
async function inUse(
  client: PoolClient,
  race: string,
  g: Gender | null,
  flavorIsNull: boolean,
): Promise<{ npcs: number; lines: number }> {
  const { rows } = await client.query<{ npcs: number; lines: number }>(
    `select count(distinct (n."npcKind", n."npcId"))::int as "npcs", count(distinct s."lineId")::int as "lines"
       from "npc" n
       left join "quest_line_speaker" s on s."npcType" = n."npcKind" and s."npcId" = n."npcId"
      where n."race" = $1 and n."gender" is not distinct from $2 and ($3 = false or n."flavor" is null)`,
    [race, g, flavorIsNull],
  );
  return rows[0];
}

/** The voices the combination is read by, one per team or fewer where teams agree. */
async function ownVoice(client: PoolClient, race: string, g: Gender | null, flavor: string | null): Promise<string | null> {
  const { rows } = await client.query<{ voice: string | null }>(
    `select string_agg(distinct "voice", ', ' order by "voice") as "voice" from "voice_assignment"
      where "race" = $1 and "gender" is not distinct from $2 and "flavor" is not distinct from $3`,
    [race, g, flavor],
  );
  return rows[0]?.voice ?? null;
}

const KEY = /^[a-z0-9]+$/;

function key(value: unknown): string {
  if (typeof value !== "string" || !KEY.test(value)) throw new TypesError("Keys are lowercase letters and digits");
  return value;
}

function gender(value: unknown): Gender {
  if (!GENDERS.includes(value as Gender)) throw new TypesError("A gender is male or female");
  return value as Gender;
}

/** A field that may be left out: absent, null and "" are all "none". */
function optional<T>(value: unknown, parse: (value: unknown) => T): T | null {
  return value === undefined || value === null || value === "" ? null : parse(value);
}

async function exists(client: PoolClient, sql: string, params: unknown[]): Promise<boolean> {
  return ((await client.query(sql, params)).rowCount ?? 0) > 0;
}

async function requireType(client: PoolClient, race: string): Promise<void> {
  if (!(await exists(client, `select 1 from "race" where "key" = $1`, [race]))) {
    throw new TypesError(`${race} is not a type`);
  }
}

/**
 * Points a combination at `voice`, or at a new voice of its own when `voice` is null, in every
 * team. A new voice is named and hashed by the combination itself: md5(text + race + gender).
 */
async function assign(
  client: PoolClient,
  race: string,
  g: Gender | null,
  flavor: string | null,
  voice: string | null,
): Promise<string> {
  let name = voice;
  if (name === null) {
    name = newVoiceName(race, g, flavor);
    await client.query(
      `insert into "voice" ("teamId", "name", "race", "gender")
       select "id", $1, $2, $3 from "team"
       on conflict do nothing`,
      [name, race, g ?? ""],
    );
  } else if (
    await exists(
      client,
      `select 1 from "team" t
        where not exists (select 1 from "voice" v where v."teamId" = t."id" and v."name" = $1)`,
      [name],
    )
  ) {
    throw new TypesError(`${name} is not a voice`);
  }
  await client.query(
    `insert into "voice_assignment" ("teamId", "race", "gender", "flavor", "voice")
     select "id", $1, $2, $3, $4 from "team"
     on conflict ("teamId", "race", coalesce("gender", ''), coalesce("flavor", '')) do update
       set "voice" = excluded."voice"`,
    [race, g, flavor, name],
  );
  return name;
}

export async function addType(rawKey: unknown, rawGenders: unknown): Promise<void> {
  const race = key(rawKey);
  const genders = [...new Set((Array.isArray(rawGenders) ? rawGenders : []).map(gender))];
  await asEveryRoster(async (client) => {
    if (await exists(client, `select 1 from "race" where "key" = $1`, [race])) {
      throw new TypesError(`${race} is a type already`);
    }
    await client.query(`insert into "race" ("key") values ($1)`, [race]);
    for (const g of genders) {
      await client.query(`insert into "gender" ("race", "gender") values ($1, $2)`, [race, g]);
      await assign(client, race, g, null, null);
    }
    if (!genders.length) await assign(client, race, null, null, null);
  });
}

/** Only while no NPC has it. Its voices stay: they may have takes. */
export async function deleteType(rawKey: unknown): Promise<void> {
  const race = key(rawKey);
  await asEveryRoster(async (client) => {
    await requireType(client, race);
    if (await exists(client, `select 1 from "npc" where "race" = $1 limit 1`, [race])) {
      throw new TypesError(`NPCs are ${race}: give them another type first`);
    }
    await client.query(`delete from "voice_assignment" where "race" = $1`, [race]);
    await client.query(`delete from "flavor" where "race" = $1`, [race]);
    await client.query(`delete from "gender" where "race" = $1`, [race]);
    await client.query(`delete from "race" where "key" = $1`, [race]);
  });
}

export async function addGender(rawRace: unknown, rawGender: unknown, rawExisting?: unknown): Promise<void> {
  const race = key(rawRace);
  const g = gender(rawGender);
  const choice = existing(rawExisting);
  await asEveryRoster(async (client) => {
    await requireType(client, race);
    if (await exists(client, `select 1 from "gender" where "race" = $1 and "gender" = $2`, [race, g])) {
      throw new TypesError(`${race} has ${g} already`);
    }
    const gendered = await exists(client, `select 1 from "gender" where "race" = $1`, [race]);
    await client.query(`insert into "gender" ("race", "gender") values ($1, $2)`, [race, g]);
    if (gendered) {
      await assign(client, race, g, null, null);
      return;
    }
    // Every voice the type is read by without a gender, its flavors' included: one mapped into a
    // flavor leaves no bare voice behind, and its NPCs would lose it as surely.
    const { rows } = await client.query<{ voice: string }>(
      `select distinct "voice" from "voice_assignment" where "race" = $1 and "gender" is null order by 1`,
      [race],
    );
    const voice = rows.map((row) => row.voice).join(", ") || null;
    const use = await inUse(client, race, null, false);
    if (voice && use.npcs > 0 && !choice) throw new NeedsChoice({ voice, into: g, ...use });
    if (voice && choice === "map") {
      // The voice, its flavors and its NPCs become the gender's: their files keep their names.
      await client.query(`update "voice_assignment" set "gender" = $2 where "race" = $1 and "gender" is null`, [race, g]);
      await client.query(`update "flavor" set "gender" = $2 where "race" = $1 and "gender" is null`, [race, g]);
      await client.query(`update "npc" set "gender" = $2, "updatedAt" = now() where "race" = $1 and "gender" is null`, [race, g]);
      return;
    }
    // Unused from here: the voice and its takes stay on file, nothing reads with them.
    await client.query(`delete from "voice_assignment" where "race" = $1 and "gender" is null`, [race]);
    await client.query(`delete from "flavor" where "race" = $1 and "gender" is null`, [race]);
    await assign(client, race, g, null, null);
  });
}

export async function addFlavor(
  rawRace: unknown,
  rawGender: unknown,
  rawFlavor: unknown,
  rawExisting?: unknown,
): Promise<void> {
  const race = key(rawRace);
  const g = optional(rawGender, gender);
  const flavor = key(rawFlavor);
  const choice = existing(rawExisting);
  await asEveryRoster(async (client) => {
    await requireType(client, race);
    const gendered = await exists(client, `select 1 from "gender" where "race" = $1`, [race]);
    if (gendered && !g) throw new TypesError(`${race} needs a gender for a flavor`);
    if (!gendered && g) throw new TypesError(`${race} has no gender`);
    if (g && !(await exists(client, `select 1 from "gender" where "race" = $1 and "gender" = $2`, [race, g]))) {
      throw new TypesError(`${race} has no ${g}`);
    }
    if (await exists(client, `select 1 from "flavor" where "race" = $1 and "gender" is not distinct from $2 and "flavor" = $3`, [race, g, flavor])) {
      throw new TypesError(`${flavor} is a flavor of ${race} already`);
    }
    const first = !(await exists(client, `select 1 from "flavor" where "race" = $1 and "gender" is not distinct from $2`, [race, g]));
    const voice = first ? await ownVoice(client, race, g, null) : null;
    const use = voice ? await inUse(client, race, g, true) : { npcs: 0, lines: 0 };
    if (voice && use.npcs > 0 && !choice) throw new NeedsChoice({ voice, into: flavor, ...use });

    await client.query(`insert into "flavor" ("race", "gender", "flavor") values ($1, $2, $3)`, [race, g, flavor]);
    if (voice && choice === "map") {
      await client.query(
        `update "voice_assignment" set "flavor" = $3
          where "race" = $1 and "gender" is not distinct from $2 and "flavor" is null`,
        [race, g, flavor],
      );
      await client.query(
        `update "npc" set "flavor" = $3, "updatedAt" = now()
          where "race" = $1 and "gender" is not distinct from $2 and "flavor" is null`,
        [race, g, flavor],
      );
      return;
    }
    // A race-gender is read by its flavors or by one bare voice, never both.
    if (voice) {
      await client.query(
        `delete from "voice_assignment"
          where "race" = $1 and "gender" is not distinct from $2 and "flavor" is null`,
        [race, g],
      );
    }
    await assign(client, race, g, flavor, null);
  });
}

/** Only while no NPC has it. Its voice stays: it may have takes. */
export async function deleteFlavor(rawRace: unknown, rawGender: unknown, rawFlavor: unknown): Promise<void> {
  const race = key(rawRace);
  const g = optional(rawGender, gender);
  const flavor = key(rawFlavor);
  await asEveryRoster(async (client) => {
    if (await exists(client, `select 1 from "npc" where "race" = $1 and "gender" is not distinct from $2 and "flavor" = $3 limit 1`, [race, g, flavor])) {
      throw new TypesError(`NPCs speak ${flavor}: give them another flavor first`);
    }
    await client.query(
      `delete from "voice_assignment"
        where "race" = $1 and "gender" is not distinct from $2 and "flavor" = $3`,
      [race, g, flavor],
    );
    await client.query(`delete from "flavor" where "race" = $1 and "gender" is not distinct from $2 and "flavor" = $3`, [
      race, g, flavor,
    ]);
  });
}

/**
 * `voice` null: a new voice of the combination's own. In every team's roster, as the types
 * are: one team's own assignment, and the voice it creates, is phase 2's.
 */
export async function assignVoice(
  rawRace: unknown,
  rawGender: unknown,
  rawFlavor: unknown,
  rawVoice: unknown,
): Promise<void> {
  const race = key(rawRace);
  const g = optional(rawGender, gender);
  const flavor = optional(rawFlavor, key);
  const voice = typeof rawVoice === "string" && rawVoice ? rawVoice : null;
  await asEveryRoster(async (client) => {
    await requireType(client, race);
    await assign(client, race, g, flavor, voice);
  });
}
