/** Needs DATABASE_URL and migrations through 0117 applied. */
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";

import { closeDb } from "@/lib/db";
import { asActor } from "@/lib/teams/acting";
import { forgetTeams } from "@/lib/teams/store";
import { addMember, asSystem, dropLang, dropTeam, newTeamIn, testUser, uniqueLang } from "@/lib/teams/testing";
import { createNarratedFixtures, type NarratedFixtures } from "@/lib/text-api/testing";

import {
  clearTextOverride,
  overrideStamp,
  readTextOverrides,
  stampsWithOverrides,
  viewOf,
  writeTextOverride,
} from "./store";

let fx: NarratedFixtures;
let lang: Awaited<ReturnType<typeof uniqueLang>>;
let a: string;
let b: string;
let u: { id: string; cleanup: () => Promise<void> };
let v: { id: string; cleanup: () => Promise<void> };

beforeEach(async () => {
  // A write hashes its text through the catalogue, which a database with no places cannot build.
  fx = await createNarratedFixtures();
  lang = await uniqueLang();
  a = await newTeamIn(lang, true);
  b = await newTeamIn(lang, false);
  u = await testUser();
  v = await testUser();
  await addMember(b, u.id, lang, "regenerate");
  await addMember(a, v.id, lang, "regenerate");
});

afterEach(async () => {
  await asSystem.query(`delete from "activity" where "lang" = $1`, [lang]);
  for (const team of [a, b]) await dropTeam(team);
  await u.cleanup();
  await v.cleanup();
  await fx.remove();
  await dropLang(lang);
  forgetTeams();
});

afterAll(closeDb);

const write = (text: string, audit?: { tokenId: string; batchId?: string }) =>
  asActor(u.id, () =>
    writeTextOverride({ source: "places", lang, lineId: "z:1", text, original: "Old.", userId: u.id, audit }),
  );

const sets = async () =>
  (await asSystem.query(`select * from "activity" where "lang" = $1 and "kind" = 'override.set'`, [lang])).rows;

describe("text overrides", () => {
  it("are the writing team's and invisible to the other", async () => {
    expect((await write("New.")).wrote).toBe(true);
    const mine = await asActor(u.id, () => readTextOverrides("places", lang));
    expect(mine.get("z:1")?.text).toBe("New.");
    expect((await asActor(v.id, () => readTextOverrides("places", lang))).size).toBe(0);
    expect((await asActor(u.id, () => readTextOverrides("readables", lang))).size).toBe(0);
  });

  it("log once, and not for the same text again", async () => {
    await write("New.");
    expect((await write("New.")).wrote).toBe(false);
    expect(await sets()).toHaveLength(1);
  });

  it("log the team, source, subject and api batch", async () => {
    await write("New.", { tokenId: "t", batchId: "b" });
    const [row] = await sets();
    expect(row.teamId).toBe(b);
    expect(row.source).toBe("places");
    expect(row.subject).toBe("z:1");
    expect(row.detail.apiBatchId).toBe("b");
    expect(row.detail.before).toBeNull();
  });

  it("drift when the original changes, and never with no hash", async () => {
    const { override } = await write("New.");
    expect(viewOf(override, "Old.")?.drifted).toBe(false);
    expect(viewOf(override, "Older.")?.drifted).toBe(true);
    expect(viewOf({ ...override, originalHash: null }, "Older.")?.drifted).toBe(false);
    expect(viewOf(undefined, "Old.")).toBeUndefined();
  });

  it("keep their time and author when only the original moved under them", async () => {
    const row = async () =>
      (
        await asSystem.query(
          `select "updatedAt", "updatedBy", "originalHash" from "text_override" where "lang" = $1 and "lineId" = 'z:1'`,
          [lang],
        )
      ).rows[0];
    await write("New.");
    const first = await row();
    await asSystem.query(`update "text_override" set "updatedAt" = "updatedAt" - interval '1 hour', "updatedBy" = null where "lang" = $1`, [lang]);
    const aged = await row();
    const kept = await asActor(u.id, () =>
      writeTextOverride({ source: "places", lang, lineId: "z:1", text: "New.", original: "Older.", userId: u.id }),
    );
    expect(kept.wrote).toBe(false);
    expect(viewOf(kept.override, "Older.")?.drifted).toBe(false);
    const after = await row();
    expect(after.updatedAt).toEqual(aged.updatedAt);
    expect(after.updatedBy).toBeNull();
    expect(after.originalHash).not.toBe(first.originalHash);
    await write("Newer.");
    const rewritten = await row();
    expect(rewritten.updatedAt.getTime()).toBeGreaterThan(aged.updatedAt.getTime());
    expect(rewritten.updatedBy).toBe(u.id);
  });

  it("clear once", async () => {
    await write("New.", { tokenId: "t" });
    const clear = () => asActor(u.id, () => clearTextOverride({ source: "places", lang, lineId: "z:1", by: u.id, audit: { tokenId: "t" } }));
    expect(await clear()).toBe(true);
    expect((await asActor(u.id, () => readTextOverrides("places", lang))).size).toBe(0);
    expect(await clear()).toBe(false);
    const cleared = await asSystem.query(`select * from "activity" where "lang" = $1 and "kind" = 'override.cleared'`, [lang]);
    expect(cleared.rows).toHaveLength(1);
    const [row] = cleared.rows;
    expect(row.teamId).toBe(b);
    expect(row.source).toBe("places");
    expect(row.subject).toBe("z:1");
    expect(row.detail).toEqual({ before: "New.", apiTokenId: "t", previous: null });
  });

  it("are not cleared by the other team", async () => {
    await write("New.");
    expect(await asActor(v.id, () => clearTextOverride({ source: "places", lang, lineId: "z:1", by: v.id }))).toBe(false);
    expect((await asActor(u.id, () => readTextOverrides("places", lang))).size).toBe(1);
  });

  it("keep bosses apart from places", async () => {
    await asActor(u.id, () =>
      writeTextOverride({ source: "bosses", lang, lineId: "b:1", text: "Roar.", original: "Grr.", userId: u.id }),
    );
    expect((await asActor(u.id, () => readTextOverrides("bosses", lang))).get("b:1")?.text).toBe("Roar.");
    expect((await asActor(u.id, () => readTextOverrides("places", lang))).size).toBe(0);
  });

  describe("read after a change", () => {
    const read = () => asActor(u.id, () => readTextOverrides("places", lang));

    it("sees new text written after a read", async () => {
      await write("First.");
      await read();
      await write("Second.");
      expect((await read()).get("z:1")?.text).toBe("Second.");
    });

    it("sees a clear after a read", async () => {
      await write("New.");
      await read();
      await asActor(u.id, () => clearTextOverride({ source: "places", lang, lineId: "z:1", by: u.id }));
      expect((await read()).size).toBe(0);
    });

    it("stamps a kept original anew, which leaves updatedAt where it was", async () => {
      await write("New.");
      const stamp = () => asActor(u.id, () => overrideStamp("places", lang));
      const before = await stamp();
      await asActor(u.id, () =>
        writeTextOverride({ source: "places", lang, lineId: "z:1", text: "New.", original: "Older.", userId: u.id }),
      );
      expect(await stamp()).not.toBe(before);
    });

    it("sees a delete behind the newest row, which max(updatedAt) cannot", async () => {
      await write("One.");
      await asActor(u.id, () =>
        writeTextOverride({ source: "places", lang, lineId: "z:2", text: "Two.", original: "Old.", userId: u.id }),
      );
      expect((await read()).size).toBe(2);
      await asSystem.query(`delete from "text_override" where "lang" = $1 and "lineId" = 'z:1'`, [lang]);
      expect([...(await read()).keys()]).toEqual(["z:2"]);
    });
  });

  describe("stamped beside a shared stamp", () => {
    const shared = { sql: `('shared:' || $1)`, params: ["x"] };

    it("count the acting team's rows only, in the one statement", async () => {
      await write("New.");
      const second = await asActor(u.id, () => stampsWithOverrides("places", lang, shared));
      expect(second.stamp).toBe("shared:x");
      expect(second.overrides).toMatch(/^1:/);
      expect(await asActor(v.id, () => stampsWithOverrides("places", lang, shared))).toEqual({
        stamp: "shared:x",
        overrides: "0:-",
      });
    });

    it("read no override for a language nobody owns, whose ALL_TEAMS would see every team's", async () => {
      const unowned = await uniqueLang();
      try {
        await asSystem.query(
          `insert into "text_override" ("teamId", "lang", "source", "lineId", "text") values ($1, $2, 'places', 'z:1', 'Stray.')`,
          [b, unowned],
        );
        expect(await stampsWithOverrides("places", unowned, shared)).toEqual({ stamp: "shared:x", overrides: "-" });
      } finally {
        await asSystem.query(`delete from "text_override" where "lang" = $1`, [unowned]);
        await dropLang(unowned);
      }
    });

    it("stamp an outsider's read as the team they read, so its new override moves the stamp", async () => {
      const outsider = () => stampsWithOverrides("places", lang, shared);
      const before = await outsider();
      await asActor(v.id, () =>
        writeTextOverride({ source: "places", lang, lineId: "z:1", text: "First's.", original: "Old.", userId: v.id }),
      );
      const after = await outsider();
      expect(after.overrides).toMatch(/^1:/);
      expect(after).not.toEqual(before);
      expect(after.overrides).toBe(await overrideStamp("places", lang));
    });
  });
});
