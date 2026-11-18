/**
 * Whose mark the X moves. Needs DATABASE_URL and migrations applied; only the session and the
 * cookie jar are mocked. The marks written are job id 1, below any real job, so no panel loses
 * anything while this runs.
 */
import { NextRequest } from "next/server";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  cookie: undefined as string | undefined,
  session: null as { user: { id: string; name: string; role: string | null } } | null,
}));

vi.mock("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({
    get: (name: string) => (name === "spoken_team" && mocks.cookie !== undefined ? { name, value: mocks.cookie } : undefined),
  }),
}));
vi.mock("@/lib/session", () => ({ currentSession: async () => mocks.session }));

import { closeDb } from "@/lib/db";
import type { Lang } from "@/lib/lang";
import { forgetTeams, type TeamId } from "@/lib/teams/store";
import { addMember, asSystem, dropLang, dropTeam, newTeamIn, systemRows, testUser, uniqueLang } from "@/lib/teams/testing";

import { POST } from "./route";

let lang: Lang;
let otherLang: Lang;
let a: TeamId;
let b: TeamId;
let c: TeamId;
let d: TeamId;
let owner: Awaited<ReturnType<typeof testUser>>;
let member: Awaited<ReturnType<typeof testUser>>;

const dismiss = () =>
  POST(
    new NextRequest("https://example.com/api/regenerate/queue/dismiss", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ through: "1" }),
    }),
  );

/** Each fixture team's mark, absent when it has none. */
async function marks(): Promise<Record<string, string>> {
  const rows = await systemRows<{ teamId: TeamId; through: string }>(
    `select "teamId", "throughJobId"::text as through from "queue_dismissal" where "teamId" = any($1::uuid[])`,
    [[a, b, c, d]],
  );
  const names = new Map([[a, "a"], [b, "b"], [c, "c"], [d, "d"]]);
  return Object.fromEntries(rows.map((row) => [names.get(row.teamId)!, row.through]));
}

beforeEach(async () => {
  forgetTeams();
  lang = await uniqueLang();
  a = await newTeamIn(lang, true, "test-dismiss-a");
  b = await newTeamIn(lang, false, "test-dismiss-b");
  otherLang = await uniqueLang();
  c = await newTeamIn(otherLang, true, "test-dismiss-c");
  d = await newTeamIn(otherLang, false, "test-dismiss-d");
  owner = await testUser("test-dismiss-owner");
  member = await testUser("test-dismiss-member");
  await asSystem.query(`update "user" set "role" = 'admin' where "id" = $1`, [owner.id]);
  await addMember(a, member.id, lang, "regenerate");
  await asSystem.query(`insert into "queue_dismissal" ("teamId", "throughJobId") values ($1, 0)`, [b]);
  const [{ slug }] = await systemRows<{ slug: string }>(`select "slug" from "team" where "id" = $1`, [b]);
  mocks.cookie = encodeURIComponent(JSON.stringify({ [lang]: slug }));
});

afterEach(async () => {
  mocks.session = null;
  for (const team of [b, a, d, c]) await dropTeam(team);
  await dropLang(lang);
  await dropLang(otherLang);
  await owner.cleanup();
  await member.cleanup();
  forgetTeams();
});

afterAll(closeDb);

describe("POST /api/regenerate/queue/dismiss", () => {
  it("moves the mark of the team a site owner acts as in each language", async () => {
    mocks.session = { user: { id: owner.id, name: "Owner", role: "admin" } };
    expect((await dismiss()).status).toBe(200);
    expect(await marks()).toEqual({ b: "1", c: "1" });
  });

  it("moves only a member's own team's mark, whatever the cookie names", async () => {
    mocks.session = { user: { id: member.id, name: "Member", role: null } };
    expect((await dismiss()).status).toBe(200);
    expect(await marks()).toEqual({ a: "1", b: "0" });
  });

  it("moves the mark of every team a member works in, a second team's included", async () => {
    await addMember(d, member.id, otherLang, "regenerate");
    forgetTeams();
    mocks.session = { user: { id: member.id, name: "Member", role: null } };
    expect((await dismiss()).status).toBe(200);
    expect(await marks()).toEqual({ a: "1", b: "0", d: "1" });
  });
});
