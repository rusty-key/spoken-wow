/**
 * An admin's edits to the roster (migration 0071): the types an NPC can be, their genders and
 * flavors, and the voice each combination is read with. The only writer of those tables.
 *
 * A refusal is a TypesError whose message is shown to the admin as it stands. Every write drops
 * this process's roster cache once it has committed.
 */
import type { PoolClient } from "pg";

import { db } from "@/lib/db";

import { newVoiceName, type Gender } from "./roster";
import { invalidateRoster } from "./roster-store";

export class TypesError extends Error {}

const KEY = /^[a-z0-9]+$/;
const GENDERS: readonly string[] = ["male", "female"];

function key(value: unknown): string {
  if (typeof value !== "string" || !KEY.test(value)) throw new TypesError("Keys are lowercase letters and digits");
  return value;
}

function gender(value: unknown): Gender {
  if (typeof value !== "string" || !GENDERS.includes(value)) throw new TypesError("A gender is male or female");
  return value as Gender;
}

function label(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, 100) : null;
}

async function inTransaction(work: (client: PoolClient) => Promise<void>): Promise<void> {
  const client = await db().connect();
  try {
    await client.query("begin");
    await work(client);
    await client.query("commit");
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
  invalidateRoster();
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
 * Points a combination at `voice`, or at a new voice of its own when `voice` is null. A new
 * voice is named and hashed by the combination itself: md5(text + race + gender).
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
      `insert into "voice" ("name", "race", "gender") values ($1, $2, $3) on conflict do nothing`,
      [name, race, g ?? ""],
    );
  } else if (!(await exists(client, `select 1 from "voice" where "name" = $1`, [name]))) {
    throw new TypesError(`${name} is not a voice`);
  }
  await client.query(
    `insert into "voice_assignment" ("race", "gender", "flavor", "voice") values ($1, $2, $3, $4)
     on conflict ("race", coalesce("gender", ''), coalesce("flavor", '')) do update set "voice" = excluded."voice"`,
    [race, g, flavor, name],
  );
  return name;
}

export async function addType(rawKey: unknown, rawLabel: unknown, rawGenders: unknown): Promise<void> {
  const race = key(rawKey);
  const genders = [...new Set((Array.isArray(rawGenders) ? rawGenders : []).map(gender))];
  await inTransaction(async (client) => {
    if (await exists(client, `select 1 from "race" where "key" = $1`, [race])) {
      throw new TypesError(`${race} is a type already`);
    }
    await client.query(`insert into "race" ("key", "label") values ($1, $2)`, [race, label(rawLabel)]);
    for (const g of genders) {
      await client.query(`insert into "gender" ("race", "gender") values ($1, $2)`, [race, g]);
      await assign(client, race, g, null, null);
    }
    if (!genders.length) await assign(client, race, null, null, null);
  });
}

export async function labelType(rawKey: unknown, rawLabel: unknown): Promise<void> {
  const race = key(rawKey);
  await inTransaction(async (client) => {
    await requireType(client, race);
    await client.query(`update "race" set "label" = $2 where "key" = $1`, [race, label(rawLabel)]);
  });
}

/** Only while no NPC has it. Its voices stay: they may have takes. */
export async function deleteType(rawKey: unknown): Promise<void> {
  const race = key(rawKey);
  await inTransaction(async (client) => {
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

export async function addGender(rawRace: unknown, rawGender: unknown): Promise<void> {
  const race = key(rawRace);
  const g = gender(rawGender);
  await inTransaction(async (client) => {
    await requireType(client, race);
    const gendered = await exists(client, `select 1 from "gender" where "race" = $1`, [race]);
    // A genderless type's NPCs have no gender; one with a gender would need every one answered again.
    if (!gendered && (await exists(client, `select 1 from "npc" where "race" = $1 limit 1`, [race]))) {
      throw new TypesError(`NPCs are ${race} with no gender: it cannot gain one now`);
    }
    if (!gendered) await client.query(`delete from "voice_assignment" where "race" = $1 and "gender" is null`, [race]);
    await client.query(`insert into "gender" ("race", "gender") values ($1, $2) on conflict do nothing`, [race, g]);
    await assign(client, race, g, null, null);
  });
}

export async function addFlavor(rawRace: unknown, rawGender: unknown, rawFlavor: unknown, rawLabel: unknown): Promise<void> {
  const race = key(rawRace);
  const g = rawGender === null || rawGender === "" || rawGender === undefined ? null : gender(rawGender);
  const flavor = key(rawFlavor);
  await inTransaction(async (client) => {
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
    await client.query(`insert into "flavor" ("race", "gender", "flavor", "label") values ($1, $2, $3, $4)`, [
      race, g, flavor, label(rawLabel),
    ]);
    await assign(client, race, g, flavor, null);
  });
}

/** Only while no NPC has it. Its voice stays: it may have takes. */
export async function deleteFlavor(rawRace: unknown, rawGender: unknown, rawFlavor: unknown): Promise<void> {
  const race = key(rawRace);
  const g = rawGender === null || rawGender === "" || rawGender === undefined ? null : gender(rawGender);
  const flavor = key(rawFlavor);
  await inTransaction(async (client) => {
    if (await exists(client, `select 1 from "npc" where "race" = $1 and "gender" is not distinct from $2 and "flavor" = $3 limit 1`, [race, g, flavor])) {
      throw new TypesError(`NPCs speak ${flavor}: give them another flavor first`);
    }
    await client.query(
      `delete from "voice_assignment" where "race" = $1 and "gender" is not distinct from $2 and "flavor" = $3`,
      [race, g, flavor],
    );
    await client.query(`delete from "flavor" where "race" = $1 and "gender" is not distinct from $2 and "flavor" = $3`, [
      race, g, flavor,
    ]);
  });
}

/** `voice` null: a new voice of the combination's own. */
export async function assignVoice(rawRace: unknown, rawGender: unknown, rawFlavor: unknown, rawVoice: unknown): Promise<void> {
  const race = key(rawRace);
  const g = rawGender === null || rawGender === "" || rawGender === undefined ? null : gender(rawGender);
  const flavor = rawFlavor === null || rawFlavor === "" || rawFlavor === undefined ? null : key(rawFlavor);
  const voice = typeof rawVoice === "string" && rawVoice ? rawVoice : null;
  await inTransaction(async (client) => {
    await requireType(client, race);
    await assign(client, race, g, flavor, voice);
  });
}
