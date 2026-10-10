/**
 * What the pipelines read, against a real Postgres.
 *
 * Needs DATABASE_URL and migrations applied.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/lib/db";
import { createContribution, setContributionNpcKind, setContributionStatus } from "@/lib/contributions/store";
import { upsertResolution } from "@/lib/npc/store";

vi.mock("@/lib/generation/authz", () => ({
  requireRegenerate: async () => ({ session: { user: { id: RESOLVER } }, denied: null }),
}));

import { GET } from "./route";

/** setContributionStatus's resolvedBy has a foreign key, so accepting a row needs a real user. */
const RESOLVER = "test-contributions-export-route";

/** A bucket no other run shares, so a concurrent run's cleanup can't race this one's rows. */
const ip = `test-${Math.random().toString(36).slice(2, 10)}`;
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
  await db().query(
    `delete from "activity" where "kind" like 'contribution.%'
        and "subject" in (select "id"::text from "contribution" where "ip" = $1)`,
    [ip],
  );
  await db().query(`delete from "contribution" where "ip" = $1`, [ip]);
  await db().query(`delete from "npc" where "npcId" = $1`, [npcId]);
});

afterAll(async () => {
  await db().query(`delete from "user" where "id" = $1`, [RESOLVER]);
  await closeDb();
});

async function acceptedRow(key: string, meta: Record<string, string>) {
  await createContribution({
    source: "quests",
    key,
    locale: "enUS",
    build: "1.12.1.5875",
    text: "Some line of dialogue.",
    meta,
    raw: `raw:${key}`,
    dedup: `dedup:${key}:${ip}`,
    body: null,
    name: null,
    email: null,
    userId: null,
    ip,
  });
  const { rows } = await db().query<{ id: number }>(
    `select "id" from "contribution" where "dedup" = $1`,
    [`dedup:${key}:${ip}`],
  );
  await setContributionStatus(rows[0].id, "accepted", RESOLVER);
  return rows[0].id;
}

/** A resolution for this run's npcId, as the given kind and with the given voice. */
async function answer(npcKind: "creature" | "gameobject", race: string, provenance: "moderator" | "corpus") {
  await upsertResolution({
    npcKind,
    npcId,
    npcName: "Some Guard",
    race,
    gender: "male",
    flavor: null,
    provenance,
    confirmed: true,
    doubtful: false,
    modelFileId: null,
    sex: null,
    creatureType: null,
    build: null,
    note: null,
    resolvedBy: RESOLVER,
  });
}

async function exported(): Promise<Array<Record<string, unknown>>> {
  const response = await GET();
  const text = await response.text();
  return text
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

describe("GET /api/contributions/export", () => {
  it("carries the resolved race, gender, flavor and provenance for a row with a known npc", async () => {
    await upsertResolution({
      npcKind: "creature",
      npcId,
      npcName: "Some Guard",
      race: "tauren",
      gender: "male",
      flavor: "grim",
      provenance: "moderator",
      confirmed: true,
      doubtful: false,
      modelFileId: 122055,
      sex: 0,
      creatureType: "Humanoid",
      build: "1.12.1.5875",
      note: null,
      resolvedBy: RESOLVER,
    });

    await acceptedRow(`npc:${npcId}`, { kind: "creature", npc: `${npcId} Some Guard` });

    const rows = await exported();
    const row = rows.find((r) => r.key === `npc:${npcId}`);
    expect(row).toMatchObject({
      race: "tauren",
      gender: "male",
      flavor: "grim",
      npcProvenance: "moderator",
      npcConfirmed: true,
    });
  });

  // The addon's earliest envelopes carry no `kind`: answered by id alone, as triage and accept do.
  it("carries a moderator's answer for a kind-less row", async () => {
    await answer("creature", "tauren", "moderator");
    await acceptedRow(`kindless:${npcId}`, { npc: `${npcId} Some Guard` });

    const row = (await exported()).find((r) => r.key === `kindless:${npcId}`);
    expect(row).toMatchObject({ race: "tauren", npcProvenance: "moderator", npcKind: "creature", npcConflict: false });
  });

  it("leaves the speaker null and flags a conflict when two kinds disagree", async () => {
    await answer("creature", "tauren", "moderator");
    await answer("gameobject", "human", "corpus");
    await acceptedRow(`conflict:${npcId}`, { npc: `${npcId} Some Guard` });

    const row = (await exported()).find((r) => r.key === `conflict:${npcId}`);
    expect(row).toMatchObject({ race: null, gender: null, npcProvenance: null, npcConflict: true });
  });

  it("reads a conflicted row by the kind a moderator chose for it", async () => {
    await answer("creature", "tauren", "moderator");
    await answer("gameobject", "human", "corpus");
    const id = await acceptedRow(`chosen:${npcId}`, { npc: `${npcId} Some Guard` });
    expect(await setContributionNpcKind(id, "gameobject", RESOLVER)).toBe(true);

    const row = (await exported()).find((r) => r.key === `chosen:${npcId}`);
    expect(row).toMatchObject({ race: "human", npcKind: "gameobject", npcConflict: false });
  });

  it("leaves the npc fields null and unconfirmed for a row with no resolution", async () => {
    await acceptedRow(`plain:${npcId}`, { locale: "enUS" });

    const rows = await exported();
    const row = rows.find((r) => r.key === `plain:${npcId}`);
    expect(row).toMatchObject({
      race: null,
      gender: null,
      flavor: null,
      npcProvenance: null,
      npcConfirmed: false,
    });
  });

  // checkEnvelope only requires a digit run ending at a space, with no magnitude bound, so a
  // contribution with an npc id past Postgres's `integer` range (2147483647) can and does land
  // in the table -- the intake route's insert of the contribution itself has no int column to
  // overflow. Before observedFrom bounded npcId, this row's meta reaching unnest($2::int[])
  // here 500'd the whole export; now observedFrom answers npcId: null for it, so it is treated
  // exactly like a row with no npc at all rather than crashing the route.
  it("does not 500 on a row whose npc id overflows Postgres's integer range", async () => {
    await acceptedRow("overflow:99999999999", { kind: "creature", npc: "99999999999 Foo" });

    const rows = await exported();
    const row = rows.find((r) => r.key === "overflow:99999999999");
    expect(row).toMatchObject({ race: null, npcProvenance: null, npcConfirmed: false });
  });

  // The whitelist discipline the route's own docstring calls out: nothing gained here may open
  // a hole in it.
  it("still excludes the fields the export deliberately never carries", async () => {
    await acceptedRow(`plain2:${npcId}`, { locale: "enUS" });

    const rows = await exported();
    const row = rows.find((r) => r.key === `plain2:${npcId}`);
    expect(row).toBeDefined();
    expect(row).not.toHaveProperty("ip");
    expect(row).not.toHaveProperty("raw");
    expect(row).not.toHaveProperty("userId");
    expect(row).not.toHaveProperty("body");
    expect(row).not.toHaveProperty("email");
    expect(row).not.toHaveProperty("name");
  });
});
