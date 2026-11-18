/** Needs DATABASE_URL and migrations applied; only the session and the cookie jar are mocked. */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { closeDb } from "@/lib/db";
import type { Lang } from "@/lib/lang";
import { ACTING_COOKIE, parseChoice } from "@/lib/teams/acting-cookie";
import { forgetTeams, type TeamId } from "@/lib/teams/store";
import { addMember, asSystem, dropLang, dropTeam, newTeamIn, systemRows, testUser, uniqueLang } from "@/lib/teams/testing";

const mocks = vi.hoisted(() => ({
  cookie: undefined as string | undefined,
  session: null as { user: { id: string; role: string | null } } | null,
}));

vi.mock("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({
    get: (name: string) => (name === "spoken_team" && mocks.cookie !== undefined ? { name, value: mocks.cookie } : undefined),
  }),
}));
vi.mock("@/lib/session", () => ({ currentSession: async () => mocks.session }));

import { POST } from "./route";

let lang: Lang;
let other: Lang;
let a: TeamId;
let b: TeamId;
let c: TeamId;
let slugs: Record<"a" | "b" | "c", string>;
let owner: Awaited<ReturnType<typeof testUser>>;
let member: Awaited<ReturnType<typeof testUser>>;

beforeAll(async () => {
  lang = await uniqueLang();
  other = await uniqueLang();
  a = await newTeamIn(lang, true, "test-acting-a");
  b = await newTeamIn(lang, false, "test-acting-b");
  c = await newTeamIn(other, true, "test-acting-c");
  owner = await testUser("test-acting-owner");
  member = await testUser("test-acting-member");
  await asSystem.query(`update "user" set "role" = 'admin' where "id" = $1`, [owner.id]);
  await addMember(a, member.id, lang, "regenerate");
  const slug = async (team: TeamId) =>
    (await systemRows<{ slug: string }>(`select "slug" from "team" where "id" = $1`, [team]))[0].slug;
  slugs = { a: await slug(a), b: await slug(b), c: await slug(c) };
});

beforeEach(() => {
  forgetTeams();
  mocks.cookie = undefined;
  mocks.session = { user: { id: owner.id, role: "admin" } };
});

afterAll(async () => {
  for (const team of [a, b, c]) await dropTeam(team);
  await owner.cleanup();
  await member.cleanup();
  await dropLang(lang);
  await dropLang(other);
  await closeDb();
});

const post = (body: unknown) =>
  POST(new Request("http://x/api/teams/acting", { method: "POST", body: JSON.stringify(body) }));

/** The choice the response's Set-Cookie keeps; null when it sets none. */
function kept(response: Response): Record<string, string> | null {
  const header = response.headers.get("set-cookie");
  if (header === null) return null;
  return parseChoice(new RegExp(`^${ACTING_COOKIE}=([^;]*)`).exec(header)![1]);
}

describe("POST /api/teams/acting", () => {
  it("keeps a site owner's choice in the cookie", async () => {
    mocks.cookie = encodeURIComponent(JSON.stringify({ deDE: "someone" }));
    const response = await post({ lang, team: slugs.b });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ team: slugs.b, home: slugs.b });
    expect(kept(response)).toEqual({ deDE: "someone", [lang]: slugs.b });
    const header = response.headers.get("set-cookie")!;
    expect(header).toMatch(/HttpOnly/);
    expect(header).toMatch(/SameSite=Lax/);
    expect(header).toMatch(/Path=\//);
    expect(header).toMatch(/Max-Age=31536000/);
  });

  it("403s anyone but a site owner, setting nothing", async () => {
    mocks.session = { user: { id: member.id, role: "member" } };
    const response = await post({ lang, team: slugs.b });
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "not allowed" });
    expect(response.headers.get("set-cookie")).toBeNull();
    mocks.session = null;
    expect((await post({ lang, team: slugs.b })).status).toBe(403);
  });

  it("clears the language's entry for null or the privileged team", async () => {
    mocks.cookie = encodeURIComponent(JSON.stringify({ [lang]: slugs.b, deDE: "someone" }));
    const cleared = await post({ lang, team: null });
    expect(await cleared.json()).toEqual({ team: null, home: slugs.a });
    expect(kept(cleared)).toEqual({ deDE: "someone" });

    const privileged = await post({ lang, team: slugs.a });
    expect(await privileged.json()).toEqual({ team: null, home: slugs.a });
    expect(kept(privileged)).toEqual({ deDE: "someone" });
  });

  it("expires the cookie when the last entry goes", async () => {
    mocks.cookie = encodeURIComponent(JSON.stringify({ [lang]: slugs.b }));
    const response = await post({ lang, team: null });
    expect(response.headers.get("set-cookie")).toMatch(/Max-Age=0/);
  });

  it("answers the site owner's own team as home when the entry clears", async () => {
    await addMember(b, owner.id, lang, "regenerate");
    try {
      const response = await post({ lang, team: slugs.a });
      expect(await response.json()).toEqual({ team: null, home: slugs.b });
    } finally {
      await asSystem.query(`delete from "team_member" where "userId" = $1`, [owner.id]);
    }
  });

  it("404s a team of another language", async () => {
    const response = await post({ lang, team: slugs.c });
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: `no team ${slugs.c} voices ${lang}` });
    expect(response.headers.get("set-cookie")).toBeNull();
  });

  it("400s a body not in the shape", async () => {
    expect((await post({ lang })).status).toBe(400);
    expect((await post({ team: slugs.b })).status).toBe(400);
  });
});
