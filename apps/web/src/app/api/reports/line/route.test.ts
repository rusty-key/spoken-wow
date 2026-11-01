/**
 * Gated for the same reason /resolve is: the bodies are prose strangers wrote, and the
 * public path beside this one is a careless edit away from lending it its access rule.
 *
 * Needs DATABASE_URL and migrations applied.
 */
import { afterAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/lib/db";
import { asSystem } from "@/lib/teams/testing";
import { createReport } from "@/lib/reports/store";

const authorise = vi.fn();

vi.mock("@/lib/generation/authz", () => ({
  requireQueues: async () => authorise(),
}));

import { GET } from "./route";

function get(query: string): Request {
  return new Request(`https://example.com/api/reports/line?${query}`);
}

const ALLOWED = { session: { user: { id: "u1" } }, lang: "enUS", queues: ["text", "audio"], denied: null };

/** A bucket no other run shares, so the rows this file files can be swept after it. */
const IP = `test-line-${Math.random().toString(36).slice(2, 10)}`;

afterAll(async () => {
  await asSystem.query(`delete from "report" where "ip" = $1`, [IP]);
  await closeDb();
});

describe("GET /api/reports/line", () => {
  it("returns the 403 a denied session carries", async () => {
    authorise.mockResolvedValueOnce({
      session: null,
      denied: Response.json({ error: "not allowed" }, { status: 403 }),
    });

    expect((await GET(get("source=quests&lineId=q:1:accept"))).status).toBe(403);
  });

  it("rejects a source outside the closed set", async () => {
    authorise.mockResolvedValueOnce(ALLOWED);

    expect((await GET(get("source=raids&lineId=q:1:accept"))).status).toBe(400);
  });

  it("rejects a missing lineId", async () => {
    authorise.mockResolvedValueOnce(ALLOWED);

    expect((await GET(get("source=quests"))).status).toBe(400);
  });

  it("returns the line's reports and no other section's", async () => {
    const lineId = `line-route-${Date.now()}`;
    for (const source of ["quests", "places"] as const) {
      await createReport({
        source,
        lineId,
        target: null,
        category: "pronunciation",
        body: `from ${source}`,
        userId: null,
        name: null,
        email: null,
        ip: IP,
      });
    }
    authorise.mockResolvedValueOnce(ALLOWED);

    const response = await GET(get(`source=places&lineId=${encodeURIComponent(lineId)}`));
    const { reports } = (await response.json()) as { reports: { body: string }[] };

    expect(reports.map((report) => report.body)).toEqual(["from places"]);
  });
});
