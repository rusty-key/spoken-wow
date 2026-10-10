/**
 * A moderator's answer about who is speaking.
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

/** What the route asked the guard for, as `capability@lang`. */
const asked: string[] = [];

vi.mock("@/lib/generation/authz", () => ({
  requireIn: async (request: Request, capability: string) => {
    const lang = new URL(request.url).searchParams.get("lang") || "enUS";
    asked.push(`${capability}@${lang}`);
    return { lang, session: { user: { id: RESOLVER } }, denied: null };
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
  await db().query(`delete from "npc_resolution" where "npcId" in ($1, 0)`, [npcId]);
  await db().query(`delete from "activity" where "kind" = 'npc.resolved' and "actorId" = $1`, [
    RESOLVER,
  ]);
});

afterAll(async () => {
  await db().query(`delete from "user" where "id" = $1`, [RESOLVER]);
  await closeDb();
});

function post(body: unknown, lang?: string): Request {
  return new Request(`https://example.com/api/contributions/npc${lang ? `?lang=${lang}` : ""}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/contributions/npc", () => {
  it("records a moderator's answer and marks it confirmed", async () => {
    const response = await POST(
      post({
        npcKind: "creature",
        npcId,
        race: "tauren",
        gender: "male",
        flavor: "grim",
        note: "Wowhead lists the grim set for this model.",
      }),
    );
    expect(response.status).toBe(200);
    const row = await getResolution("creature", npcId);
    expect(row).toMatchObject({ flavor: "grim", provenance: "moderator", confirmed: true });
    expect(row?.resolvedBy).toBe(RESOLVER);
    const { rows: logged } = await db().query(
      `select "lang", "detail" from "activity" where "kind" = 'npc.resolved' and "subject" = $1`,
      [`creature:${npcId}`],
    );
    expect(logged).toEqual([{ lang: "enUS", detail: expect.objectContaining({ flavor: "grim" }) }]);
  });

  it("answers for the page's language, which may be any of them", async () => {
    // A line only Portuguese has is voiced once Portuguese's moderator says who speaks it.
    asked.length = 0;
    const response = await POST(post({ npcKind: "creature", npcId, race: "tauren", gender: "male" }, "ptBR"));
    expect(response.status).toBe(200);
    expect(asked).toEqual(["regenerate@ptBR"]);
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
    const response = await POST(post({ npcKind: "creature", npcId: 0, race: "tauren" }));
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

    const response = await POST(post({ npcKind: "creature", npcId, race: "tauren", gender: "male", flavor: "grim" }));
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

    const response = await POST(post({ npcKind: "creature", npcId, flavor: "grim" }));
    expect(response.status).toBe(200);

    const row = await getResolution("creature", npcId);
    expect(row).toMatchObject({
      race: "tauren",
      gender: "male",
      flavor: "grim",
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
    await POST(post({ npcKind: "creature", npcId, race: "tauren", gender: "male", flavor: "grim" }));

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
