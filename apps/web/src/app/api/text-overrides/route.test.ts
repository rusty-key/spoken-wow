/**
 * The text override route against a real Postgres, with only the session and its grants mocked,
 * so the language check is the real requireIn and the catalogues are the real ones.
 *
 * Needs DATABASE_URL and migrations through 0114 applied.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { catalogue as bossCatalogue } from "@/lib/bosses/catalogue";
import { closeDb } from "@/lib/db";
import type { Lang } from "@/lib/lang";
import type { Grant } from "@/lib/permissions";
import { catalogue as placeCatalogue } from "@/lib/places/catalogue";
import { catalogue as readableCatalogue } from "@/lib/readables/catalogue";
import { asActor } from "@/lib/teams/acting";
import { forgetTeams } from "@/lib/teams/store";
import { addMember, asSystem, dropLang, dropTeam, newTeamIn, testUser, uniqueLang } from "@/lib/teams/testing";
import { createFixtures, type Fixtures } from "@/lib/text-api/testing";

const viewer = vi.hoisted(() => ({ id: "", grants: [] as Grant[] }));

vi.mock("@/lib/session", () => ({ currentSession: async () => ({ user: { id: viewer.id, role: null } }) }));
vi.mock("@/lib/grants/store", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/grants/store")>()),
  viewerOf: async () => ({ role: null, grants: viewer.grants }),
}));

import { DELETE, PUT } from "./route";

let fx: Fixtures;
let lang: Lang;
let a: string;
let b: string;
let u: { id: string; cleanup: () => Promise<void> };
let v: { id: string; cleanup: () => Promise<void> };

const OVERRIDE = "Our own words for this line.";

function put(source: string, lineId: string, text: string) {
  return PUT(
    new Request(`http://test/api/text-overrides?lang=${lang}&source=${source}`, {
      method: "PUT",
      body: JSON.stringify({ lineId, text }),
    }),
  );
}

function remove(source: string, lineId: string) {
  return DELETE(
    new Request(`http://test/api/text-overrides?lang=${lang}&source=${source}&lineId=${encodeURIComponent(lineId)}`, {
      method: "DELETE",
    }),
  );
}

/** As `user`, holding `capability` in the test language. */
function as<T>(user: string, work: () => Promise<T>, capability: Grant["capability"] = "regenerate"): Promise<T> {
  viewer.id = user;
  viewer.grants = [{ lang, capability }];
  return asActor(user, work);
}

async function rows(lineId: string): Promise<{ teamId: string; text: string }[]> {
  const result = await asSystem.query(`select "teamId", "text" from "text_override" where "lineId" = $1`, [lineId]);
  return result.rows;
}

beforeEach(async () => {
  fx = await createFixtures();
  lang = await uniqueLang();
  a = await newTeamIn(lang, true);
  b = await newTeamIn(lang, false);
  u = await testUser();
  v = await testUser();
  await addMember(b, u.id, lang, "regenerate");
  await addMember(a, v.id, lang, "regenerate");
  // The zone is translated, the subzone is not.
  await asSystem.query(
    `insert into "lore_line"
       ("lineId", "lang", "version", "isCurrent", "origin", "mapID", "kind", "key", "name", "full", "short")
     values ($1, $2, 1, true, 'edited', $3, 'zone', null, 'Testland', 'Translated lore.', 'Translated.')`,
    [fx.zone, lang, fx.map],
  );
});

afterEach(async () => {
  await asSystem.query(`delete from "book_line" where "lang" = $1`, [lang]);
  await asSystem.query(`delete from "boss_line" where "lang" = $1`, [lang]);
  await asSystem.query(`delete from "activity" where "lang" = $1`, [lang]);
  for (const team of [a, b]) await dropTeam(team);
  await u.cleanup();
  await v.cleanup();
  await fx.remove();
  await dropLang(lang);
  forgetTeams();
});

afterAll(closeDb);

describe("/api/text-overrides", () => {
  it("writes a second team's member's override into the second team, which reads it current", async () => {
    const response = await as(u.id, () => put("places", fx.zone, `  ${OVERRIDE}  `));
    expect(response.status).toBe(200);
    expect((await response.json()).override).toMatchObject({ text: OVERRIDE, drifted: false, updatedBy: u.id });
    expect(await rows(fx.zone)).toEqual([{ teamId: b, text: OVERRIDE }]);

    const mine = (await as(u.id, () => placeCatalogue(lang))).find((e) => e.id === fx.zone);
    expect(mine?.spoken).toBe(OVERRIDE);
    expect(mine?.override).toMatchObject({ text: OVERRIDE, drifted: false });
    const theirs = (await as(v.id, () => placeCatalogue(lang))).find((e) => e.id === fx.zone);
    expect(theirs?.override).toBeUndefined();
  });

  it("writes a privileged member's override into the privileged team", async () => {
    expect((await as(v.id, () => put("places", fx.zone, OVERRIDE))).status).toBe(200);
    expect(await rows(fx.zone)).toEqual([{ teamId: a, text: OVERRIDE }]);
    const mine = (await as(v.id, () => placeCatalogue(lang))).find((e) => e.id === fx.zone);
    expect(mine?.override).toMatchObject({ text: OVERRIDE, drifted: false });
  });

  it("shows a rewrite of an override on the writer's next read", async () => {
    await as(u.id, () => placeCatalogue(lang));
    await as(u.id, () => put("places", fx.zone, OVERRIDE));
    await as(u.id, () => put("places", fx.zone, "Second thoughts."));
    const mine = (await as(u.id, () => placeCatalogue(lang))).find((e) => e.id === fx.zone);
    expect(mine?.override).toMatchObject({ text: "Second thoughts.", drifted: false });
  });

  it("judges a boss override against the boss's story", async () => {
    await asSystem.query(
      `insert into "boss_line" ("bossId", "lang", "version", "isCurrent", "origin", "text")
       values ($1, $2, 1, true, 'edited', 'The translated story.')`,
      [fx.boss.id, lang],
    );
    expect((await as(u.id, () => put("bosses", fx.boss.lineId, OVERRIDE))).status).toBe(200);
    expect(await rows(fx.boss.lineId)).toEqual([{ teamId: b, text: OVERRIDE }]);
    const mine = (await as(u.id, () => bossCatalogue(lang))).find((e) => e.id === fx.boss.lineId);
    expect(mine?.override).toMatchObject({ text: OVERRIDE, drifted: false });
  });

  it("judges a readable override against the page's text", async () => {
    await asSystem.query(
      `insert into "book_line" ("lineId", "lang", "version", "isCurrent", "origin", "title", "text")
       values ($1, $2, 1, true, 'edited', 'El Tomo', 'Translated page.')`,
      [fx.page.lineId, lang],
    );
    expect((await as(u.id, () => put("readables", fx.page.lineId, OVERRIDE))).status).toBe(200);
    expect(await rows(fx.page.lineId)).toEqual([{ teamId: b, text: OVERRIDE }]);
    const mine = (await as(u.id, () => readableCatalogue(lang))).find((p) => p.id === fx.page.lineId);
    expect(mine?.override).toMatchObject({ text: OVERRIDE, drifted: false });
  });

  it("refuses text without regenerate", async () => {
    expect((await as(u.id, () => put("places", fx.zone, OVERRIDE), "text")).status).toBe(403);
    expect((await as(u.id, () => remove("places", fx.zone), "text")).status).toBe(403);
    expect(await rows(fx.zone)).toEqual([]);
  });

  it("refuses a line with no text in the language", async () => {
    for (const [source, lineId] of [
      ["places", fx.subzone],
      ["bosses", fx.boss.lineId],
      ["readables", fx.page.lineId],
    ]) {
      const response = await as(u.id, () => put(source, lineId, OVERRIDE));
      expect(response.status).toBe(409);
      expect((await response.json()).error).toBe(`this line has no ${lang} text yet`);
      expect(await rows(lineId)).toEqual([]);
    }
  });

  it("refuses another source, an unknown line and bad text", async () => {
    expect((await as(u.id, () => put("quests", fx.zone, OVERRIDE))).status).toBe(400);
    expect((await as(u.id, () => remove("quests", fx.zone))).status).toBe(400);
    expect((await as(u.id, () => put("places", "z:-1", OVERRIDE))).status).toBe(404);
    expect((await as(u.id, () => remove("places", "z:-1"))).status).toBe(404);

    const empty = await as(u.id, () => put("places", fx.zone, "   "));
    expect(empty.status).toBe(400);
    expect((await empty.json()).error).toBe("text cannot be empty - remove the override instead");
    expect((await as(u.id, () => put("places", fx.zone, "x".repeat(5001)))).status).toBe(400);
    expect(await rows(fx.zone)).toEqual([]);
  });

  it("removes an override, and answers a second removal with nothing removed", async () => {
    await as(u.id, () => put("places", fx.zone, OVERRIDE));
    const first = await as(u.id, () => remove("places", fx.zone));
    expect(first.status).toBe(200);
    expect(await first.json()).toEqual({ removed: true });
    expect(await rows(fx.zone)).toEqual([]);
    const second = await as(u.id, () => remove("places", fx.zone));
    expect(await second.json()).toEqual({ removed: false });
    const mine = (await as(u.id, () => placeCatalogue(lang))).find((e) => e.id === fx.zone);
    expect(mine?.override).toBeUndefined();
  });

  it("removes only the acting team's override", async () => {
    await as(u.id, () => put("places", fx.zone, OVERRIDE));
    await as(v.id, () => put("places", fx.zone, "The privileged team's."));
    expect(await (await as(u.id, () => remove("places", fx.zone))).json()).toEqual({ removed: true });
    expect(await rows(fx.zone)).toEqual([{ teamId: a, text: "The privileged team's." }]);
  });
});
