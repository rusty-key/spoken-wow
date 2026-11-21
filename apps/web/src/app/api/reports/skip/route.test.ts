/**
 * Needs DATABASE_URL and migrations applied.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/lib/db";
import { asSystem } from "@/lib/teams/testing";
import { createReport, skippedIds } from "@/lib/reports/store";

const USER = `test-skip-${Math.random().toString(36).slice(2, 10)}`;
const IP = `test-skip-${Math.random().toString(36).slice(2, 10)}`;

const authorise = vi.fn();

vi.mock("@/lib/generation/authz", () => ({
  requireQueues: async () => authorise(),
}));

import { DELETE, POST } from "./route";

const allowed = (lang = "enUS", queues = ["text", "audio"]) => ({ session: { user: { id: USER } }, lang, queues, denied: null });

function post(ids: unknown): Request {
  return new Request("https://example.com/api/reports/skip", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ids }),
  });
}

async function file(source: "quests" | "places", lang: string, status = "open"): Promise<number> {
  await createReport({
    source,
    lang: lang as "enUS",
    lineId: `skip-${Math.random()}`,
    target: null,
    category: "other",
    body: "x",
    userId: null,
    name: null,
    email: null,
    ip: IP,
  });
  const { rows } = await asSystem.query<{ id: string }>(
    `update "report" set "status" = $2
      where "id" = (select max("id") from "report" where "ip" = $1) returning "id"::text`,
    [IP, status],
  );
  return Number(rows[0].id);
}

beforeAll(async () => {
  await asSystem.query(
    `insert into "user" ("id", "name", "email", "emailVerified") values ($1, 'Test Skip', $2, false)`,
    [USER, `${USER}@example.invalid`],
  );
});

afterAll(async () => {
  await asSystem.query(`delete from "report" where "ip" = $1`, [IP]);
  await asSystem.query(`delete from "user" where "id" = $1`, [USER]);
  await closeDb();
});

describe("/api/reports/skip", () => {
  it("returns the 403 a denied session carries", async () => {
    const denied = { session: null, lang: null, denied: Response.json({}, { status: 403 }) };
    authorise.mockResolvedValueOnce(denied);
    expect((await POST(post([1]))).status).toBe(403);
    authorise.mockResolvedValueOnce(denied);
    expect((await DELETE(new Request("https://example.com/api/reports/skip?source=quests"))).status).toBe(403);
  });

  it("skips open reports in the caller's language and nothing else", async () => {
    const open = await file("quests", "enUS");
    const foreign = await file("quests", "deDE");
    const answered = await file("quests", "enUS", "fixed");

    authorise.mockResolvedValueOnce(allowed());
    const response = await POST(post([open, foreign, answered]));
    expect(await response.json()).toEqual({ skipped: 1 });

    expect([...(await skippedIds(USER, "enUS"))]).toEqual([open]);
    expect((await skippedIds(USER, "deDE")).size).toBe(0);
  });

  it("resets one section and leaves the others", async () => {
    const quest = await file("quests", "enUS");
    const zone = await file("places", "enUS");
    authorise.mockResolvedValueOnce(allowed());
    await POST(post([quest, zone]));

    authorise.mockResolvedValueOnce(allowed());
    const response = await DELETE(new Request("https://example.com/api/reports/skip?source=quests"));
    expect(((await response.json()) as { reset: number }).reset).toBeGreaterThanOrEqual(1);

    expect([...(await skippedIds(USER, "enUS"))]).toEqual([zone]);
  });

  it("rejects an empty list and an unknown source", async () => {
    authorise.mockResolvedValueOnce(allowed());
    expect((await POST(post([]))).status).toBe(400);
    authorise.mockResolvedValueOnce(allowed());
    expect((await DELETE(new Request("https://example.com/api/reports/skip?source=raids"))).status).toBe(400);
  });
});
