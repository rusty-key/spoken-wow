/**
 * Names players' clients show, offered to translators, against a real Postgres: what counts as
 * already shown lives in the query.
 *
 * Needs DATABASE_URL and migrations applied.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { Sighting } from "@/lib/contributions/sighting";
import { closeDb } from "@/lib/db";
import { asSystem, testUser } from "@/lib/teams/testing";

import {
  acceptObservedName,
  countObservedNames,
  listObservedNames,
  recordObservedNames,
  rejectObservedName,
  reopenObservedName,
} from "./observed";

// Ids far above any real creature's, so the rows are this test's alone.
const alba = 990_000_201;
const nobody = 990_000_202;
const ids = [String(alba), String(nobody)];

let user: { id: string; cleanup: () => Promise<void> };

const seen = (name: string | null, locale: string | null = "esMX", npcId = alba): Sighting => ({
  npcType: "creature",
  npcId,
  zones: [1411],
  locale,
  name,
});

async function nameVersion(lang: string, version: number, origin: string, name: string, current: boolean) {
  await asSystem.query(
    `insert into "entity_name" ("kind", "entityId", "lang", "version", "isCurrent", "origin", "name")
     values ('creature', $1, $2, $3, $4, $5, $6)`,
    [String(alba), lang, version, current, origin, name],
  );
}

async function versions() {
  const { rows } = await asSystem.query<{ version: number; origin: string; name: string; isCurrent: boolean }>(
    `select "version", "origin", "name", "isCurrent" from "entity_name"
      where "kind" = 'creature' and "entityId" = $1 and "lang" = 'esMX' order by "version"`,
    [String(alba)],
  );
  return rows;
}

const waiting = async () => (await listObservedNames("esMX", "new")).filter((row) => ids.includes(row.entityId));

beforeAll(async () => {
  user = await testUser("observed-names");
});

beforeEach(async () => {
  await nameVersion("enUS", 1, "extracted", "Alba Fairmoon", true);
});

afterEach(async () => {
  await asSystem.query(`delete from "name_contribution" where "entityId" = any($1::text[])`, [ids]);
  await asSystem.query(`delete from "entity_name" where "kind" = 'creature' and "entityId" = any($1::text[])`, [ids]);
  await asSystem.query(`delete from "activity" where "actorId" = $1`, [user.id]);
});

afterAll(async () => {
  await user.cleanup();
  await closeDb();
});

describe("a name a player's client shows", () => {
  it("is offered where the language has no name yet", async () => {
    expect(await recordObservedNames([seen("Alba Lunaclara")], "user:a")).toBe(1);
    expect(await waiting()).toMatchObject([
      { entityId: String(alba), name: "Alba Lunaclara", english: "Alba Fairmoon", currentName: null, uploaders: 1 },
    ]);
  });

  it("is not offered where the current name already matches, whoever wrote it", async () => {
    await nameVersion("esMX", 1, "extracted", "Alba la vieja", false);
    await nameVersion("esMX", 2, "edited", "Alba Lunaclara", true);
    expect(await recordObservedNames([seen("Alba Lunaclara")], "user:a")).toBe(0);
    expect(await waiting()).toEqual([]);
  });

  it("is offered where the game renamed the current name", async () => {
    await nameVersion("esMX", 1, "extracted", "Alba la vieja", true);
    await recordObservedNames([seen("Alba Lunaclara")], "user:a");
    expect(await waiting()).toMatchObject([{ name: "Alba Lunaclara", currentName: "Alba la vieja" }]);
  });

  it("counts each uploader once", async () => {
    await recordObservedNames([seen("Alba Lunaclara")], "user:a");
    expect(await recordObservedNames([seen("Alba Lunaclara")], "user:a")).toBe(0);
    await recordObservedNames([seen("Alba Lunaclara")], "install:b");
    expect(await waiting()).toMatchObject([{ uploaders: 2 }]);
  });

  it("leaves out English, an old addon's sighting, and an NPC with no English name", async () => {
    expect(
      await recordObservedNames(
        [seen("Alba"), seen("Alba", "enUS"), seen("Alba", "enGB"), seen(null), seen("Alba", null), seen("Nadie", "esMX", nobody)],
        "user:a",
      ),
    ).toBe(1);
    expect((await waiting()).map((row) => row.name)).toEqual(["Alba"]);
  });

  it("becomes the current name once kept, over a translator's edit too", async () => {
    await nameVersion("esMX", 1, "extracted", "Alba la vieja", false);
    await nameVersion("esMX", 2, "edited", "Alba la viéja", true);
    await recordObservedNames([seen("Alba Lunaclara")], "user:a");
    const [row] = await waiting();
    expect(await acceptObservedName(row.id, "esMX", user.id)).toEqual({ ok: true });
    expect((await versions()).at(-1)).toEqual({ version: 3, origin: "observed", name: "Alba Lunaclara", isCurrent: true });
    expect(await waiting()).toEqual([]);
    expect((await listObservedNames("esMX", "accepted")).find((r) => r.id === row.id)).toMatchObject({
      currentName: "Alba Lunaclara",
    });
  });

  it("stays dropped when sent again, until reopened", async () => {
    await recordObservedNames([seen("Alba Lunaclara")], "user:a");
    const [row] = await waiting();
    const before = await countObservedNames("esMX");
    await rejectObservedName(row.id, "esMX", user.id);
    await recordObservedNames([seen("Alba Lunaclara")], "user:b");
    expect(await waiting()).toEqual([]);
    expect(await countObservedNames("esMX")).toBe(before - 1);
    expect(await reopenObservedName(row.id, "esMX")).toEqual({ ok: true });
    expect(await waiting()).toMatchObject([{ id: row.id, uploaders: 2 }]);
  });

  it("is kept once, however often Keep is clicked", async () => {
    await recordObservedNames([seen("Alba Lunaclara")], "user:a");
    const [row] = await waiting();
    const [first, second] = await Promise.all([
      acceptObservedName(row.id, "esMX", user.id),
      acceptObservedName(row.id, "esMX", user.id),
    ]);
    expect([first, second]).toContainEqual({ ok: true });
    expect([first, second]).toContainEqual({ ok: false, reason: "not-found" });
    expect(await versions()).toEqual([{ version: 1, origin: "observed", name: "Alba Lunaclara", isCurrent: true }]);
  });

  it("keeps two rival names at once without both taking the same version", async () => {
    await recordObservedNames([seen("Alba Lunaclara"), seen("Alba Luna Clara")], "user:a");
    const rows = await waiting();
    const outcomes = await Promise.all(rows.map((row) => acceptObservedName(row.id, "esMX", user.id)));
    expect(outcomes).toEqual([{ ok: true }, { ok: true }]);
    expect((await versions()).map((v) => [v.version, v.isCurrent])).toEqual([
      [1, false],
      [2, true],
    ]);
  });

  it("is decided only in its own language", async () => {
    await recordObservedNames([seen("Alba Lunaclara")], "user:a");
    const [row] = await waiting();
    expect(await acceptObservedName(row.id, "frFR", user.id)).toEqual({ ok: false, reason: "not-found" });
    expect(await rejectObservedName(row.id, "frFR", user.id)).toEqual({ ok: false, reason: "not-found" });
  });
});
