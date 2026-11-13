/**
 * Accepting a report's text writes original text, so whoever holds the report's queue still needs
 * `text` to do it.
 *
 * Needs DATABASE_URL and migrations applied.
 */
import { readFileSync } from "node:fs";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb } from "@/lib/db";
import { envelopeFor } from "@/lib/reports/context";
import { asSystem, testUser } from "@/lib/teams/testing";

const { held, userId } = vi.hoisted(() => ({ held: new Set<string>(), userId: { id: "" } }));

vi.mock("@/lib/generation/authz", () => ({
  requireCapability: async (capability: string) =>
    held.has(capability)
      ? { session: { user: { id: userId.id } }, denied: null }
      : { session: null, denied: Response.json({ error: "not allowed" }, { status: 403 }) },
}));

import { GET, POST } from "./route";

const observed = readFileSync(
  new URL("../../../../../../../tests/fixtures/contributions/quests-observed.txt", import.meta.url),
  "utf8",
);

let user: Awaited<ReturnType<typeof testUser>>;
let id: number;

beforeAll(async () => {
  user = await testUser("test-report-contribute");
  userId.id = user.id;
  const envelope = envelopeFor(observed, "quests")!;
  const { rows } = await asSystem.query<{ id: number }>(
    `insert into "report" ("source", "lang", "lineId", "target", "category", "body", "teamId", "queue", "context", "ip")
     values ('quests', 'enUS', null, 'quest/1/accept', 'missing', 'test', team_of_lang('enUS'), 'audio', $1, $2)
     returning "id"`,
    [JSON.stringify({ fields: envelope.fields, text: envelope.text }), user.id],
  );
  id = rows[0].id;
});

afterAll(async () => {
  await asSystem.query(`delete from "report" where "ip" = $1`, [user.id]);
  await user.cleanup();
  await closeDb();
});

const post = () =>
  POST(
    new Request("https://example.com/api/reports/contribute", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id }),
    }),
  );

describe("/api/reports/contribute on an audio report", () => {
  it("answers a text maintainer without the queue 403", async () => {
    held.clear();
    held.add("text");
    expect((await post()).status).toBe(403);
  });

  it("lets the team read what the corpus makes of it, and not accept it", async () => {
    held.clear();
    held.add("edit");
    const read = await GET(new Request(`https://example.com/api/reports/contribute?id=${id}`));
    expect(read.status).not.toBe(403);
    expect((await post()).status).toBe(403);
  });
});
