/**
 * A site owner acting inside a team through the `spoken_team` cookie. The session and the
 * cookie jar are mocked; the teams, members and rows are real.
 *
 * Needs DATABASE_URL and migrations applied.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { closeDb } from "@/lib/db";
import type { Lang } from "@/lib/lang";
import { withToken } from "@/lib/text-api/guard";
import { mintToken } from "@/lib/text-api/testing";

import { actingTeams } from "./acting";
import { ACTING_COOKIE, chosenTeams } from "./acting-cookie";
import { forgetTeams, ownerOrAll, queryAs, secondTeamLangs, type TeamId } from "./store";
import { addMember, asSystem, dropLang, dropTeam, newTeamIn, systemRows, testUser, uniqueLang } from "./testing";

const mocks = vi.hoisted(() => ({
  cookie: undefined as string | undefined,
  session: null as { user: { id: string; role: string | null } } | null,
  cookies: vi.fn(),
}));

vi.mock("next/headers", () => ({ headers: async () => new Headers(), cookies: mocks.cookies }));
vi.mock("@/lib/session", () => ({ currentSession: async () => mocks.session }));
vi.mock("./store", async (importOriginal) => {
  const real = await importOriginal<typeof import("./store")>();
  return { ...real, secondTeamLangs: vi.fn(real.secondTeamLangs) };
});

let lang: Lang;
let single: Lang;
let a: TeamId;
let b: TeamId;
let c: TeamId;
let owner: Awaited<ReturnType<typeof testUser>>;
let member: Awaited<ReturnType<typeof testUser>>;

const choose = (choice: unknown) => {
  mocks.cookie = encodeURIComponent(JSON.stringify(choice));
};

beforeAll(async () => {
  lang = await uniqueLang();
  single = await uniqueLang();
  a = await newTeamIn(lang, true, "test-cookie-a");
  b = await newTeamIn(lang, false, "test-cookie-b");
  c = await newTeamIn(single, true, "test-cookie-c");
  owner = await testUser("test-cookie-owner");
  member = await testUser("test-cookie-member");
  await asSystem.query(`update "user" set "role" = 'admin' where "id" = $1`, [owner.id]);
  await addMember(a, member.id, lang, "regenerate");
});

beforeEach(() => {
  forgetTeams();
  mocks.cookie = undefined;
  mocks.session = null;
  mocks.cookies.mockReset();
  mocks.cookies.mockImplementation(async () => ({
    get: (name: string) => (name === ACTING_COOKIE && mocks.cookie !== undefined ? { name, value: mocks.cookie } : undefined),
  }));
});

afterEach(async () => {
  await asSystem.query(`delete from "line_ignore" where "lang" in ($1, $2)`, [lang, single]);
});

afterAll(async () => {
  await asSystem.query(`delete from "api_token" where "userId" = any($1)`, [[owner.id, member.id]]);
  for (const team of [a, b, c]) await dropTeam(team);
  await owner.cleanup();
  await member.cleanup();
  await dropLang(lang);
  await dropLang(single);
  await closeDb();
});

const slugOf = async (team: TeamId) =>
  (await systemRows<{ slug: string }>(`select "slug" from "team" where "id" = $1`, [team]))[0].slug;

async function ignoredBy(lineId: string): Promise<TeamId | null> {
  const rows = await systemRows<{ teamId: TeamId }>(`select "teamId" from "line_ignore" where "lineId" = $1`, [lineId]);
  return rows[0]?.teamId ?? null;
}

describe("a site owner's cookie", () => {
  it("acts in the team it names, for reads and writes", async () => {
    mocks.session = { user: { id: owner.id, role: "admin" } };
    choose({ [lang]: await slugOf(b) });
    expect(await ownerOrAll(lang)).toBe(b);
    await queryAs(lang, `insert into "line_ignore" ("lineId", "lang", "reason") values ('cookie-owner', $1, 'x')`, [lang]);
    expect(await ignoredBy("cookie-owner")).toBe(b);
  });

  it("wins over the site owner's own membership", async () => {
    await addMember(a, owner.id, lang, "regenerate");
    try {
      mocks.session = { user: { id: owner.id, role: "admin" } };
      choose({ [lang]: await slugOf(b) });
      expect(await ownerOrAll(lang)).toBe(b);
    } finally {
      await asSystem.query(`delete from "team_member" where "userId" = $1`, [owner.id]);
    }
  });

  it("naming no team of the language acts as before", async () => {
    mocks.session = { user: { id: owner.id, role: "admin" } };
    choose({ [lang]: "nope" });
    expect(await ownerOrAll(lang)).toBe(a);
    choose({ [lang]: await slugOf(c) });
    expect(await ownerOrAll(lang)).toBe(a);
  });

  it("malformed is no choice", async () => {
    mocks.session = { user: { id: owner.id, role: "admin" } };
    mocks.cookie = "{not json";
    expect(await chosenTeams()).toEqual(new Map());
    choose([lang]);
    expect(await chosenTeams()).toEqual(new Map());
    expect(await ownerOrAll(lang)).toBe(a);
  });
});

describe("anyone else's cookie", () => {
  it("changes nothing for a member, read or written, and is not read", async () => {
    mocks.session = { user: { id: member.id, role: "member" } };
    choose({ [lang]: await slugOf(b) });
    expect(await ownerOrAll(lang)).toBe(a);
    await queryAs(lang, `insert into "line_ignore" ("lineId", "lang", "reason") values ('cookie-member', $1, 'x')`, [lang]);
    expect(await ignoredBy("cookie-member")).toBe(a);
    expect(mocks.cookies).not.toHaveBeenCalled();
  });

  it("changes nothing signed out", async () => {
    choose({ [lang]: await slugOf(b) });
    expect(await ownerOrAll(lang)).toBe(a);
    expect(mocks.cookies).not.toHaveBeenCalled();
  });
});

describe("cost", () => {
  it("reads no cookie with no second team anywhere", async () => {
    mocks.session = { user: { id: owner.id, role: "admin" } };
    choose({ [lang]: await slugOf(b) });
    vi.mocked(secondTeamLangs).mockResolvedValueOnce(new Set());
    expect((await actingTeams()).get(lang)).toBeUndefined();
    expect(mocks.cookies).not.toHaveBeenCalled();
  });

  it("reads no cookie for a single-team language", async () => {
    mocks.session = { user: { id: owner.id, role: "admin" } };
    choose({ [lang]: await slugOf(b) });
    expect(await ownerOrAll(single)).toBe(c);
    expect(mocks.cookies).not.toHaveBeenCalled();
  });
});

describe("a token", () => {
  const request = (token: string) =>
    new Request("https://example.com/api/v1", { headers: { authorization: `Bearer ${token}` } });

  it("acts as its owner's team, whatever the cookie names", async () => {
    // A browser that sends a site owner's session and cookie along with the token.
    mocks.session = { user: { id: owner.id, role: "admin" } };
    choose({ [lang]: await slugOf(b) });
    const token = await mintToken(owner.id, lang, "read", false);
    let acted: unknown;
    const response = await withToken(request(token), {}, async () => {
      acted = await ownerOrAll(lang);
      return Response.json({});
    });
    expect(response.status).toBe(200);
    expect(acted).toBe(a);
    expect(mocks.cookies).not.toHaveBeenCalled();
  });

  it("in a single-team language reads neither session nor cookie", async () => {
    mocks.session = { user: { id: owner.id, role: "admin" } };
    choose({ [lang]: await slugOf(b) });
    const token = await mintToken(owner.id, single, "read", false);
    let acted: unknown;
    const response = await withToken(request(token), {}, async () => {
      acted = await ownerOrAll(lang);
      return Response.json({});
    });
    expect(response.status).toBe(200);
    expect(acted).toBe(a);
    expect(mocks.cookies).not.toHaveBeenCalled();
  });
});
