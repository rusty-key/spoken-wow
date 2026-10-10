/**
 * An admin's answer about who is speaking.
 *
 * Modelled on api/contributions/resolve/route.test.ts: same auth mock, same seeded user.
 *
 * Needs DATABASE_URL and migrations applied.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/lib/db";
import { getResolution, upsertResolution } from "@/lib/npc/store";

/** resolvedBy has a foreign key, so resolving needs a user that exists. */
const RESOLVER = "test-contributions-npc-route";

/** The languages the route asked the guard about. */
const asked: string[] = [];
let admin = true;

vi.mock("@/lib/admin-guard", () => ({
  requireAdmin: async (request: Request) => {
    const lang = new URL(request.url).searchParams.get("lang") || "enUS";
    asked.push(lang);
    return admin
      ? { lang, session: { user: { id: RESOLVER } }, denied: null }
      : { lang: null, session: null, denied: Response.json({ error: "not allowed" }, { status: 403 }) };
  },
}));

import { POST } from "./route";

/** A bucket no other run shares, so a concurrent run's cleanup can't race this one's rows. */
const npcId = 900_000_000 + Math.floor(Math.random() * 99_999_999);

beforeAll(async () => {
  await db().query(
    `insert into "user" ("id", "name", "email", "emailVerified")
     values ($1, 'Test Resolver', $2, false)
     on conflict ("id") do nothing`,
    [RESOLVER, `${RESOLVER}@example.invalid`],
  );
});

afterEach(async () => {
  await db().query(`delete from "npc" where "npcId" in ($1, 0)`, [npcId]);
  await db().query(`delete from "entity_name" where "entityId" = $1`, [String(npcId)]);
  await db().query(`delete from "activity" where "kind" = 'name.edited' and "actorId" = $1`, [RESOLVER]);
  await db().query(`delete from "activity" where "kind" = 'npc.resolved' and "actorId" = $1`, [
    RESOLVER,
  ]);
});

afterAll(async () => {
  await db().query(`delete from "user" where "id" = $1`, [RESOLVER]);
  await closeDb();
});

function post(body: unknown, lang?: string): Request {
  return new Request(`https://example.com/api/npcs${lang ? `?lang=${lang}` : ""}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/npcs", () => {
  it("refuses anyone but an admin", async () => {
    admin = false;
    try {
      expect((await POST(post({ npcKind: "creature", npcId, race: "orc", gender: "male" }))).status).toBe(403);
    } finally {
      admin = true;
    }
    expect(await getResolution("creature", npcId)).toBeNull();
  });

  it("refuses a gender for a genderless type", async () => {
    const response = await POST(post({ npcKind: "gameobject", npcId, race: "gameobject", gender: "male" }));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "gameobject has no gender" });
  });

  it("refuses a type the roster does not have", async () => {
    const response = await POST(post({ npcKind: "creature", npcId, race: "murloc", gender: "male" }));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "murloc is not a type" });
  });

  it("refuses a flavor its type and gender are not voiced in", async () => {
    const response = await POST(post({ npcKind: "creature", npcId, race: "tauren", gender: "male", flavor: "grim" }));
    expect(response.status).toBe(400);
  });

  it("stores a genderless type with no gender", async () => {
    const response = await POST(post({ npcKind: "gameobject", npcId, race: "gameobject", gender: "" }));
    expect(response.status).toBe(200);
    expect(await getResolution("gameobject", npcId)).toMatchObject({
      race: "gameobject", gender: null, provenance: "moderator", confirmed: true,
    });
  });

  it("renames an NPC over any name, English included, without touching its voice", async () => {
    await upsertResolution({
      npcKind: "creature", npcId, npcName: "Some Gaurd", race: "dwarf", gender: "female", flavor: "guard",
      provenance: "client", confirmed: false, doubtful: false, modelFileId: null, sex: null,
      creatureType: null, build: null, note: null, resolvedBy: null,
    });
    const response = await POST(post({ npcKind: "creature", npcId, npcName: " Some Guard " }));
    expect(response.status).toBe(200);
    expect(await getResolution("creature", npcId)).toMatchObject({
      npcName: "Some Guard",
      provenance: "client",
      confirmed: false,
    });
    const { rows } = await db().query(
      `select "lang", "origin", "editedBy" from "entity_name" where "entityId" = $1 and "isCurrent"`,
      [String(npcId)],
    );
    expect(rows).toEqual([{ lang: "enUS", origin: "edited", editedBy: RESOLVER }]);
  });

  it("keeps a moderator's English name when the extract writes its own", async () => {
    await upsertResolution({
      npcKind: "creature", npcId, npcName: "Some Gaurd", race: null, gender: null, flavor: null,
      provenance: "none", confirmed: false, doubtful: false, modelFileId: null, sex: null,
      creatureType: null, build: null, note: null, resolvedBy: null,
    });
    await POST(post({ npcKind: "creature", npcId, npcName: "Some Guard" }));
    // What the import's speaker trigger runs for each English speaker row.
    await db().query(`select "entity_name_set"('creature', $1, 'enUS', 'Some Gaurd')`, [String(npcId)]);
    expect((await getResolution("creature", npcId))?.npcName).toBe("Some Guard");
  });

  it("renames in the language the moderator's rights were checked in, and nowhere else", async () => {
    await upsertResolution({
      npcKind: "creature", npcId, npcName: "Some Guard", race: null, gender: null, flavor: null,
      provenance: "none", confirmed: false, doubtful: false, modelFileId: null, sex: null,
      creatureType: null, build: null, note: null, resolvedBy: null,
    });
    asked.length = 0;
    await POST(post({ npcKind: "creature", npcId, npcName: "Guarda" }, "ptBR"));

    expect(asked).toEqual(["ptBR"]);
    const { rows } = await db().query(
      `select "lang", "name" from "entity_name" where "entityId" = $1 and "isCurrent" order by "lang"`,
      [String(npcId)],
    );
    expect(rows).toEqual([{ lang: "enUS", name: "Some Guard" }, { lang: "ptBR", name: "Guarda" }]);
  });

  it("will not name an NPC it has no row for", async () => {
    expect((await POST(post({ npcKind: "creature", npcId, npcName: "Nobody" }))).status).toBe(404);
  });

  it("records a moderator's answer and marks it confirmed", async () => {
    const response = await POST(
      post({
        npcKind: "creature",
        npcId,
        race: "tauren",
        gender: "male",
        flavor: "elder",
        note: "Wowhead lists the elder set for this model.",
      }),
    );
    expect(response.status).toBe(200);
    const row = await getResolution("creature", npcId);
    expect(row).toMatchObject({ flavor: "elder", provenance: "moderator", confirmed: true });
    expect(row?.resolvedBy).toBe(RESOLVER);
    const { rows: logged } = await db().query(
      `select "lang", "detail" from "activity" where "kind" = 'npc.resolved' and "subject" = $1`,
      [`creature:${npcId}`],
    );
    expect(logged).toEqual([{ lang: "enUS", detail: expect.objectContaining({ flavor: "elder" }) }]);
  });

  it("answers for the page's language, which may be any of them", async () => {
    // A line only Portuguese has is voiced once Portuguese's moderator says who speaks it.
    asked.length = 0;
    const response = await POST(post({ npcKind: "creature", npcId, race: "tauren", gender: "male" }, "ptBR"));
    expect(response.status).toBe(200);
    expect(asked).toEqual(["ptBR"]);
    const { rows: logged } = await db().query(
      `select "lang" from "activity" where "kind" = 'npc.resolved' and "subject" = $1`,
      [`creature:${npcId}`],
    );
    expect(logged).toEqual([{ lang: "ptBR" }]);
  });

  it("saves a doubtful answer as confirmed, and a later save without the flag clears it", async () => {
    // The flag marks an answer for a second look; it must not hold the NPC's lines back, so the
    // row is confirmed like any other moderator answer.
    await POST(post({ npcKind: "creature", npcId, race: "dwarf", gender: "female", flavor: "guard", doubtful: true }));
    expect(await getResolution("creature", npcId)).toMatchObject({
      flavor: "guard",
      provenance: "moderator",
      confirmed: true,
      doubtful: true,
    });

    await POST(post({ npcKind: "creature", npcId, flavor: "guard" }));
    expect(await getResolution("creature", npcId)).toMatchObject({ flavor: "guard", doubtful: false });
  });

  // The NPC tab's bulk save: only the flag is posted, and the guess on file becomes the answer.
  it("takes a client guess as the moderator's answer when only the flag is posted", async () => {
    await upsertResolution({
      npcKind: "creature",
      npcId,
      npcName: "Some Guard",
      race: "dwarf",
      gender: "female",
      flavor: "guard",
      provenance: "client",
      confirmed: false,
      doubtful: false,
      modelFileId: 12345,
      sex: 1,
      creatureType: "Humanoid",
      build: "1.12.1.5875",
      note: null,
      resolvedBy: null,
    });

    expect((await POST(post({ npcKind: "creature", npcId, doubtful: true }))).status).toBe(200);
    expect(await getResolution("creature", npcId)).toMatchObject({
      race: "dwarf",
      gender: "female",
      flavor: "guard",
      provenance: "moderator",
      confirmed: true,
      doubtful: true,
    });
  });

  it("refuses a kind it does not know", async () => {
    expect((await POST(post({ npcKind: "item", npcId, race: "tauren" }))).status).toBe(400);
  });

  it("refuses a negative id", async () => {
    expect((await POST(post({ npcKind: "creature", npcId: -1 }))).status).toBe(400);
  });

  // The same `integer` column the intake path's npcId bound protects (resolve.ts's digits()):
  // a moderator's own POST is authenticated, but that only means the id came from someone
  // trusted, not that it fits. Refused here rather than left to Postgres, the same reasoning.
  it("refuses an id past Postgres's integer range", async () => {
    expect(
      (await POST(post({ npcKind: "creature", npcId: 99999999999, race: "tauren" }))).status,
    ).toBe(400);
  });

  it("accepts id 0, a real npc id resolve.ts's own observedFrom treats as one", async () => {
    // A route that rejected 0 as "not positive" would silently make an NPC the intake path can
    // resolve automatically one a moderator could never correct by hand -- exactly the id-0
    // truthiness class of bug this branch already fixed once in resolve.ts/store.ts.
    const response = await POST(post({ npcKind: "creature", npcId: 0, race: "tauren", gender: "male" }));
    expect(response.status).toBe(200);
    const row = await getResolution("creature", 0);
    expect(row).toMatchObject({ race: "tauren", provenance: "moderator", confirmed: true });
  });

  it("keeps what the client reported when a moderator overrules the race", async () => {
    // A client-provenance row already carries evidence from the addon: the model file id it
    // guessed the race from, plus sex/creatureType/build. Overruling the race must not throw
    // that evidence away -- the next person to look may want to know what the guess was based
    // on, and there is no other route that ever writes these columns.
    await upsertResolution({
      npcKind: "creature",
      npcId,
      npcName: "Some Guard",
      race: "human",
      gender: "male",
      flavor: "standard",
      provenance: "client",
      confirmed: false,
      doubtful: false,
      modelFileId: 12345,
      sex: 0,
      creatureType: "Humanoid",
      build: "1.12.1.5875",
      note: null,
      resolvedBy: null,
    });

    const response = await POST(post({ npcKind: "creature", npcId, race: "tauren", gender: "male", flavor: "elder" }));
    expect(response.status).toBe(200);

    const row = await getResolution("creature", npcId);
    expect(row).toMatchObject({
      race: "tauren",
      provenance: "moderator",
      confirmed: true,
      doubtful: false,
      modelFileId: 12345,
      sex: 0,
      creatureType: "Humanoid",
      build: "1.12.1.5875",
    });
  });

  // The brief's own case: "this is a tauren male" without a flavor opinion must not force one.
  it("leaves a field null when the POST omits it entirely, rather than treating absence as clearing it", async () => {
    const response = await POST(post({ npcKind: "creature", npcId, race: "tauren", gender: "male" }));
    expect(response.status).toBe(200);
    const row = await getResolution("creature", npcId);
    expect(row).toMatchObject({ race: "tauren", gender: "male", flavor: null, provenance: "moderator" });
  });

  // The other half: a moderator who only has an opinion about the flavor of a row the client
  // already reported a race and gender for must not wipe those out by leaving them off the POST.
  it("keeps an existing field the POST omits, rather than nulling it", async () => {
    await upsertResolution({
      npcKind: "creature",
      npcId,
      npcName: "Boarton Shadetotem",
      race: "tauren",
      gender: "male",
      flavor: "warrior",
      provenance: "client",
      confirmed: false,
      doubtful: false,
      modelFileId: 122055,
      sex: 2,
      creatureType: "Humanoid",
      build: "1.60.1/69913",
      note: null,
      resolvedBy: null,
    });

    const response = await POST(post({ npcKind: "creature", npcId, flavor: "elder" }));
    expect(response.status).toBe(200);

    const row = await getResolution("creature", npcId);
    expect(row).toMatchObject({
      race: "tauren",
      gender: "male",
      flavor: "elder",
      provenance: "moderator",
      confirmed: true,
      doubtful: false,
    });
  });

  // A field sent as an explicit empty string still clears it -- omission and clearing must stay
  // distinguishable, or the previous test's fix would make clearing impossible instead.
  it("still clears a field sent as an explicit empty string", async () => {
    await upsertResolution({
      npcKind: "creature",
      npcId,
      npcName: "Boarton Shadetotem",
      race: "tauren",
      gender: "male",
      flavor: "warrior",
      provenance: "client",
      confirmed: false,
      doubtful: false,
      modelFileId: 122055,
      sex: 2,
      creatureType: "Humanoid",
      build: "1.60.1/69913",
      note: null,
      resolvedBy: null,
    });

    const response = await POST(post({ npcKind: "creature", npcId, race: "tauren", gender: "male", flavor: "" }));
    expect(response.status).toBe(200);

    const row = await getResolution("creature", npcId);
    expect(row).toMatchObject({ race: "tauren", gender: "male", flavor: null, provenance: "moderator" });
  });

  it("lets a moderator clear every field without a constraint violation", async () => {
    await POST(post({ npcKind: "creature", npcId, race: "tauren", gender: "male", flavor: "elder" }));

    // Clearing every field is a moderator's answer too -- "this NPC has no race", the same
    // normal outcome resolve.ts's own docstring describes for a corpus miss. It stays
    // "moderator"/confirmed so nothing lower-ranked overwrites it, and both invariants in
    // 0031 allow a moderator row to carry nulls: the "none is empty" check only constrains
    // provenance "none", and the "confirmed implies corpus or moderator" check is satisfied
    // by "moderator" regardless of confirmed.
    const response = await POST(post({ npcKind: "creature", npcId, race: "", gender: "", flavor: "" }));
    expect(response.status).toBe(200);

    const row = await getResolution("creature", npcId);
    expect(row).toMatchObject({
      race: null,
      gender: null,
      flavor: null,
      provenance: "moderator",
      confirmed: true,
      doubtful: false,
    });
  });
});
