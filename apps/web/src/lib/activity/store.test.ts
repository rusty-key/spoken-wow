/**
 * Against a real Postgres, like lib/takes/store.test.ts: what is worth pinning here is SQL
 * -- the language filter with its every-language rows, the keyset cursor at microsecond
 * precision, a batch's takes folded out of the page, and an event rolling back with its
 * transaction -- and a mocked database would only echo the statements back.
 *
 * Every row is written by a user made for the run and filtered by them, so the test can
 * share a database with real activity.
 *
 * Needs DATABASE_URL and migration 0050 applied.
 */
import { randomUUID } from "node:crypto";

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

const { closeDb, db } = await import("@/lib/db");
const { activityActors, groupRows, isDay, listActivity, recordActivities, recordActivity } = await import("./store");

let actor: string;

beforeAll(async () => {
  try {
    await db().query(`select 1 from "activity" limit 1`);
  } catch (error) {
    throw new Error(
      "store.test.ts needs a migrated database (migration 0050). Run:\n" +
        '  deploy/web/bin/migrate.sh "$PWD/apps/web"\n' +
        String(error),
    );
  }
});

beforeEach(async () => {
  actor = `activity-test-${randomUUID()}`;
  await db().query(
    `insert into "user" ("id", "name", "email", "emailVerified") values ($1, 'Tester', $2, true)`,
    [actor, `${actor}@example.test`],
  );
});

afterEach(async () => {
  await db().query(`delete from "activity" where "actorId" = $1`, [actor]);
  await db().query(`delete from "user" where "id" = $1`, [actor]);
});

afterAll(async () => {
  await closeDb();
});

describe("listActivity", () => {
  it("shows a language's rows and the every-language ones, not another language's", async () => {
    await recordActivity({ kind: "ignore.set", lang: "deDE", actorId: actor, subject: "de", detail: {} });
    await recordActivity({ kind: "ignore.set", lang: null, actorId: actor, subject: "all", detail: {} });
    await recordActivity({ kind: "ignore.set", lang: "frFR", actorId: actor, subject: "fr", detail: {} });

    const { rows } = await listActivity({ lang: "deDE", actorId: actor });

    expect(rows.map((row) => row.subject).sort()).toEqual(["all", "de"]);
    expect(rows[0].actorName).toBe("Tester");
  });

  it("filters by category", async () => {
    await recordActivity({ kind: "ignore.set", lang: "deDE", actorId: actor, detail: {} });
    await recordActivity({ kind: "grant.added", lang: "deDE", actorId: actor, detail: { capability: "edit" } });

    const { rows } = await listActivity({ lang: "deDE", actorId: actor, category: "admin" });

    expect(rows.map((row) => row.kind)).toEqual(["grant.added"]);
  });

  it("pages through rows written in the same millisecond without skipping any", async () => {
    // One statement, so every row shares a transaction timestamp to the microsecond: the
    // id is all that orders them, which is the case a cursor rounded through a Date loses.
    await recordActivities(
      Array.from({ length: 5 }, (_, n) => ({
        kind: "ignore.set" as const,
        lang: "deDE" as const,
        actorId: actor,
        subject: String(n),
        detail: {},
      })),
    );

    const seen: string[] = [];
    let before;
    for (let guard = 0; guard < 10; guard++) {
      const page = await listActivity({ lang: "deDE", actorId: actor, limit: 2, before });
      seen.push(...page.rows.map((row) => row.subject!));
      if (!page.next) break;
      before = page.next;
    }

    expect(seen.sort()).toEqual(["0", "1", "2", "3", "4"]);
  });

  it("folds a batch's takes under the batch and counts them there", async () => {
    const batchId = randomUUID();
    await recordActivity({
      kind: "batch.queued",
      lang: "deDE",
      source: "zones",
      actorId: actor,
      subject: batchId,
      detail: { batchId, count: 2 },
    });
    for (const version of [1, 2]) {
      await recordActivity({
        kind: "take.generated",
        lang: "deDE",
        source: "zones",
        actorId: actor,
        subject: `1411/test-${version}`,
        detail: { version, batchId },
      });
    }
    await recordActivity({
      kind: "take.generated",
      lang: "deDE",
      source: "zones",
      actorId: actor,
      subject: "1411/by-hand",
      detail: { version: 1 },
    });

    const { rows } = await listActivity({ lang: "deDE", actorId: actor });

    expect(rows.map((row) => row.kind).sort()).toEqual(["batch.queued", "take.generated"]);
    expect(rows.find((row) => row.kind === "batch.queued")?.takes).toBe(2);
    expect((await groupRows("deDE", "batch", batchId)).map((row) => row.subject).sort()).toEqual([
      "1411/test-1",
      "1411/test-2",
    ]);
  });

  it("folds a grouped clear of marks under its row, in its section", async () => {
    const groupId = randomUUID();
    await recordActivities([
      { kind: "marks.cleared", lang: "deDE", source: "quests", actorId: actor, detail: { groupId, count: 2 } },
      { kind: "take.acked", lang: "deDE", source: "quests", actorId: actor, subject: "a.mp3", detail: { groupId } },
      { kind: "take.acked", lang: "deDE", source: "quests", actorId: actor, subject: "b.mp3", detail: { groupId } },
    ]);
    await recordActivity({ kind: "take.acked", lang: "deDE", source: "quests", actorId: actor, subject: "c.mp3", detail: {} });

    const { rows } = await listActivity({ lang: "deDE", actorId: actor, source: "quests" });

    expect(rows.map((row) => row.kind).sort()).toEqual(["marks.cleared", "take.acked"]);
    expect(rows.find((row) => row.kind === "take.acked")?.subject).toBe("c.mp3");
    expect((await groupRows("deDE", "marks", groupId)).map((row) => row.subject).sort()).toEqual([
      "a.mp3",
      "b.mp3",
    ]);
  });
});

/**
 * A batch is queued once and cuts takes for as long as the queue takes, so a day filter
 * has to find it by its takes as well as by when it was queued.
 */
describe("listActivity by day, with a batch that runs past midnight", () => {
  const DAY = "2026-03-10";
  let batchId: string;

  /** Move one of this test's rows to a time given relative to the start of DAY. */
  async function at(subject: string, offset: string) {
    await db().query(
      `update "activity" set "at" = $3::date + $4::interval where "actorId" = $1 and "subject" = $2`,
      [actor, subject, DAY, offset],
    );
  }

  async function queue(offset: string, takes: Record<string, string>) {
    batchId = randomUUID();
    await recordActivity({
      kind: "batch.queued",
      lang: "deDE",
      source: "zones",
      actorId: actor,
      subject: batchId,
      detail: { batchId, count: Object.keys(takes).length },
    });
    await at(batchId, offset);
    for (const [subject, cut] of Object.entries(takes)) {
      await recordActivity({
        kind: "take.generated",
        lang: "deDE",
        source: "zones",
        actorId: actor,
        subject,
        detail: { version: 1, batchId },
      });
      await at(subject, cut);
    }
  }

  /** The batch's row as a day filter shows it, and what opening that row lists. */
  async function seen(range: { from?: string; to?: string }) {
    const { rows } = await listActivity({ lang: "deDE", actorId: actor, ...range });
    const row = rows.find((candidate) => candidate.kind === "batch.queued");
    const opened = await groupRows("deDE", "batch", batchId, range);
    return { row, opened: opened.map((take) => take.subject).sort() };
  }

  it("shows yesterday's batch on the day it cut a take, counting only that day's", async () => {
    await queue("-30 minutes", { "1411/before": "-20 minutes", "1411/after": "10 minutes" });

    for (const range of [{ from: DAY, to: DAY }, { from: DAY }]) {
      const { row, opened } = await seen(range);
      expect(row?.takes).toBe(1);
      expect(opened).toEqual(["1411/after"]);
    }
  });

  it("shows it up to a `to` day by when it was queued, counting that range's takes", async () => {
    await queue("-30 minutes", { "1411/before": "-20 minutes", "1411/after": "10 minutes" });

    const { row, opened } = await seen({ to: "2026-03-09" });

    expect(row?.takes).toBe(1);
    expect(opened).toEqual(["1411/before"]);
  });

  it("leaves out a batch that cut nothing in the range", async () => {
    await queue("-30 minutes", { "1411/before": "-20 minutes" });

    expect((await seen({ from: DAY, to: DAY })).row).toBeUndefined();
  });

  it("does not reach back past the queue's retention for a batch", async () => {
    await queue("-40 days", { "1411/late": "10 minutes" });

    expect((await seen({ from: DAY })).row).toBeUndefined();
  });
});

describe("account events", () => {
  beforeEach(async () => {
    await recordActivity({ kind: "user.banned", lang: null, actorId: actor, subject: "someone", detail: { banReason: "spam" } });
    await recordActivity({ kind: "ignore.set", lang: "deDE", actorId: actor, detail: {} });
  });

  it("are shown to a global admin", async () => {
    const { rows } = await listActivity({ lang: "deDE", actorId: actor, global: true });
    expect(rows.map((row) => row.kind).sort()).toEqual(["ignore.set", "user.banned"]);
  });

  it("are hidden from somebody who is admin in one language only", async () => {
    const { rows } = await listActivity({ lang: "deDE", actorId: actor });
    expect(rows.map((row) => row.kind)).toEqual(["ignore.set"]);
  });

  it("do not put their actor in a language admin's person filter", async () => {
    await db().query(`delete from "activity" where "actorId" = $1 and "kind" = 'ignore.set'`, [actor]);

    expect((await activityActors("deDE")).map((person) => person.id)).not.toContain(actor);
    expect((await activityActors("deDE", true)).map((person) => person.id)).toContain(actor);
  });
});

describe("recordActivity", () => {
  it("rolls back with the transaction it was written in", async () => {
    const client = await db().connect();
    try {
      await client.query("begin");
      await recordActivity({ kind: "ignore.set", lang: "deDE", actorId: actor, detail: {} }, client);
      await client.query("rollback");
    } finally {
      client.release();
    }

    const { rows } = await listActivity({ lang: "deDE", actorId: actor });
    expect(rows).toEqual([]);
  });

  it("does not throw outside a transaction when the row cannot be written", async () => {
    // An actor that is no user breaks the foreign key: the act it describes must not fail.
    await expect(
      recordActivity({ kind: "ignore.set", lang: "deDE", actorId: `missing-${randomUUID()}`, detail: {} }),
    ).resolves.toBeUndefined();
  });
});

describe("isDay", () => {
  it("takes a real calendar day and nothing else", () => {
    expect(["2026-03-10", "2024-02-29", "0001-01-01"].every(isDay)).toBe(true);
    expect(["2026-02-30", "2025-02-29", "2026-13-01", "0000-01-01", "2026-3-10", "", undefined].some(isDay)).toBe(false);
  });
});
