/**
 * The store, against a real Postgres.
 *
 * Needs DATABASE_URL and migrations applied:
 *   docker compose up -d postgres && deploy/bin/migrate.sh "$PWD/web"
 */
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";

import { closeDb, db } from "@/lib/db";

import {
  acceptedContributions,
  contributionSenders,
  countRecentContributions,
  createContribution,
  fillContributionNpcs,
  listContributions,
  observationMeta,
  recordContributionHit,
  setContributionNpc,
  setContributionNpcKind,
  setContributionStatus,
} from "./store";

/** resolvedBy has a foreign key, so resolving needs a user that exists (as in reports/store.test.ts). */
const RESOLVER = "test-contribution-resolver";

/** A bucket no other run shares, so tests can count rows for one IP safely (reports/store.test.ts:18). */
let ip: string;

/**
 * "dedup" is unique-indexed, so a literal shared with a concurrent run collides there too --
 * and worse than the ip case, a collision there doesn't fail loudly, it just bumps someone
 * else's count and shows up as a bogus number instead of an obvious assertion failure.
 */
let dedup: string;

/**
 * This run's triage key.
 *
 * The listing helpers take a status and nothing else, so an assertion that counts what comes
 * back counts every row in the table -- including the real ones a developer filed by hand while
 * testing the addon. Those are not pollution to be cleared; they are the data this feature
 * exists to collect, and a test that only passes against an empty database is a test that fails
 * the first time the feature is used.
 */
let key: string;

function ours<T extends { key: string }>(rows: T[]): T[] {
  return rows.filter((row) => row.key === key);
}

function submission(overrides: Record<string, unknown> = {}) {
  return {
    source: "quests" as const,
    key,
    locale: "ruRU",
    build: "1.12.1/5875",
    text: "Убей шестерых.",
    meta: { npc: "12345 X" },
    raw: "!SPOKEN1 quests\n",
    dedup: `${dedup}-one`,
    body: null,
    name: null,
    email: null,
    userId: null,
    ip,
    ...overrides,
  };
}

beforeEach(async () => {
  ip = `test-${Math.random().toString(36).slice(2, 10)}`;
  dedup = `test-${Math.random().toString(36).slice(2, 10)}`;
  key = `${Math.floor(Math.random() * 1e9)}:accept`;
  await db().query(
    `insert into "user" ("id", "name", "email", "emailVerified")
     values ($1, 'Test Resolver', $2, false)
     on conflict ("id") do nothing`,
    [RESOLVER, `${RESOLVER}@example.invalid`],
  );
});

afterEach(async () => {
  await db().query(
    `delete from "activity" where "kind" like 'contribution.%'
        and "subject" in (select "id"::text from "contribution" where "ip" = $1)`,
    [ip],
  );
  await db().query(`delete from "contribution" where "ip" = $1`, [ip]);
  await db().query(`delete from "contribution_hit" where "ip" = $1`, [ip]);
});

afterAll(async () => {
  await db().query(`delete from "user" where "id" = $1`, [RESOLVER]);
  await closeDb();
});

describe("createContribution", () => {
  it("stores one", async () => {
    await createContribution(submission());
    const [row] = ours(await listContributions("new"));
    expect(row.key).toBe(key);
    expect(row.meta.npc).toBe("12345 X");
    expect(row.count).toBe(1);
  });

  it("bumps the count when the same text arrives again", async () => {
    await createContribution(submission());
    await createContribution(submission());
    const rows = ours(await listContributions("new"));
    expect(rows).toHaveLength(1);
    expect(rows[0].count).toBe(2);
  });

  it("lists most sent first by default, and in a column's order when asked", async () => {
    // The older row is sent twice, so the two orders disagree about which comes first.
    await createContribution(submission());
    await createContribution(submission());
    await db().query(`update "contribution" set "createdAt" = now() - interval '1 day' where "ip" = $1`, [ip]);
    await createContribution(submission({ text: "Kill six.", dedup: `${dedup}-two` }));

    expect(ours(await listContributions("new")).map((row) => row.text)).toEqual(["Убей шестерых.", "Kill six."]);
    const filed = (direction: "asc" | "desc") =>
      listContributions("new", undefined, { column: "filed", direction }).then((rows) => ours(rows).map((row) => row.text));
    expect(await filed("desc")).toEqual(["Kill six.", "Убей шестерых."]);
    expect(await filed("asc")).toEqual(["Убей шестерых.", "Kill six."]);
  });

  it("names each copy's sender, counting the unnamed ones as anonymous", async () => {
    await createContribution(submission({ userId: RESOLVER }));
    await createContribution(submission({ userId: RESOLVER }));
    await createContribution(submission({ name: "Thrall" }));
    await createContribution(submission());
    const [row] = ours(await listContributions("new"));
    expect(row.count).toBe(4);
    expect(await contributionSenders(row.id)).toEqual({
      senders: [
        { name: "Test Resolver", count: 2 },
        { name: "Thrall", count: 1 },
      ],
      anonymous: 1,
    });
  });

  it("has no senders for a contribution that does not exist", async () => {
    expect(await contributionSenders(-1)).toBeNull();
  });

  it("lists one section's rows when asked for one", async () => {
    await createContribution(submission());
    await createContribution(submission({ source: "books", dedup: `${dedup}-two` }));
    const sources = async (source?: "quests" | "books") =>
      ours(await listContributions("new", undefined, undefined, source)).map((row) => row.source);
    expect((await sources()).sort()).toEqual(["books", "quests"]);
    expect(await sources("books")).toEqual(["books"]);
  });

  it("keeps different text for the same key as its own row", async () => {
    await createContribution(submission());
    await createContribution(submission({ text: "Kill six.", dedup: `${dedup}-two` }));
    expect(ours(await listContributions("new"))).toHaveLength(2);
  });

  it("fills in the NPC a first copy lacked when the same line comes back naming one", async () => {
    await createContribution(submission({ meta: { event: "accept" }, raw: "first" }));
    await createContribution(
      submission({ meta: { npc: "12345 X", kind: "creature", model: "968705" }, raw: "second" }),
    );
    const [row] = ours(await listContributions("new"));
    expect(row.count).toBe(2);
    expect(row.meta).toEqual({ event: "accept", npc: "12345 X", kind: "creature", model: "968705" });
    expect(row.raw).toBe("second");
  });

  it("keeps the NPC a first copy named over a resend naming another", async () => {
    await createContribution(submission({ raw: "first" }));
    await createContribution(submission({ meta: { npc: "999 Y" }, raw: "second" }));
    const [row] = ours(await listContributions("new"));
    expect(row.meta.npc).toBe("12345 X");
    expect(row.raw).toBe("first");
  });
});

describe("fillContributionNpcs", () => {
  it("fills a row with no NPC without counting the resend", async () => {
    await createContribution(submission({ meta: {}, raw: "first" }));
    const filled = await fillContributionNpcs([
      { dedup: `${dedup}-one`, meta: { npc: "12345 X", kind: "creature" }, raw: "second" },
    ]);
    expect(filled).toEqual([`${dedup}-one`]);
    const [row] = ours(await listContributions("new"));
    expect(row.count).toBe(1);
    expect(row.meta).toEqual({ npc: "12345 X", kind: "creature" });
    expect(row.raw).toBe("second");
  });

  it("returns only the rows it changed", async () => {
    await createContribution(submission());
    await createContribution(submission({ meta: {}, text: "Kill six.", dedup: `${dedup}-two` }));
    const filled = await fillContributionNpcs([
      { dedup: `${dedup}-one`, meta: { npc: "999 Y" }, raw: "x" },
      { dedup: `${dedup}-two`, meta: { npc: "999 Y" }, raw: "x" },
      { dedup: `${dedup}-none`, meta: { npc: "1 Z" }, raw: "x" },
    ]);
    expect(filled).toEqual([`${dedup}-two`]);
    const rows = ours(await listContributions("new"));
    expect(rows.find((row) => row.text === "Kill six.")?.meta.npc).toBe("999 Y");
    expect(rows.find((row) => row.text !== "Kill six.")?.meta.npc).toBe("12345 X");
  });

  it("does nothing for an empty list", async () => {
    expect(await fillContributionNpcs([])).toEqual([]);
  });
});

describe("countRecentContributions", () => {
  it("counts inside the window and not outside it", async () => {
    await recordContributionHit(ip);
    expect(await countRecentContributions(ip, 60_000)).toBe(1);
    await db().query(
      `update "contribution_hit" set "createdAt" = now() - interval '2 hours' where "ip" = $1`,
      [ip],
    );
    expect(await countRecentContributions(ip, 60 * 60 * 1000)).toBe(0);
  });

  // The reason this table exists: ten identical pastes are one row and ten hits.
  it("counts a repeat paste that the dedup upsert collapsed into one row", async () => {
    for (let i = 0; i < 3; i++) {
      await createContribution(submission());
      await recordContributionHit(ip);
    }
    expect(ours(await listContributions("new"))).toHaveLength(1);
    expect(await countRecentContributions(ip, 60_000)).toBe(3);
  });
});

describe("setContributionStatus", () => {
  it("accepts a row and lists it for export", async () => {
    await createContribution(submission());
    const [row] = ours(await listContributions("new"));
    const updated = await setContributionStatus(row.id, "accepted", RESOLVER);
    expect(updated?.status).toBe("accepted");
    expect((await acceptedContributions()).map((r) => r.id)).toContain(row.id);
  });

  it("answers null for an id that is not there", async () => {
    expect(await setContributionStatus(999_999_999, "accepted", RESOLVER)).toBe(null);
  });
});

describe("setContributionNpcKind", () => {
  it("records a kind for a kind-less envelope", async () => {
    await createContribution(submission());
    const [row] = ours(await listContributions("new"));
    expect(await setContributionNpcKind(row.id, "gameobject", RESOLVER)).toBe(true);
    const [after] = ours(await listContributions("new"));
    expect(after.npcKind).toBe("gameobject");
    expect(observationMeta(after).kind).toBe("gameobject");
  });

  it("refuses to override the kind the client's own envelope carried", async () => {
    await createContribution(submission({ meta: { npc: "12345 X", kind: "creature" } }));
    const [row] = ours(await listContributions("new"));
    expect(await setContributionNpcKind(row.id, "gameobject", RESOLVER)).toBe(false);
    expect(observationMeta(row).kind).toBe("creature");
  });
});

describe("setContributionNpc", () => {
  it("names the NPC of an envelope that named none", async () => {
    await createContribution(submission({ meta: {} }));
    const [row] = ours(await listContributions("new"));
    expect(await setContributionNpc(row.id, { npcKind: "creature", npcId: 240, npcName: "Marshal Dughan" }, RESOLVER)).toMatchObject({
      npcId: 240,
      npcName: "Marshal Dughan",
    });
    const [after] = ours(await listContributions("new"));
    expect(after.meta).toEqual({});
    expect(observationMeta(after)).toMatchObject({ npc: "240 Marshal Dughan", kind: "creature" });
  });

  it("refuses to override the NPC the client's own envelope named", async () => {
    await createContribution(submission());
    const [row] = ours(await listContributions("new"));
    expect(await setContributionNpc(row.id, { npcKind: "creature", npcId: 240, npcName: "Marshal Dughan" }, RESOLVER)).toBe(null);
    expect(observationMeta(ours(await listContributions("new"))[0]).npc).toBe("12345 X");
  });
});

describe("observationMeta", () => {
  const stored = { npcKind: null, npcId: null, npcName: null };

  it("puts build back and leaves an envelope's own kind alone", () => {
    expect(
      observationMeta({ ...stored, meta: { kind: "creature", npc: "1 X" }, build: "1.15.7/1", npcKind: "gameobject" }),
    ).toEqual({ kind: "creature", npc: "1 X", build: "1.15.7/1" });
  });

  it("leaves an envelope's own npc alone", () => {
    expect(
      observationMeta({ ...stored, meta: { npc: "1 X" }, build: "1.15.7/1", npcId: 2, npcName: "Y" }).npc,
    ).toBe("1 X");
  });
});
