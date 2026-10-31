/**
 * Against a real Postgres, for the reason queue.test.ts gives: the rate limit is a time
 * window and the value sets are check constraints, and a mock would assert neither.
 *
 * Needs DATABASE_URL and migrations applied:
 *   docker compose up -d postgres && deploy/bin/migrate.sh "$PWD/web"
 */
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";

import { closeDb, db } from "@/lib/db";
import { asSystem, ownTeam } from "@/lib/teams/testing";

import { countRecent, createReport, listReports, reportsForLine, setStatus } from "./store";

/** resolvedBy has a foreign key, so resolving needs a user that exists. */
const RESOLVER = "test-report-resolver";

/** A bucket no other run shares, so tests can count rows for one IP safely. */
let ip: string;

function submission(overrides: Partial<Parameters<typeof createReport>[0]> = {}) {
  return {
    source: "quests" as const,
    lineId: `q:1:accept`,
    target: "quest/1/accept",
    category: "pronunciation" as const,
    body: "Said Thrall wrong.",
    userId: null,
    name: null,
    email: null,
    ip,
    ...overrides,
  };
}

beforeEach(async () => {
  ip = `test-${Math.random().toString(36).slice(2, 10)}`;
  await asSystem.query(
    `insert into "user" ("id", "name", "email", "emailVerified")
     values ($1, 'Test Resolver', $2, false)
     on conflict ("id") do nothing`,
    [RESOLVER, `${RESOLVER}@example.invalid`],
  );
});

afterEach(async () => {
  await asSystem.query(`delete from "report" where "ip" like $1`, [`${ip}%`]);
});

afterAll(async () => {
  await asSystem.query(`delete from "activity" where "actorId" = $1`, [RESOLVER]);
  await asSystem.query(`delete from "user" where "id" = $1`, [RESOLVER]);
  await closeDb();
});

describe("createReport and countRecent", () => {
  it("counts only this IP inside the window", async () => {
    await createReport(submission());
    await createReport(submission({ ip: `${ip}-other` }));

    expect(await countRecent(ip, 60 * 60 * 1000)).toBe(1);
  });

  it("ignores rows older than the window", async () => {
    await createReport(submission());
    await asSystem.query(
      `update "report" set "createdAt" = now() - interval '2 hours' where "ip" = $1`,
      [ip],
    );

    expect(await countRecent(ip, 60 * 60 * 1000)).toBe(0);
  });

  it("stores a report that resolved to no line", async () => {
    await createReport(submission({ lineId: null, target: "quest/999999/accept" }));

    const stored = (await listReports("open")).find(
      (report) => report.target === "quest/999999/accept",
    );
    expect(stored?.lineId).toBeNull();
  });

  it("hands back timestamps as strings, not Dates", async () => {
    await createReport(submission());
    const [report] = await reportsForLine("quests", "q:1:accept");

    expect(typeof report.createdAt).toBe("string");
  });
});

describe("setStatus", () => {
  it("records who resolved it and when", async () => {
    await createReport(submission());
    const [report] = await reportsForLine("quests", "q:1:accept");

    const updated = await setStatus(report.id, "fixed", RESOLVER, "enUS");

    expect(updated?.status).toBe("fixed");
    expect(updated?.resolvedAt).not.toBeNull();
    expect(updated?.resolvedBy).toBe(RESOLVER);
  });

  it("clears the resolution when reopened", async () => {
    await createReport(submission());
    const [report] = await reportsForLine("quests", "q:1:accept");

    await setStatus(report.id, "fixed", RESOLVER, "enUS");
    const reopened = await setStatus(report.id, "open", RESOLVER, "enUS");

    expect(reopened?.resolvedAt).toBeNull();
    expect(reopened?.resolvedBy).toBeNull();
  });

  it("sets a report aside as minor, out of the open list", async () => {
    await createReport(submission({ body: "Minor quibble." }));
    const [report] = (await reportsForLine("quests", "q:1:accept")).filter((each) => each.body === "Minor quibble.");

    expect((await setStatus(report.id, "minor", RESOLVER, "enUS"))?.status).toBe("minor");
    const ids = async (status: "open" | "minor") => (await listReports(status)).map((each) => each.id);
    expect(await ids("open")).not.toContain(report.id);
    expect(await ids("minor")).toContain(report.id);
  });

  it("returns null for an id that does not exist", async () => {
    expect(await setStatus(2147483000, "fixed", RESOLVER, "enUS")).toBeNull();
  });
});

/**
 * The reason the source is part of every read rather than a label on the row: both sides of
 * the site name lines and files by their own frozen rules, and nothing guarantees the two
 * namespaces stay apart. A read that forgot the source would hand a places report to the
 * quests triage view, where the line it names resolves to something else or to nothing.
 */
describe("the two sources", () => {
  it("keeps a line's reports to the source that filed them", async () => {
    await createReport(submission({ lineId: "shared:1" }));
    await createReport(submission({ source: "places", lineId: "shared:1", target: null }));

    expect(await reportsForLine("quests", "shared:1")).toHaveLength(1);
    expect(await reportsForLine("places", "shared:1")).toHaveLength(1);
  });

  it("lists both by default and one when asked", async () => {
    await createReport(submission());
    await createReport(submission({ source: "places", target: null }));

    const mine = (reports: Awaited<ReturnType<typeof listReports>>) =>
      reports.filter((report) => report.body === "Said Thrall wrong.");

    expect(mine(await listReports("open"))).toHaveLength(2);
    expect(mine(await listReports("open", "places"))).toHaveLength(1);
    expect(mine(await listReports("open", "places"))[0]?.source).toBe("places");
  });

  it("narrows to one complaint, across sources", async () => {
    // The body carries this run's marker, because a Report never carries the ip it was
    // filed from and the table holds rows from every other run besides.
    await createReport(submission({ body: `${ip} said it wrong` }));
    await createReport(submission({ category: "wrong_voice", body: `${ip} wrong voice` }));
    await createReport(
      submission({ source: "places", target: null, category: "wrong_voice", body: `${ip} zone` }),
    );

    const mine = (reports: Awaited<ReturnType<typeof listReports>>) =>
      reports.filter((report) => report.body.startsWith(ip));

    const voice = await listReports("open", "all", "wrong_voice");
    expect(voice.every((report) => report.category === "wrong_voice")).toBe(true);
    // Two of the three are wrong_voice and they come from different sources: the complaint
    // filter narrows across the corpora rather than within one.
    expect(mine(voice)).toHaveLength(2);
    expect(mine(await listReports("open", "all", "pronunciation"))).toHaveLength(1);
  });

  /** The places side reaches its report page with the line already known, so it has none. */
  it("stores a report with no target at all", async () => {
    await createReport(submission({ source: "places", lineId: "z:1411", target: null }));

    const [report] = await reportsForLine("places", "z:1411");
    expect(report.target).toBeNull();
  });
});

describe("a report's team", () => {
  it("is its language's, for an anonymous report from the addon", async () => {
    const french = await ownTeam("frFR");
    try {
      await createReport(submission({ lang: "frFR", userId: null }));
      const { rows } = await asSystem.query(`select "teamId" from "report" where "ip" = $1`, [ip]);
      expect(rows).toEqual([{ teamId: french.team }]);

      const [report] = await reportsForLine("quests", "q:1:accept", "frFR");
      expect((await setStatus(report.id, "fixed", RESOLVER, "frFR"))?.status).toBe("fixed");
    } finally {
      await french.restore();
    }
  });
});
