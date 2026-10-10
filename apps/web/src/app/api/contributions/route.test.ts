/**
 * The second public write path, against a real Postgres.
 *
 * Every defence here is only observable end to end, as the reports route's test says: a
 * honeypot that returned 400 would pass a unit test of the validator and still teach a script
 * to drop the field.
 *
 * Needs DATABASE_URL and migrations applied:
 *   docker compose up -d postgres && deploy/bin/migrate.sh "$PWD/web"
 */
import { readFileSync } from "node:fs";

import { afterAll, afterEach, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/lib/db";
import { checksum } from "@/lib/contributions/envelope";

vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("@/lib/auth", () => ({ auth: { api: { getSession: async () => null } } }));
// Wrapped rather than replaced, so every test but the one below still resolves for real --
// this only needs a way to make resolution throw on demand.
vi.mock("@/lib/npc/resolve", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/npc/resolve")>();
  return { ...actual, resolveNpc: vi.fn(actual.resolveNpc) };
});

import { resolveNpc } from "@/lib/npc/resolve";

import { POST } from "./route";

// A bucket no other run shares, so the rate-limit test can count one IP safely. The same
// reasoning as lib/reports/store.test.ts -- a fixed literal collides between concurrent runs
// against the shared dev database, and the collision shows up as a wrong count rather than an
// obvious failure.
const ip = `203.0.113.${Math.floor(Math.random() * 200) + 20}`;
const envelope = readFileSync(
  new URL("../../../../../../tests/fixtures/contributions/quests-accept.txt", import.meta.url),
  "utf8",
);
const zonesEnvelope = readFileSync(
  new URL("../../../../../../tests/fixtures/contributions/zones-subzone.txt", import.meta.url),
  "utf8",
);
const observedEnvelope = readFileSync(
  new URL("../../../../../../tests/fixtures/contributions/quests-observed.txt", import.meta.url),
  "utf8",
);

function post(body: unknown): Request {
  return new Request("https://example.com/api/contributions", {
    method: "POST",
    headers: { "content-type": "application/json", "x-real-ip": ip },
    body: JSON.stringify(body),
  });
}

/**
 * A gossip envelope with the given npc field, checksummed the way the addon's writer does --
 * so the overflow test below exercises checkEnvelope, submissionFrom and observedFrom exactly
 * as a real paste would, rather than constructing a Submission by hand and skipping the parts
 * of the pipeline the bug actually lived in.
 */
function gossipEnvelope(npc: string): string {
  const body = `!SPOKEN1 quests\naddon=SpokenQuests/2.0.4\nbuild=1.60.1/69913\nlocale=enUS\nnpc=${npc}\nkind=creature\ntext<<\nHail.\n>>\n`;
  return `${body}sum=${checksum(body)}\n`;
}

afterEach(async () => {
  await db().query(`delete from "contribution" where "ip" = $1`, [ip]);
  await db().query(`delete from "contribution_hit" where "ip" = $1`, [ip]);
  // The observed-npc test resolves npc 9123 into a row this database does not otherwise carry.
  await db().query(`delete from "npc" where "npcId" = $1`, [9123]);
  // Nothing to clean up for the overflow test's npc id: the whole point of the fix is that no
  // row is ever written for it, and "npcId" is `integer`, so comparing it against a literal
  // this large would itself fail to cast.
});

afterAll(async () => {
  await closeDb();
});

describe("POST /api/contributions", () => {
  it("stores a pasted envelope", async () => {
    expect((await POST(post({ envelope, body: "Nothing played." }))).status).toBe(200);
    const { rows } = await db().query<{ key: string; locale: string }>(
      `select "key", "locale" from "contribution" where "ip" = $1`,
      [ip],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].key).toBe("9123:accept");
    expect(rows[0].locale).toBe("ruRU");
  });

  it("refuses a place with no lore unless the player describes it", async () => {
    const bare = await POST(post({ envelope: zonesEnvelope, body: "It's empty." }));
    expect(bare.status).toBe(400);
    expect((await bare.json()).error).toBe("describe");

    const short = await POST(post({ envelope: zonesEnvelope, description: "idk" }));
    expect(short.status).toBe(400);

    const { rows } = await db().query(`select 1 from "contribution" where "ip" = $1`, [ip]);
    expect(rows).toHaveLength(0);
  });

  it("keeps a place's description as the contribution's text", async () => {
    const description = "A drafty nook behind the forge where the smiths leave their broken tongs.";
    expect((await POST(post({ envelope: zonesEnvelope, description }))).status).toBe(200);
    const { rows } = await db().query<{ key: string; text: string }>(
      `select "key", "text" from "contribution" where "ip" = $1`,
      [ip],
    );
    expect(rows).toEqual([{ key: "1537:A Nook With No Lore", text: description }]);
  });

  it("answers a filled honeypot with 200 and writes nothing", async () => {
    expect((await POST(post({ envelope, website: "http://spam.example" }))).status).toBe(200);
    const { rows } = await db().query(`select 1 from "contribution" where "ip" = $1`, [ip]);
    expect(rows).toHaveLength(0);
    // Not just the row: a bot that trips the honeypot must not be able to fill another
    // person's rate-limit bucket by sharing a NAT.
    const hits = await db().query(`select 1 from "contribution_hit" where "ip" = $1`, [ip]);
    expect(hits.rows).toHaveLength(0);
  });

  it("refuses a tampered envelope", async () => {
    const response = await POST(post({ envelope: envelope.replace("9123", "9124") }));
    expect(response.status).toBe(400);
    expect((await response.json()).error).toBe("checksum");
  });

  it("refuses a body larger than the cap without parsing it", async () => {
    expect((await POST(post({ envelope: "x".repeat(200_000) }))).status).toBe(413);
  });

  it("reports a missing envelope as missing, not as a truncated paste", async () => {
    const response = await POST(post({}));
    expect(response.status).toBe(400);
    expect((await response.json()).error).toBe("missing");
  });

  it("reports a non-string envelope as missing too", async () => {
    const response = await POST(post({ envelope: 12345 }));
    expect(response.status).toBe(400);
    expect((await response.json()).error).toBe("missing");
  });

  // Ten pastes of the same envelope are one row and ten hits; the limit is on the person.
  it("stops at the hourly limit", async () => {
    for (let i = 0; i < 10; i++) {
      expect((await POST(post({ envelope }))).status).toBe(200);
    }
    expect((await POST(post({ envelope }))).status).toBe(429);
  });

  // The fixture's npc (9123) is not in the corpus, so this is the client-reported path: its
  // model id (122055) maps to tauren/male in character-models.json. tauren-male has no
  // "standard" voice in the game at all (see corpus.test.ts's defaultFlavorFor), so "warrior"
  // -- its busiest -- is the honest default, and the flagship case finding 2 was about.
  it("works out who is speaking as the contribution lands", async () => {
    expect((await POST(post({ envelope: observedEnvelope }))).status).toBe(200);

    const { rows } = await db().query<{
      race: string;
      flavor: string;
      provenance: string;
      confirmed: boolean;
      build: string;
    }>(`select "race", "flavor", "provenance", "confirmed", "build" from "npc" where "npcId" = $1`, [
      9123,
    ]);
    expect(rows[0]).toMatchObject({
      race: "tauren", flavor: "warrior", provenance: "client", confirmed: false,
    });
    // submissionFrom pulls `build` out of meta into its own column, so observedFrom(meta)
    // alone would never see it -- the intake route has to pass it back in explicitly. The
    // fixture's own build=1.60.1/69913 line is what makes this a real assertion rather than
    // one that would pass against `undefined` too.
    expect(rows[0].build).toBe("1.60.1/69913");
  });

  // The text is the thing worth keeping; an NPC resolution error must not cost the contribution.
  it("stores the contribution even when npc resolution throws", async () => {
    vi.mocked(resolveNpc).mockImplementationOnce(() => {
      throw new Error("boom");
    });
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    expect((await POST(post({ envelope: observedEnvelope }))).status).toBe(200);
    const { rows } = await db().query(`select 1 from "contribution" where "ip" = $1`, [ip]);
    expect(rows).toHaveLength(1);
    expect(consoleError).toHaveBeenCalled();

    consoleError.mockRestore();
  });

  // checkEnvelope only requires the npc field's digit run to end at a space, with no magnitude
  // bound, so npc=99999999999 Foo + kind=creature is a contribution this route accepts and
  // stores. Before observedFrom bounded npcId (see resolve.test.ts), Postgres rejected the
  // npc_resolution insert with "value out of range for type integer", swallowed here by the
  // try/catch below -- so the contribution still landed, but poisoned: a permanent row whose
  // npcId no query against `integer` could ever ask about again without itself failing to
  // cast. This pins the fixed behaviour: the contribution still stores, and there is nothing
  // left for the triage page or the export to trip over.
  it("stores the contribution but writes no resolution for an npc id past Postgres's integer range", async () => {
    const response = await POST(post({ envelope: gossipEnvelope("99999999999 Foo") }));
    expect(response.status).toBe(200);

    const { rows } = await db().query<{ key: string }>(
      `select "key" from "contribution" where "ip" = $1`,
      [ip],
    );
    expect(rows[0]?.key).toBe("npc:99999999999");
  });

  it("never queues generation", async () => {
    const before = await db().query(`select count(*)::text as count from "regeneration_job"`);
    await POST(post({ envelope }));
    const after = await db().query(`select count(*)::text as count from "regeneration_job"`);
    // Counted rather than asserted empty: this database holds real jobs.
    expect(after.rows[0].count).toBe(before.rows[0].count);
  });
});
