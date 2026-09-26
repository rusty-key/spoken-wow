/**
 * acknowledge() against a real Postgres: what it has to get right is that the marks and the
 * log rows describing them land together -- a click's row that failed while its files' rows
 * were written would hide those files from the log for good.
 *
 * Every row is written by a user made for the run, on files named for it.
 *
 * Needs DATABASE_URL and the migrations applied.
 */
import { randomUUID } from "node:crypto";

import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";

import type { Lang } from "@/lib/lang";

const { closeDb, db } = await import("@/lib/db");
const { acknowledge } = await import("./dirty");

let actor: string;
let prefix: string;

beforeEach(async () => {
  actor = `ack-test-${randomUUID()}`;
  prefix = `ack-test/${randomUUID()}`;
  await db().query(
    `insert into "user" ("id", "name", "email", "emailVerified") values ($1, 'Tester', $2, true)`,
    [actor, `${actor}@example.test`],
  );
});

afterEach(async () => {
  await db().query(`delete from "take_ack" where "file" like $1`, [`${prefix}/%`]);
  await db().query(`delete from "activity" where "actorId" = $1`, [actor]);
  await db().query(`delete from "user" where "id" = $1`, [actor]);
});

afterAll(async () => {
  await closeDb();
});

const logged = async () =>
  (
    await db().query<{ kind: string; source: string; subject: string | null; detail: Record<string, unknown> }>(
      `select "kind", "source", "subject", "detail" from "activity" where "actorId" = $1 order by "id"`,
      [actor],
    )
  ).rows;

const acked = async () =>
  (await db().query(`select 1 from "take_ack" where "file" like $1`, [`${prefix}/%`])).rowCount;

describe("acknowledge", () => {
  it("logs a click that cleared several marks as one row, its files grouped under it", async () => {
    const files = [`${prefix}/a.mp3`, `${prefix}/b.mp3`, `${prefix}/c.mp3`];

    await acknowledge("quests", files, actor, "deDE");

    const rows = await logged();
    const [click, ...marks] = rows;
    expect(click).toMatchObject({ kind: "marks.cleared", source: "quests", subject: null });
    expect(click.detail).toMatchObject({ count: 3 });
    expect(marks.map((row) => row.subject)).toEqual(files);
    expect(new Set(marks.map((row) => row.detail.groupId))).toEqual(new Set([click.detail.groupId]));
    expect(await acked()).toBe(3);
  });

  it("logs one mark as a plain row, with nothing to fold", async () => {
    await acknowledge("quests", [`${prefix}/a.mp3`], actor, "deDE");

    const rows = await logged();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kind: "take.acked", subject: `${prefix}/a.mp3`, detail: {} });
  });

  it("clears nothing when the log cannot be written", async () => {
    // take_ack takes any language code, activity checks it: the second write fails after the
    // first succeeded, which is the case a transaction is there for.
    await expect(
      acknowledge("quests", [`${prefix}/a.mp3`, `${prefix}/b.mp3`], actor, "xx" as Lang),
    ).rejects.toThrow();

    expect(await acked()).toBe(0);
    expect(await logged()).toEqual([]);
  });
});
