/**
 * The write routes, with real tokens and only grants mocked.
 *
 * Needs DATABASE_URL, migrations applied and the corpus imported.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { saveStory } from "@/lib/bosses/story";
import { closeDb, query } from "@/lib/db";
import type { Lang } from "@/lib/lang";
import { saveLore } from "@/lib/places/lore";
import { keepLanguage } from "@/lib/quests/keep-language";
import { forgetTeams, type TeamId } from "@/lib/teams/store";
import { addMember, asSystem, dropLang, dropTeam, newTeamIn, testUser, uniqueLang } from "@/lib/teams/testing";

// The fixture's user is a koKR text maintainer; anyone else has the grants their rows give.
const mocked = vi.hoisted(() => ({ user: "" }));

vi.mock("@/lib/grants/store", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/grants/store")>();
  return {
    ...real,
    viewerOf: async (session: { user: { id: string; role?: string | null } } | null) =>
      session?.user.id === mocked.user ? { role: null, grants: [{ lang: "koKR", capability: "text" }] } : real.viewerOf(session),
  };
});

import { createFixtures, LANG, type Fixtures } from "@/lib/text-api/testing";
import { createToken } from "@/lib/tokens/store";

import { GET as getOne, PATCH as patchOne } from "./[id]/route";
import { PATCH as patchMany } from "./route";

let f: Fixtures;
let write: string;
let writeId: string;
let read: string;

const token = (access: "read" | "write") =>
  createToken({ userId: f.user, lang: LANG, access, generate: false, label: "agent", expiresAt: new Date(Date.now() + 86_400_000) });

beforeAll(async () => {
  f = await createFixtures();
  mocked.user = f.user;
  const made = await token("write");
  write = made.token;
  writeId = made.row.id;
  read = (await token("read")).token;
});

keepLanguage(LANG);

afterAll(async () => {
  await f.remove();
  await closeDb();
});

function many(section: string, body: unknown, auth = write, raw = false) {
  return patchMany(
    new Request(`https://example.com/api/v1/${section}`, {
      method: "PATCH",
      headers: { authorization: `Bearer ${auth}`, "content-type": "application/json" },
      body: raw ? (body as string) : JSON.stringify(body),
    }),
    { params: Promise.resolve({ section }) },
  );
}

function one(section: string, id: string, body: unknown, auth = write, query = "") {
  return patchOne(
    new Request(`https://example.com/api/v1/${section}/${id}${query}`, {
      method: "PATCH",
      headers: { authorization: `Bearer ${auth}`, "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ section, id }) },
  );
}

type Result = { id: string; text?: { status: string; code?: string }; error?: { code: string } };

const activityOf = async (subject: string) =>
  (
    await asSystem.query<{ detail: Record<string, unknown>; actorId: string }>(
      `select "detail", "actorId" from "activity" where "subject" = $1 and "kind" = 'text.edited' order by "id" desc limit 1`,
      [subject],
    )
  ).rows[0];

describe("PATCH /api/v1/[section]", () => {
  it("403 for a read token", async () => {
    expect((await many("places", { items: [{ id: f.zone, text: "글." }] }, read)).status).toBe(403);
  });

  it("404 on an unknown section", async () => {
    expect((await many("zones", { items: [{ id: f.zone, text: "글." }] })).status).toBe(404);
  });

  it.each([
    ["JSON that does not parse", "{nope", true],
    ["items that is no array", { items: "x" }, false],
    ["an empty items", { items: [] }, false],
    ["a note that is no string", { items: [{ id: "x", text: "글." }], note: 3 }, false],
  ])("400 on %s", async (_name, body, raw) => {
    expect((await many("places", body, write, raw as boolean)).status).toBe(400);
  });

  it("400 on 1,001 items, writing nothing", async () => {
    const before = (await query(`select 1 from "api_batch" where "userId" = $1`, [f.user])).length;
    const items = Array.from({ length: 1001 }, () => ({ id: f.zone, text: "글." }));
    expect((await many("places", { items })).status).toBe(400);
    expect((await query(`select 1 from "api_batch" where "userId" = $1`, [f.user])).length).toBe(before);
  });

  it("a variant too big to store and a NUL in an id are answered per item", async () => {
    const response = await many("quests", {
      items: [
        { id: f.quest.lineId, variant: 40000, text: "글." },
        { id: "q:1\u0000", text: "글." },
      ],
    });
    expect(response.status).toBe(200);
    const { results } = (await response.json()) as { results: { error?: { code: string } }[] };
    expect(results.map((r) => r.error?.code)).toEqual(["invalid", "unknown_id"]);
  });

  it("an item refused for its shape does not count against the next with the same id", async () => {
    const response = await many("places", {
      items: [
        { id: f.zone, variant: "x", text: "거절." },
        { id: f.zone, text: "통과." },
      ],
    });
    const { results } = (await response.json()) as { results: { error?: unknown; text?: { status: string } }[] };
    expect(results[0].error).toMatchObject({ code: "invalid" });
    expect(results[1].error).toBeUndefined();
    expect(results[1].text?.status).toBe("updated");
  });

  it("400 on a NUL in the run's note", async () => {
    expect((await many("places", { note: "메\u0000모", items: [{ id: f.zone, text: "글." }] })).status).toBe(400);
  });

  it("one bad id does not stop the others: 200, results in order", async () => {
    const response = await many("places", {
      items: [
        { id: f.zone, text: "첫째." },
        { id: "z:nothing", text: "글." },
        { id: f.subzone, text: "셋째." },
      ],
    });
    expect(response.status).toBe(200);
    const { results } = (await response.json()) as { results: Result[] };
    expect(results.map((r) => r.id)).toEqual([f.zone, "z:nothing", f.subzone]);
    expect(results[0].text?.status).toBe("updated");
    expect(results[1].error?.code).toBe("unknown_id");
    expect(results[2].text?.status).toBe("updated");
  });

  it("the same id and variant twice: the first applies, the second is invalid", async () => {
    const { results } = (await (
      await many("places", {
        items: [
          { id: f.zone, text: "먼저." },
          { id: f.zone, text: "나중." },
        ],
      })
    ).json()) as { results: Result[] };
    expect(results[0].text?.status).toBe("updated");
    expect(results[1].error?.code).toBe("invalid");
  });

  it("an item that is no object is invalid and the others apply", async () => {
    const { results } = (await (await many("places", { items: [3, { id: f.zone, text: "뒤따름." }] })).json()) as {
      results: Result[];
    };
    expect(results[0].error?.code).toBe("invalid");
    expect(results[1].text?.status).toBe("updated");
  });

  it("returns batchId and writes it into each activity row under the owner's name", async () => {
    const { batchId } = (await (
      await many("bosses", { items: [{ id: f.boss.lineId, text: "한 묶음." }], note: "run one" })
    ).json()) as { batchId: string };
    expect(batchId).toBeTruthy();
    expect(await activityOf(f.boss.lineId)).toMatchObject({
      actorId: f.user,
      detail: { apiBatchId: batchId, apiTokenId: writeId, note: "run one" },
    });
  });

  it("creates no take and no regeneration job", async () => {
    const count = async () => {
      const { rows } = await asSystem.query<{ n: number }>(
        `select (select count(*) from "take")::int + (select count(*) from "regeneration_job")::int as "n"`,
      );
      return rows[0].n;
    };
    const before = await count();
    await many("readables", { items: [{ id: f.page.lineId, text: "소리 없이." }] });
    expect(await count()).toBe(before);
  });
});

describe("PATCH /api/v1/[section]/[id]", () => {
  it("403 for a read token", async () => {
    expect((await one("places", f.zone, { text: "글." }, read)).status).toBe(403);
  });

  it("updates one, with apiTokenId and no apiBatchId", async () => {
    const response = await one("bosses", f.boss.lineId, { text: "하나만." });
    expect(response.status).toBe(200);
    const { detail, actorId } = await activityOf(f.boss.lineId);
    expect(actorId).toBe(f.user);
    expect(detail).toMatchObject({ apiTokenId: writeId });
    expect(detail).not.toHaveProperty("apiBatchId");
  });

  it("finds an encoded id", async () => {
    expect((await one("places", encodeURIComponent(f.subzone), { text: "부호화." })).status).toBe(200);
  });

  it("reads ?variant= for quests", async () => {
    const response = await one("quests", f.quest.lineId, { text: "변형." }, write, `?variant=${f.quest.variant}`);
    expect(response.status).toBe(200);
  });

  it("400 on a variant in the body, which belongs in the URL", async () => {
    const before = await query(`select 1 from "quest_line" where "lineId" = $1 and "lang" = $2`, [f.quest.lineId, LANG]);
    const response = await one("quests", f.quest.lineId, { variant: 1, text: "다른 변형." });
    expect(response.status).toBe(400);
    expect(await response.text()).toContain("?variant=");
    const after = await query(`select 1 from "quest_line" where "lineId" = $1 and "lang" = $2`, [f.quest.lineId, LANG]);
    expect(after.length).toBe(before.length);
  });

  it("tells a section with no variants that it has none", async () => {
    const response = await one("places", f.zone, { variant: 1, text: "글." });
    expect(response.status).toBe(400);
    expect(await response.text()).toContain("only quest lines have variant");
  });

  it("answers an error with its status", async () => {
    expect((await one("places", "z:nothing", { text: "글." })).status).toBe(404);
    expect((await one("places", f.zone, { text: "" })).status).toBe(400);
    expect((await one("places", f.zone, { text: "충돌.", expectedVersion: 99 })).status).toBe(409);
  });

  it("400 on JSON that is no object", async () => {
    expect((await one("places", f.zone, [1])).status).toBe(400);
  });
});

describe("the override layer", () => {
  let lang: Lang;
  let teams: TeamId[];
  let users: { id: string; cleanup: () => Promise<void> }[];
  // U regenerates in the second team B, M is a text maintainer in the privileged A, V regenerates in A.
  let u: string;
  let m: string;
  let v: string;

  const tokenOf = async (userId: string, inLang: Lang) =>
    (
      await createToken({
        userId,
        lang: inLang,
        access: "write",
        generate: false,
        label: "agent",
        expiresAt: new Date(Date.now() + 86_400_000),
      })
    ).token;

  const person = async () => {
    const made = await testUser("test-layer");
    users.push(made);
    return made.id;
  };

  const story = async (inLang: Lang) =>
    (
      await asSystem.query<{ text: string }>(
        `select "text" from "boss_line" where "bossId" = $1 and "lang" = $2 and "isCurrent"`,
        [f.boss.id, inLang],
      )
    ).rows[0]?.text;

  const overrides = async (inLang: Lang) =>
    (
      await asSystem.query<{ teamId: string; text: string }>(
        `select "teamId", "text" from "text_override" where "lang" = $1 order by "source"`,
        [inLang],
      )
    ).rows;

  const getPlace = (auth: string) =>
    getOne(
      new Request(`https://example.com/api/v1/places/${f.zone}`, { headers: { authorization: `Bearer ${auth}` } }),
      { params: Promise.resolve({ section: "places", id: f.zone }) },
    );

  async function language(): Promise<{ lang: Lang; a: TeamId }> {
    const made = await uniqueLang();
    const a = await newTeamIn(made, true, "patch-a");
    teams.push(a);
    forgetTeams();
    return { lang: made, a };
  }

  async function cleanLang(inLang: Lang) {
    for (const table of ["lore_line", "boss_line", "api_batch", "api_token"]) {
      await asSystem.query(`delete from "${table}" where "lang" = $1`, [inLang]);
    }
    await asSystem.query(`delete from "activity" where "lang" = $1`, [inLang]);
  }

  const langs: Lang[] = [];

  beforeAll(async () => {
    teams = [];
    users = [];
    const made = await language();
    lang = made.lang;
    langs.push(lang);
    const b = await newTeamIn(lang, false, "patch-b");
    teams.push(b);
    u = await person();
    m = await person();
    v = await person();
    await addMember(b, u, lang, "regenerate");
    await addMember(made.a, m, lang, "regenerate");
    await addMember(made.a, v, lang, "regenerate");
    await asSystem.query(`insert into "language_grant" ("userId", "lang", "capability") values ($1, $2, 'edit')`, [m, lang]);
    forgetTeams();
    await saveLore({ lang, lineId: f.zone, full: "Unser Land.", editedBy: m });
    await saveStory({ lang, lineId: f.boss.lineId, text: "Der Boss spricht.", editedBy: m });
  });

  afterAll(async () => {
    for (const inLang of langs) await cleanLang(inLang);
    for (const team of teams) await dropTeam(team);
    for (const made of users) await made.cleanup();
    for (const inLang of langs) await dropLang(inLang);
    forgetTeams();
  });

  it("writes a regenerate-only owner's PATCH with no layer to its team's override", async () => {
    const token = await tokenOf(u, lang);
    const { results } = (await (await many("bosses", { items: [{ id: f.boss.lineId, text: "Unser Boss." }] }, token)).json()) as {
      results: { text?: { status: string; layer?: string } }[];
    };
    expect(results[0].text).toMatchObject({ status: "updated", layer: "override" });
    expect(await story(lang)).toBe("Der Boss spricht.");
    expect(await overrides(lang)).toEqual([{ teamId: teams[1], text: "Unser Boss." }]);
  });

  it("refuses a regenerate-only owner's original layer with 403, writing nothing", async () => {
    const token = await tokenOf(u, lang);
    const before = await overrides(lang);
    const batches = (await query(`select 1 from "api_batch" where "lang" = $1`, [lang])).length;
    const expected = {
      error: `this token's owner is not a text maintainer in ${lang}, so it writes only its team's overrides`,
    };

    const response = await many("bosses", { layer: "original", items: [{ id: f.boss.lineId, text: "Nein." }] }, token);
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual(expected);
    const single = await one("bosses", f.boss.lineId, { layer: "original", text: "Nein." }, token);
    expect(single.status).toBe(403);
    expect(await single.json()).toEqual(expected);

    expect(await story(lang)).toBe("Der Boss spricht.");
    expect(await overrides(lang)).toEqual(before);
    expect((await query(`select 1 from "api_batch" where "lang" = $1`, [lang])).length).toBe(batches);
  });

  it("400 on a layer that is neither", async () => {
    const response = await one("bosses", f.boss.lineId, { layer: "both", text: "Nein." }, await tokenOf(m, lang));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'layer must be "original" or "override"' });
  });

  it("writes a text maintainer's PATCH with no layer to the original", async () => {
    const response = await one("bosses", f.boss.lineId, { text: "Der Boss schweigt." }, await tokenOf(m, lang));
    expect(response.status).toBe(200);
    expect(((await response.json()) as { text: unknown }).text).toMatchObject({ status: "updated", layer: "original" });
    expect(await story(lang)).toBe("Der Boss schweigt.");
  });

  it("lists only the owner's team's override", async () => {
    await one("places", f.zone, { text: "Unsere Gegend." }, await tokenOf(u, lang));
    const asU = await getPlace(await tokenOf(u, lang));
    expect(asU.status).toBe(200);
    expect(await asU.json()).toMatchObject({ text: "Unser Land.", override: "Unsere Gegend." });
    const asV = await getPlace(await tokenOf(v, lang));
    expect(await asV.json()).toMatchObject({ text: "Unser Land.", override: null });
  });

  it("writes a regenerate-only owner's override in a language with one team, not the original", async () => {
    const single = await language();
    langs.push(single.lang);
    const w = await person();
    const t = await person();
    await addMember(single.a, w, single.lang, "regenerate");
    await asSystem.query(`insert into "language_grant" ("userId", "lang", "capability") values ($1, $2, 'edit')`, [
      t,
      single.lang,
    ]);
    forgetTeams();
    await saveStory({ lang: single.lang, lineId: f.boss.lineId, text: "Der Boss spricht.", editedBy: t });

    const response = await one("bosses", f.boss.lineId, { text: "Unser Boss." }, await tokenOf(w, single.lang));
    expect(response.status).toBe(200);
    expect(((await response.json()) as { text: unknown }).text).toMatchObject({ status: "updated", layer: "override" });
    expect(await story(single.lang)).toBe("Der Boss spricht.");
    expect(await overrides(single.lang)).toEqual([{ teamId: single.a, text: "Unser Boss." }]);
  });
});
