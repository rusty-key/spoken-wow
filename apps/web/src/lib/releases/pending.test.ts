/** Needs DATABASE_URL and migrations applied. */
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { recordActivity } from "@/lib/activity/store";
import { closeDb } from "@/lib/db";
import { asSystem, ownTeam } from "@/lib/teams/testing";

import { pendingChanges } from "./pending";
import { RELEASE_SECTIONS } from "./sections";

const CUTOFF = new Date("2026-11-01T12:00:00Z");
const before = "2026-11-01T11:00:00Z";
const after = "2026-11-02T09:00:00Z";

async function take(file: string, version: number, at: string, { current = true, lang = "deDE", team = "" } = {}) {
  await asSystem.query(
    `insert into "take" ("source", "lang", "file", "lineId", "version", "isCurrent", "origin", "bytes", "createdAt", "teamId")
     values ('places', $1, $2, $3, $4, $5, 'generated', 1, $6, $7)`,
    [lang, file, `z:${file}`, version, current, at, team],
  );
}

describe("pendingChanges", () => {
  let de: Awaited<ReturnType<typeof ownTeam>>;

  beforeAll(async () => {
    de = await ownTeam("deDE");
  });

  afterEach(async () => {
    await asSystem.query(`delete from "take" where "file" like 'pending-test-%'`);
    await asSystem.query(`delete from "activity" where "subject" like 'pending-test-%' or "subject" like '%:pending-test-%'`);
    await asSystem.query(`delete from "lore_line" where "lineId" like 'z:pending-test-%'`);
  });

  afterAll(async () => {
    await de.restore();
    await closeDb();
  });

  it("counts the takes that went live after the last release, and nothing older or not live", async () => {
    await take("pending-test-old", 1, before, { team: de.team });
    await take("pending-test-new", 1, after, { team: de.team });
    await take("pending-test-replaced", 1, after, { team: de.team, current: false });
    await take("pending-test-replaced", 2, after, { team: de.team });

    const pending = await pendingChanges("places", "deDE", CUTOFF);
    expect(pending.count).toBe(2);
    expect(pending.changes.map((c) => [c.file, c.version, c.kind]).sort()).toEqual([
      ["pending-test-new", 1, "new"],
      ["pending-test-replaced", 2, "new"],
    ]);
    expect(pending.since).toBe(CUTOFF.toISOString());
  });

  async function restored(file: string, at: string) {
    await asSystem.query(
      `insert into "activity" ("at", "lang", "kind", "source", "subject", "detail", "teamId")
       values ($1, 'deDE', 'take.restored', 'places', $2, '{"version":1}', $3)`,
      [at, file, de.team],
    );
  }

  it("counts an older version put back since, once", async () => {
    // v2 was live at the release; going back to v1 is a change players have not had.
    await take("pending-test-restored", 1, "2026-11-01T10:00:00Z", { team: de.team });
    await take("pending-test-restored", 2, before, { team: de.team, current: false });
    await restored("pending-test-restored", "2026-11-02T08:00:00Z");
    await restored("pending-test-restored", after);
    const pending = await pendingChanges("places", "deDE", CUTOFF);
    expect(pending.changes).toEqual([expect.objectContaining({ file: "pending-test-restored", kind: "restored", version: 1 })]);
    expect(pending.restored).toBe(1);
  });

  it("does not count going back to what was live at the release", async () => {
    // v2 released, v3 cut and disliked, v2 put back: players already have it.
    await take("pending-test-undo", 2, before, { team: de.team });
    await take("pending-test-undo", 3, after, { team: de.team, current: false });
    await restored("pending-test-undo", after);
    expect((await pendingChanges("places", "deDE", CUTOFF)).count).toBe(0);
  });

  it("counts lines whose text or ignore changed with no new audio, once each", async () => {
    for (const kind of ["text.edited", "text.edited", "ignore.set"]) {
      await asSystem.query(
        `insert into "activity" ("at", "lang", "kind", "source", "subject", "lineId", "detail", "teamId")
         values ($1, 'deDE', $2, 'places', 'pending-test-text', $3, '{}', $4)`,
        [after, kind, kind === "ignore.set" ? "z:pending-test-b" : "z:pending-test-a", de.team],
      );
    }
    const pending = await pendingChanges("places", "deDE", CUTOFF);
    expect(pending.textChanges).toBe(2);
    expect(pending.count).toBe(0);
  });

  it("gives the counts alone without a list", async () => {
    await take("pending-test-new", 1, after, { team: de.team });
    const pending = await pendingChanges("places", "deDE", CUTOFF, { list: false });
    expect(pending).toMatchObject({ count: 1, changes: [], people: [] });
  });

  it("counts everything live when nothing was released yet", async () => {
    const start = (await pendingChanges("places", "deDE", null, { list: false })).count;
    await take("pending-test-old", 1, before, { team: de.team });
    expect((await pendingChanges("places", "deDE", null, { list: false })).count).toBe(start + 1);
  });

  /**
   * A difference, not a total: migration 0050 logs the seeded ignores at the moment it runs, so
   * on a freshly migrated database they all fall after CUTOFF.
   */
  async function textChangesAddedBy(act: () => Promise<unknown>) {
    const counts = () =>
      Promise.all(
        RELEASE_SECTIONS.map(async (section) => (await pendingChanges(section, "deDE", CUTOFF, { list: false })).textChanges),
      );
    const start = await counts();
    await act();
    const end = await counts();
    return Object.fromEntries(RELEASE_SECTIONS.map((section, i) => [section, end[i] - start[i]]));
  }

  it("counts a rename only in the sections whose build reads that kind of name", async () => {
    const added = await textChangesAddedBy(async () => {
      for (const subject of ["zone:pending-test-zone", "creature:pending-test-npc", "item:pending-test-owner", "quest:pending-test-quest"]) {
        await recordActivity({ kind: "name.edited", lang: "deDE", actorId: null, subject, detail: { version: 2 } });
      }
    });
    expect(added).toEqual({ places: 1, quests: 2, readables: 0, bosses: 0 });
  });

  it("counts an ignore set in every language, in the section it belongs to", async () => {
    const line = "pending-test-everywhere";
    const added = await textChangesAddedBy(() =>
      recordActivity({ kind: "ignore.set", lang: null, actorId: null, source: "quests", subject: line, lineId: line, detail: {} }),
    );
    expect(added).toEqual({ places: 0, quests: 1, readables: 0, bosses: 0 });
  });

  it("counts a line edited and then cut again once, as its new audio", async () => {
    await take("pending-test-both", 2, after, { team: de.team });
    await asSystem.query(
      `insert into "activity" ("at", "lang", "kind", "source", "subject", "lineId", "detail", "teamId")
       values ($1, 'deDE', 'text.edited', 'places', 'z:pending-test-both', 'z:pending-test-both', '{}', $2)`,
      ["2026-11-02T08:00:00Z", de.team],
    );
    const pending = await pendingChanges("places", "deDE", CUTOFF, { list: false });
    expect([pending.count, pending.textChanges]).toEqual([1, 0]);
  });

  it("reads what was live at the release from a restore made before it", async () => {
    // v1 put back before the release, so players have v1; putting v2 back since is a change.
    await take("pending-test-twice", 1, "2026-11-01T09:00:00Z", { team: de.team, current: false });
    await take("pending-test-twice", 2, "2026-11-01T10:00:00Z", { team: de.team });
    await asSystem.query(
      `insert into "activity" ("at", "lang", "kind", "source", "subject", "detail", "teamId")
       values ('2026-11-01T11:00:00Z', 'deDE', 'take.restored', 'places', 'pending-test-twice', '{"version":1}', $1)`,
      [de.team],
    );
    await restored("pending-test-twice", after);
    expect((await pendingChanges("places", "deDE", CUTOFF, { list: false })).count).toBe(1);
  });

  it("leaves out another team's takes in the same language", async () => {
    const fr = await ownTeam("frFR");
    try {
      await take("pending-test-theirs", 1, after, { team: fr.team });
      expect((await pendingChanges("places", "deDE", CUTOFF, { list: false })).count).toBe(0);
    } finally {
      await fr.restore();
    }
  });

  it("names each line and says what it says, and counts who cut them", async () => {
    await take("pending-test-zone", 1, after, { team: de.team });
    await asSystem.query(
      `insert into "lore_line" ("lineId", "lang", "version", "isCurrent", "origin", "mapID", "kind", "name", "full", "short")
       values ('z:pending-test-zone', 'deDE', 1, true, 'translated', 1, 'zone', 'Wald von Elwynn', 'Ein friedlicher Wald.', '')`,
    );
    const pending = await pendingChanges("places", "deDE", CUTOFF);
    expect(pending.changes[0]).toMatchObject({ title: "Wald von Elwynn", text: "Ein friedlicher Wald." });
    expect(pending.restored).toBe(0);
    expect(pending.people).toEqual([{ id: null, name: null, count: 1 }]);
  });

  it.each(["quests", "places", "readables", "bosses"] as const)("runs %s's text lookup", async (section) => {
    await asSystem.query(
      `insert into "take" ("source", "lang", "file", "lineId", "version", "isCurrent", "origin", "bytes", "createdAt", "teamId")
       values ($1, 'deDE', 'pending-test-each', 'boss:1:pending-test', 1, true, 'generated', 1, $2, $3)`,
      [section, after, de.team],
    );
    const pending = await pendingChanges(section, "deDE", CUTOFF);
    expect(pending.changes).toEqual([expect.objectContaining({ file: "pending-test-each", title: null, text: null })]);
  });
});
