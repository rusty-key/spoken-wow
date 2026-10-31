/**
 * Against a real Postgres, because the claims are about which rows a language reads.
 *
 * Every test builds its own instance at map -1 with random keys and ids, and removes it after.
 *
 * Needs DATABASE_URL and migrations applied:
 *   deploy/web/bin/migrate.sh "$PWD/apps/web"
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { closeDb, db } from "@/lib/db";

import { catalogue, instanceFacets, isKnownLine, lineByPath } from "./catalogue";
import { saveStory, StoryConflict, StoryMissing, storyHistory, restoreStory } from "./story";

const MAP = -1;
let tag: string;
let ids: number[];
let userId: string;

/** A boss id no other run shares: negative, so it never meets a real encounter id. */
function freshId(): number {
  return -Math.floor(1e6 + Math.random() * 1e9);
}

async function boss(key: string, position: number, opts: { id?: number; retired?: boolean } = {}) {
  const id = opts.id ?? freshId();
  ids.push(id);
  await db().query(
    `insert into "boss" ("id", "map", "key", "position", "encounterIds", "retired")
     values ($1, $2, $3, $4, $5, $6)`,
    [id, MAP, key, position, [id], opts.retired ?? false],
  );
  return id;
}

async function name(kind: "boss" | "instance", entityId: string, lang: string, value: string) {
  await db().query(
    `insert into "entity_name" ("kind", "entityId", "lang", "version", "isCurrent", "origin", "name")
     values ($1, $2, $3, 1, true, 'extracted', $4)`,
    [kind, entityId, lang, value],
  );
}

async function story(bossId: number, lang: string, text: string) {
  await db().query(
    `insert into "boss_line" ("bossId", "lang", "version", "isCurrent", "origin", "text", "source")
     values ($1, $2, 1, true, 'rewritten', $3, 'test')`,
    [bossId, lang, text],
  );
}

const ofMap = (entries: Awaited<ReturnType<typeof catalogue>>) => entries.filter((e) => e.map === MAP);

beforeAll(async () => {
  userId = `test-bosses-${Math.random().toString(36).slice(2, 10)}`;
  await db().query(
    `insert into "user" ("id", "name", "email", "emailVerified") values ($1, 'Test Bosses', $2, false)`,
    [userId, `${userId}@example.invalid`],
  );
});

beforeEach(async () => {
  tag = Math.random().toString(36).slice(2, 8);
  ids = [];
  await db().query(
    `insert into "boss_instance" ("map", "kind", "zone", "position") values ($1, 'dungeon', 0, -1)`,
    [MAP],
  );
  await name("instance", String(MAP), "enUS", "Test Halls");
});

afterEach(async () => {
  await db().query(`delete from "boss_line" where "bossId" = any($1::int[])`, [ids]);
  await db().query(
    `delete from "entity_name"
      where ("kind" = 'boss' and "entityId" = any($1::text[])) or ("kind" = 'instance' and "entityId" = $2)`,
    [ids.map(String), String(MAP)],
  );
  await db().query(`delete from "boss" where "map" = $1`, [MAP]);
  await db().query(`delete from "boss_instance" where "map" = $1`, [MAP]);
});

afterAll(async () => {
  await db().query(`delete from "activity" where "actorId" = $1`, [userId]);
  await db().query(`delete from "user" where "id" = $1`, [userId]);
  await closeDb();
});

describe("the boss catalogue", () => {
  it("a boss with only an English story has no text on the German catalogue", async () => {
    const id = await boss(`edwin ${tag}`, 0);
    await name("boss", String(id), "enUS", "Edwin VanCleef");
    await name("boss", String(id), "deDE", "Edwin van Cleef");
    await story(id, "enUS", "The leader of the Defias.");

    const [german] = ofMap(await catalogue("deDE"));
    expect(german.text).toBeNull();
    expect(german.hash).toBeNull();
    expect(german.spoken).toBeNull();
    expect(german.name).toBe("Edwin van Cleef");

    const [english] = ofMap(await catalogue("enUS"));
    expect(english.text).toBe("The leader of the Defias.");
    expect(english.hash).not.toBeNull();
  });

  it("a German story with no English row lists in German and not in English", async () => {
    const id = await boss(`rhahkzor ${tag}`, 0);
    await name("boss", String(id), "enUS", "Rhahk'Zor");
    await story(id, "deDE", "Ein Oger.");

    const [german] = ofMap(await catalogue("deDE"));
    expect(german.text).toBe("Ein Oger.");
    expect(german.hash).not.toBeNull();

    const [english] = ofMap(await catalogue("enUS"));
    expect(english.text).toBeNull();
    expect(english.hash).toBeNull();
  });

  it("retired bosses are not listed", async () => {
    const live = await boss(`live ${tag}`, 0);
    await boss(`gone ${tag}`, 1, { retired: true });

    const entries = ofMap(await catalogue("enUS"));
    expect(entries.map((e) => e.bossId)).toEqual([live]);
    expect(await isKnownLine(`boss:${MAP}:gone ${tag}`)).toBe(false);
    expect(await isKnownLine(`boss:${MAP}:live ${tag}`)).toBe(true);
  });

  it("files are {map}/{slug} with the collision suffix, the same on every build", async () => {
    // The second-placed boss holds the lower id: the suffix must follow position, not id.
    const second = await boss(`k-x${tag}`, 1, { id: -2_000_000_001 - Math.floor(Math.random() * 1e6) });
    const first = await boss(`k x${tag}`, 0, { id: -1_000_000 - Math.floor(Math.random() * 1e6) });

    const build = async () =>
      new Map(ofMap(await catalogue("enUS")).map((e) => [e.bossId, e.file]));
    const once = await build();
    // Move the stamp so the next read is a fresh build rather than the memo.
    await story(first, "enUS", "A story.");
    const twice = await build();

    expect(once).toEqual(twice);
    expect(once.get(first)).toBe(`${MAP}/k-x${tag}`);
    expect(once.get(second)).toMatch(new RegExp(`^${MAP}/k-x${tag}-[0-9a-f]{6}$`));

    const entry = await lineByPath(MAP, `k-x${tag}`, "enUS");
    expect(entry?.bossId).toBe(first);
    expect(entry?.id).toBe(`boss:${MAP}:k x${tag}`);
  });

  it("name falls back to English when entity_name has no row in the language", async () => {
    const id = await boss(`mutanus ${tag}`, 0);
    await name("boss", String(id), "enUS", "Mutanus the Devourer");

    const [german] = ofMap(await catalogue("deDE"));
    expect(german.name).toBe("Mutanus the Devourer");
    expect(german.instanceName).toBe("Test Halls");
    expect(german).toMatchObject({ nameMissing: true, englishName: "Mutanus the Devourer" });

    await name("boss", String(id), "deDE", "Mutanus der Verschlinger");
    const [named] = ofMap(await catalogue("deDE"));
    expect(named).toMatchObject({ name: "Mutanus der Verschlinger", nameMissing: false });

    // English is the base: nothing there is missing, as on places.
    const [english] = ofMap(await catalogue("enUS"));
    expect(english.nameMissing).toBeUndefined();
  });

  it("counts each instance's bosses and written stories per language", async () => {
    const a = await boss(`a ${tag}`, 0);
    await boss(`b ${tag}`, 1);
    await story(a, "enUS", "A story.");

    const facet = (await instanceFacets("enUS")).find((f) => f.map === MAP);
    expect(facet).toEqual({ map: MAP, name: "Test Halls", count: 2, written: 1 });
    const german = (await instanceFacets("deDE")).find((f) => f.map === MAP);
    expect(german).toEqual({ map: MAP, name: "Test Halls", count: 2, written: 0 });
  });
});

describe("saving a story", () => {
  it("writes a German story where only English exists, as an edited version 1", async () => {
    const id = await boss(`edwin ${tag}`, 0);
    await story(id, "enUS", "The leader of the Defias.");
    const lineId = `boss:${MAP}:edwin ${tag}`;

    const saved = await saveStory({ lang: "deDE", lineId, text: " Der Anführer. ", editedBy: userId });
    expect(saved).toMatchObject({ version: 1, origin: "edited", text: "Der Anführer.", isCurrent: true });

    const [german] = ofMap(await catalogue("deDE"));
    expect(german.text).toBe("Der Anführer.");
    expect((await storyHistory(lineId, "enUS")).map((v) => v.text)).toEqual(["The leader of the Defias."]);

    const activity = await db().query(
      `select "kind", "source", "lang" from "activity" where "actorId" = $1 and "lineId" = $2`,
      [userId, lineId],
    );
    expect(activity.rows).toEqual([{ kind: "text.edited", source: "bosses", lang: "deDE" }]);
  });

  it("numbers versions from the highest, keeps one current row, and records nothing unchanged", async () => {
    const id = await boss(`edwin ${tag}`, 0);
    await story(id, "enUS", "First.");
    const lineId = `boss:${MAP}:edwin ${tag}`;

    const second = await saveStory({ lang: "enUS", lineId, text: "Second.", editedBy: userId, expectedVersion: 1 });
    expect(second.version).toBe(2);
    const same = await saveStory({ lang: "enUS", lineId, text: "Second.", editedBy: userId, expectedVersion: 2 });
    expect(same.version).toBe(2);

    const history = await storyHistory(lineId, "enUS");
    expect(history.map((v) => [v.version, v.isCurrent, v.origin])).toEqual([
      [2, true, "edited"],
      [1, false, "rewritten"],
    ]);
  });

  it("refuses a save that started from an older version", async () => {
    const id = await boss(`edwin ${tag}`, 0);
    await story(id, "enUS", "First.");
    const lineId = `boss:${MAP}:edwin ${tag}`;
    await saveStory({ lang: "enUS", lineId, text: "Second.", editedBy: userId });

    await expect(
      saveStory({ lang: "enUS", lineId, text: "Third.", editedBy: userId, expectedVersion: 1 }),
    ).rejects.toBeInstanceOf(StoryConflict);
  });

  it("refuses a line that is not a live boss", async () => {
    await boss(`gone ${tag}`, 0, { retired: true });
    for (const lineId of [`boss:${MAP}:gone ${tag}`, `boss:${MAP}:nobody ${tag}`, "s:1411:razor hill"]) {
      await expect(saveStory({ lang: "enUS", lineId, text: "x", editedBy: userId })).rejects.toBeInstanceOf(
        StoryMissing,
      );
    }
  });

  it("restores an earlier version by moving the live flag", async () => {
    const id = await boss(`edwin ${tag}`, 0);
    await story(id, "enUS", "First.");
    const lineId = `boss:${MAP}:edwin ${tag}`;
    await saveStory({ lang: "enUS", lineId, text: "Second.", editedBy: userId });

    const restored = await restoreStory(lineId, 1, "enUS", userId);
    expect(restored).toMatchObject({ version: 1, text: "First.", isCurrent: true });
    expect(ofMap(await catalogue("enUS"))[0].text).toBe("First.");
    await expect(restoreStory(lineId, 9, "enUS", userId)).rejects.toBeInstanceOf(StoryMissing);
  });
});
