/**
 * An admin's edits to the types an NPC can be and the voice each is read with.
 *
 * Needs DATABASE_URL and migrations applied.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/lib/db";
import { loadRoster } from "@/lib/voices/roster-store";

const ACTOR = "test-types-route";
let admin = true;

vi.mock("@/lib/admin-guard", () => ({
  requireAdmin: async () =>
    admin
      ? { lang: "enUS", session: { user: { id: ACTOR } }, denied: null }
      : { lang: null, session: null, denied: Response.json({ error: "not allowed" }, { status: 403 }) },
}));

import { POST } from "./route";

const KEY = `t${Math.floor(Math.random() * 1e9)}`;
const npcId = 990_000_000 + Math.floor(Math.random() * 9_999_999);

afterEach(async () => {
  admin = true;
  await db().query(`delete from "npc" where "npcId" = $1`, [npcId]);
  await db().query(`delete from "voice_assignment" where "race" = $1`, [KEY]);
  await db().query(`delete from "flavor" where "race" = $1`, [KEY]);
  await db().query(`delete from "gender" where "race" = $1`, [KEY]);
  await db().query(`delete from "race" where "key" = $1`, [KEY]);
  await db().query(`delete from "voice" where "name" = $1 or "name" like $2`, [KEY, `${KEY}-%`]);
  await db().query(`delete from "activity" where "kind" = 'type.changed' and "subject" = $1`, [KEY]);
});

beforeAll(async () => {
  await db().query(
    `insert into "user" ("id", "name", "email", "emailVerified") values ($1, 'Test Types', $2, false)
     on conflict ("id") do nothing`,
    [ACTOR, `${ACTOR}@example.invalid`],
  );
});

afterAll(async () => {
  await db().query(`delete from "user" where "id" = $1`, [ACTOR]);
  await closeDb();
});

function post(body: unknown): Request {
  return new Request("https://example.com/api/types", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/types", () => {
  it("refuses anyone but an admin", async () => {
    admin = false;
    expect((await POST(post({ action: "add-type", key: KEY, genders: [] }))).status).toBe(403);
    expect((await loadRoster()).hasRace(KEY)).toBe(false);
  });

  it("adds a genderless type read by its own new voice, and answers with the roster", async () => {
    const response = await POST(post({ action: "add-type", key: KEY, label: "Treant", genders: [] }));
    expect(response.status).toBe(200);
    const { roster } = await response.json();
    expect(roster.races).toContainEqual({ key: KEY, label: "Treant", genders: [] });
    expect((await loadRoster()).voiceFor(KEY, null, null)).toBe(KEY);
  });

  it("adds a gendered type with a voice per gender, and a flavor with its own", async () => {
    await POST(post({ action: "add-type", key: KEY, genders: ["male"] }));
    expect((await loadRoster()).voiceFor(KEY, "male", null)).toBe(`${KEY}-male`);
    const response = await POST(post({ action: "add-flavor", race: KEY, gender: "male", flavor: "old" }));
    expect(response.status).toBe(200);
    const roster = await loadRoster();
    // Nothing spoke the bare voice, so the flavor replaces it unasked.
    expect(roster.voiceFor(KEY, "male", null)).toBeNull();
    expect(roster.voiceFor(KEY, "male", "old")).toBe(`${KEY}-male-old`);
    expect(roster.familyOf(`${KEY}-male-old`)).toEqual({ race: KEY, gender: "male" });
  });

  it("adds a gender to a type", async () => {
    await POST(post({ action: "add-type", key: KEY, genders: ["male"] }));
    expect((await POST(post({ action: "add-gender", race: KEY, gender: "female" }))).status).toBe(200);
    const roster = await loadRoster();
    expect(roster.gendersOf(KEY)).toEqual(["female", "male"]);
    expect(roster.voiceFor(KEY, "female", null)).toBe(`${KEY}-female`);
  });

  it("points a type at an existing voice", async () => {
    await POST(post({ action: "add-type", key: KEY, genders: [] }));
    const response = await POST(post({ action: "assign-voice", race: KEY, gender: null, flavor: null, voice: "narrator-male" }));
    expect(response.status).toBe(200);
    expect((await loadRoster()).voiceFor(KEY, null, null)).toBe("narrator-male");
  });

  it("refuses a voice that does not exist", async () => {
    await POST(post({ action: "add-type", key: KEY, genders: [] }));
    const response = await POST(post({ action: "assign-voice", race: KEY, gender: null, flavor: null, voice: "nosuch-voice" }));
    expect(response.status).toBe(400);
  });

  it("relabels a type", async () => {
    await POST(post({ action: "add-type", key: KEY, genders: [] }));
    expect((await POST(post({ action: "label-type", key: KEY, label: "Ancient" }))).status).toBe(200);
    expect((await loadRoster()).data.races.find((r) => r.key === KEY)?.label).toBe("Ancient");
  });

  it("deletes a type nothing has, leaving its voice", async () => {
    await POST(post({ action: "add-type", key: KEY, genders: [] }));
    expect((await POST(post({ action: "delete-type", key: KEY }))).status).toBe(200);
    const roster = await loadRoster();
    expect(roster.hasRace(KEY)).toBe(false);
    expect(roster.isVoice(KEY)).toBe(true);
  });

  it("refuses to delete a type an NPC has", async () => {
    await POST(post({ action: "add-type", key: KEY, genders: [] }));
    await db().query(
      `insert into "npc" ("npcKind", "npcId", "race", "provenance", "confirmed") values ('creature', $1, $2, 'moderator', true)`,
      [npcId, KEY],
    );
    const response = await POST(post({ action: "delete-type", key: KEY }));
    expect(response.status).toBe(400);
    expect((await loadRoster()).hasRace(KEY)).toBe(true);
  });

  it("refuses to delete a flavor an NPC has", async () => {
    await POST(post({ action: "add-type", key: KEY, genders: ["male"] }));
    await POST(post({ action: "add-flavor", race: KEY, gender: "male", flavor: "old" }));
    await db().query(
      `insert into "npc" ("npcKind", "npcId", "race", "gender", "flavor", "provenance", "confirmed")
       values ('creature', $1, $2, 'male', 'old', 'moderator', true)`,
      [npcId, KEY],
    );
    expect((await POST(post({ action: "delete-flavor", race: KEY, gender: "male", flavor: "old" }))).status).toBe(400);
  });

  it("refuses a key that is not lowercase letters and digits", async () => {
    const response = await POST(post({ action: "add-type", key: "Tree-nt", genders: [] }));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Keys are lowercase letters and digits" });
  });

  it("refuses a type that exists already", async () => {
    await POST(post({ action: "add-type", key: KEY, genders: [] }));
    expect((await POST(post({ action: "add-type", key: KEY, genders: [] }))).status).toBe(400);
  });

  async function npcOf(race: string, gender: string | null = null, flavor: string | null = null) {
    await db().query(
      `insert into "npc" ("npcKind", "npcId", "race", "gender", "flavor", "provenance", "confirmed")
       values ('creature', $1, $2, $3, $4, 'moderator', true)`,
      [npcId, race, gender, flavor],
    );
  }

  async function answer() {
    const { rows } = await db().query(`select "gender", "flavor" from "npc" where "npcId" = $1`, [npcId]);
    return rows[0];
  }

  describe("a first gender for a genderless type in use", () => {
    it("asks what becomes of the voice that reads it, and changes nothing", async () => {
      await POST(post({ action: "add-type", key: KEY, genders: [] }));
      await npcOf(KEY);
      const response = await POST(post({ action: "add-gender", race: KEY, gender: "male" }));
      expect(response.status).toBe(409);
      expect(await response.json()).toMatchObject({ choice: { voice: KEY, into: "male", npcs: 1 } });
      expect((await loadRoster()).isGenderless(KEY)).toBe(true);
    });

    it("maps the voice, its takes with it, to the new gender, and moves the type's NPCs there", async () => {
      await POST(post({ action: "add-type", key: KEY, genders: [] }));
      await npcOf(KEY);
      const response = await POST(post({ action: "add-gender", race: KEY, gender: "male", existing: "map" }));
      expect(response.status).toBe(200);
      const roster = await loadRoster();
      expect(roster.voiceFor(KEY, "male", null)).toBe(KEY);
      expect(roster.voiceFor(KEY, null, null)).toBeNull();
      expect(await answer()).toEqual({ gender: "male", flavor: null });
    });

    it("throws the voice away: a new one for the gender, the old one kept but unused, the NPCs unanswered", async () => {
      await POST(post({ action: "add-type", key: KEY, genders: [] }));
      await npcOf(KEY);
      const response = await POST(post({ action: "add-gender", race: KEY, gender: "male", existing: "discard" }));
      expect(response.status).toBe(200);
      const roster = await loadRoster();
      expect(roster.voiceFor(KEY, "male", null)).toBe(`${KEY}-male`);
      expect(roster.voiceFor(KEY, null, null)).toBeNull();
      expect(roster.isVoice(KEY)).toBe(true);
      expect(await answer()).toEqual({ gender: null, flavor: null });
    });
  });

  it("asks nothing when no NPC has the type", async () => {
    await POST(post({ action: "add-type", key: KEY, genders: [] }));
    expect((await POST(post({ action: "add-gender", race: KEY, gender: "male" }))).status).toBe(200);
    expect((await loadRoster()).voiceFor(KEY, "male", null)).toBe(`${KEY}-male`);
  });

  it("refuses a gender the type has already", async () => {
    await POST(post({ action: "add-type", key: KEY, genders: ["male"] }));
    expect((await POST(post({ action: "add-gender", race: KEY, gender: "male" }))).status).toBe(400);
  });

  describe("a first flavor for a race-gender read by a bare voice", () => {
    it("asks first", async () => {
      await POST(post({ action: "add-type", key: KEY, genders: ["male"] }));
      await npcOf(KEY, "male");
      const response = await POST(post({ action: "add-flavor", race: KEY, gender: "male", flavor: "old" }));
      expect(response.status).toBe(409);
      expect(await response.json()).toMatchObject({ choice: { voice: `${KEY}-male`, into: "old", npcs: 1 } });
    });

    it("maps the bare voice to the flavor, and the NPCs with it", async () => {
      await POST(post({ action: "add-type", key: KEY, genders: ["male"] }));
      await npcOf(KEY, "male");
      await POST(post({ action: "add-flavor", race: KEY, gender: "male", flavor: "old", existing: "map" }));
      const roster = await loadRoster();
      expect(roster.voiceFor(KEY, "male", "old")).toBe(`${KEY}-male`);
      expect(roster.voiceFor(KEY, "male", null)).toBeNull();
      expect(await answer()).toEqual({ gender: "male", flavor: "old" });
    });

    it("throws the bare voice away", async () => {
      await POST(post({ action: "add-type", key: KEY, genders: ["male"] }));
      await npcOf(KEY, "male");
      await POST(post({ action: "add-flavor", race: KEY, gender: "male", flavor: "old", existing: "discard" }));
      const roster = await loadRoster();
      expect(roster.voiceFor(KEY, "male", "old")).toBe(`${KEY}-male-old`);
      expect(roster.voiceFor(KEY, "male", null)).toBeNull();
      expect(await answer()).toEqual({ gender: "male", flavor: null });
    });
  });

  it("logs each change", async () => {
    await POST(post({ action: "add-type", key: KEY, genders: [] }));
    const { rows } = await db().query(
      `select "detail" from "activity" where "kind" = 'type.changed' and "subject" = $1`,
      [KEY],
    );
    expect(rows).toEqual([{ detail: expect.objectContaining({ action: "add-type" }) }]);
  });
});
