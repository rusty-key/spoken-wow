/** Needs DATABASE_URL and migrations through 0091 applied; only the session is mocked. */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { closeDb } from "@/lib/db";
import { forgetLanguages, loadLanguages } from "@/lib/languages/catalogue";
import { forgetTeams, teamOf } from "@/lib/teams/store";
import { asSystem, dropTeam, runningJob, systemRows, testUser } from "@/lib/teams/testing";

const who = vi.hoisted(() => ({ role: "admin" as string | null, signedOut: false, id: "" }));

vi.mock("@/lib/session", () => ({
  currentSession: async () => who.signedOut ? null : ({ user: { id: who.id, role: who.role } }),
}));

import { PATCH } from "./[id]/route";
import { PUT } from "./[id]/languages/route";
import { GET, POST } from "./route";

const tag = Math.random().toString(36).slice(2, 8);
let was: string;
let made: string[];
let user: Awaited<ReturnType<typeof testUser>>;

const json = (method: string, body: unknown) =>
  new Request("http://x/api/teams", { method, body: JSON.stringify(body) });
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const list = () => GET(new Request("http://x/api/teams"));

beforeAll(async () => {
  user = await testUser("test-teams-route");
  who.id = user.id;
});

beforeEach(async () => {
  who.role = "admin";
  who.signedOut = false;
  made = [];
  forgetTeams();
  was = await teamOf("deDE");
});

afterEach(async () => {
  const now = (await systemRows<{ team: string }>(`select team_of_lang('deDE') as "team"`))[0].team;
  if (now !== was) await asSystem.query(`select move_team_lang('deDE', $1)`, [was]);
  await asSystem.query(`delete from "activity" where "actorId" = $1`, [who.id]);
  for (const team of made) await dropTeam(team);
  forgetTeams();
});

afterAll(async () => {
  await user.cleanup();
  await closeDb();
});

async function post(body: unknown): Promise<Response> {
  const response = await POST(json("POST", body));
  if (response.ok) made.push(((await response.clone().json()) as { team: { id: string } }).team.id);
  return response;
}

const letters = () => String.fromCharCode(65 + Math.floor(Math.random() * 26));
const freshCode = () => `xq${letters()}${letters()}`;

async function dropLanguages(codes: string[]) {
  const held = await systemRows<{ teamId: string }>(`select "teamId" from "team_language" where "lang" = any($1::text[])`, [codes]);
  await asSystem.query(`delete from "activity" where "lang" = any($1::text[])`, [codes]);
  await asSystem.query(`delete from "language_grant" where "lang" = any($1::text[])`, [codes]);
  await asSystem.query(`delete from "language" where "code" = any($1::text[])`, [codes]);
  for (const { teamId } of held) await dropTeam(teamId);
  forgetLanguages();
  await loadLanguages();
  forgetTeams();
}

describe("new language", () => {
  const codes: string[] = [];
  const code = () => {
    const fresh = freshCode();
    codes.push(fresh);
    return fresh;
  };
  const body = (extra: Record<string, unknown>, lang: string) => ({
    name: "Testish",
    newLanguage: { code: lang, name: "Testish", native: "Testisch" },
    ...extra,
  });
  afterEach(async () => {
    await dropLanguages(codes);
    codes.length = 0;
  });

  it("founds the language and its team, with the named admin", async () => {
    const lang = code();
    const response = await POST(json("POST", body({ slug: `test-${lang.toLowerCase()}-${tag}`, adminEmail: `${who.id}@example.invalid` }, lang)));
    expect(response.status).toBe(200);
    const { team } = (await response.json()) as { team: { langs: string[] } };
    expect(team.langs).toEqual([lang]);
    const [row] = await systemRows<{ enabled: boolean; textByTeam: boolean }>(
      `select "enabled", "textByTeam" from "language" where "code" = $1`,
      [lang],
    );
    expect(row).toEqual({ enabled: true, textByTeam: true });
    const grants = await systemRows<{ capability: string }>(
      `select "capability" from "team_member" where "lang" = $1 and "userId" = $2 order by 1`,
      [lang, who.id],
    );
    expect(grants.map((g) => g.capability)).toEqual(["admin"]);
    expect(await systemRows(`select 1 from "language_grant" where "lang" = $1 and "userId" = $2 and "capability" = 'edit'`, [lang, who.id])).toHaveLength(1);
    expect((await POST(json("POST", body({ slug: `again-${tag}` }, lang)))).status).toBe(409);
  });

  it("leaves nothing behind when the slug is taken", async () => {
    const taken = await post({ slug: `taken-${tag}`, name: "T", langs: [] });
    expect(taken.status).toBe(200);
    const teams = await systemRows(`select 1 from "team"`);
    const lang = code();
    expect((await POST(json("POST", body({ slug: `taken-${tag}` }, lang)))).status).toBe(409);
    expect(await systemRows(`select 1 from "language" where "code" = $1`, [lang])).toHaveLength(0);
    expect(await systemRows(`select 1 from "team"`)).toHaveLength(teams.length);
  });

  it("answers 400 with langs beside newLanguage, and 403 to a member", async () => {
    const lang = code();
    expect((await POST(json("POST", body({ slug: `both-${tag}`, langs: ["deDE"] }, lang)))).status).toBe(400);
    expect(await systemRows(`select 1 from "language" where "code" = $1`, [lang])).toHaveLength(0);
    who.role = "member";
    expect((await POST(json("POST", body({ slug: `mem-${tag}` }, lang)))).status).toBe(403);
  });
});

describe("teams routes", () => {
  it("answers 403 to a member on all four", async () => {
    who.role = "member";
    expect((await list()).status).toBe(403);
    expect((await POST(json("POST", { slug: `m-${tag}`, name: "M", langs: [] }))).status).toBe(403);
    expect((await PATCH(json("PATCH", { name: "x" }), ctx("1"))).status).toBe(403);
    expect((await PUT(json("PUT", { lang: "deDE" }), ctx("1"))).status).toBe(403);
    expect(await systemRows(`select 1 from "team" where "slug" = $1`, [`m-${tag}`])).toHaveLength(0);
  });

  it("answers 403 to a signed-out caller", async () => {
    who.signedOut = true;
    expect((await list()).status).toBe(403);
    expect((await POST(json("POST", { slug: `o-${tag}`, name: "O", langs: [] }))).status).toBe(403);
  });

  it("keeps what moved and grants admin there when a later language is refused", async () => {
    const job = await runningJob("frFR", await teamOf("frFR"));
    try {
      const response = await POST(json("POST", { slug: `part-${tag}`, name: "P", langs: ["deDE", "frFR"], adminEmail: `${who.id}@example.invalid` }));
      const team = (await systemRows<{ id: string }>(`select "id" from "team" where "slug" = $1`, [`part-${tag}`]))[0].id;
      made.push(team);
      expect(response.status).toBe(409);
      expect(((await response.json()) as { error: string }).error).toMatch(/^moved deDE; frFR refused/);
      forgetTeams();
      expect(await teamOf("deDE")).toBe(team);
      const grants = await systemRows<{ capability: string }>(
        `select "capability" from "team_member" where "teamId" = $1 and "userId" = $2 and "lang" = 'deDE'`,
        [team, who.id],
      );
      expect(grants.map((g) => g.capability)).toEqual(["admin"]);
    } finally {
      await job.cleanup();
    }
  });

  it("creates a team holding the language it was given, with its admin", async () => {
    const response = await post({ slug: `german-${tag}`, name: "German", langs: ["deDE"], adminEmail: `${who.id}@example.invalid` });
    expect(response.status).toBe(200);
    const { team } = (await response.json()) as { team: { langs: string[]; members: { userId: string; capability: string }[] } };
    expect(team.langs).toEqual(["deDE"]);
    expect(team.members.filter((m) => m.userId === who.id).map((m) => m.capability)).toEqual(["admin"]);
  });

  it("lists the teams", async () => {
    await post({ slug: `list-${tag}`, name: "L", langs: [] });
    const { teams } = (await (await list()).json()) as { teams: { slug: string }[] };
    expect(teams.some((team) => team.slug === `list-${tag}`)).toBe(true);
  });

  it("answers 400 to a bad slug, a blank name, an unknown language or enUS, creating nothing", async () => {
    for (const body of [
      { slug: "Bad Slug", name: "x", langs: [] },
      { slug: `blank-${tag}`, name: "  ", langs: [] },
      { slug: `unk-${tag}`, name: "x", langs: ["xxXX"] },
      { slug: `en-${tag}`, name: "x", langs: ["enUS"] },
      { slug: `mal-${tag}`, name: "x", langs: "deDE" },
    ]) {
      expect((await POST(json("POST", body))).status).toBe(400);
    }
    expect((await POST(new Request("http://x", { method: "POST", body: "{" }))).status).toBe(400);
    expect(await systemRows(`select 1 from "team" where "slug" like $1`, [`%-${tag}`])).toHaveLength(0);
  });

  it("hands over a language named twice once", async () => {
    const response = await post({ slug: `twice-${tag}`, name: "T", langs: ["deDE", "deDE"] });
    expect(response.status).toBe(200);
    expect(((await response.json()) as { team: { langs: string[] } }).team.langs).toEqual(["deDE"]);
  });

  it("answers 400 to an admin email with no language to admin, creating nothing", async () => {
    const response = await POST(json("POST", { slug: `lone-${tag}`, name: "x", langs: [], adminEmail: `${who.id}@example.invalid` }));
    expect(response.status).toBe(400);
    expect(await systemRows(`select 1 from "team" where "slug" = $1`, [`lone-${tag}`])).toHaveLength(0);
  });

  it("answers 400 to an admin email nobody has", async () => {
    const response = await POST(json("POST", { slug: `ghost-${tag}`, name: "x", langs: [], adminEmail: "nobody@example.invalid" }));
    expect(response.status).toBe(400);
  });

  it("renames a team, and refuses a blank name", async () => {
    const id = ((await (await post({ slug: `ren-${tag}`, name: "Old", langs: [] })).json()) as { team: { id: string } }).team.id;
    expect((await PATCH(json("PATCH", { name: "New" }), ctx(id))).status).toBe(200);
    expect((await systemRows<{ name: string }>(`select "name" from "team" where "id" = $1`, [id]))[0].name).toBe("New");
    expect((await PATCH(json("PATCH", { name: " " }), ctx(id))).status).toBe(400);
  });

  it("hands a language over", async () => {
    const id = ((await (await post({ slug: `hand-${tag}`, name: "H", langs: [] })).json()) as { team: { id: string } }).team.id;
    const response = await PUT(json("PUT", { lang: "deDE" }), ctx(id));
    expect(response.status).toBe(200);
    forgetTeams();
    expect(await teamOf("deDE")).toBe(id);
  });

  it("answers 409 while a job of the language runs", async () => {
    const id = ((await (await post({ slug: `busy-${tag}`, name: "B", langs: [] })).json()) as { team: { id: string } }).team.id;
    const job = await runningJob("deDE", was);
    try {
      expect((await PUT(json("PUT", { lang: "deDE" }), ctx(id))).status).toBe(409);
    } finally {
      await job.cleanup();
    }
  });

  it("answers 400 to a language it does not know", async () => {
    const id = ((await (await post({ slug: `bad-${tag}`, name: "B", langs: [] })).json()) as { team: { id: string } }).team.id;
    expect((await PUT(json("PUT", { lang: "xxXX" }), ctx(id))).status).toBe(400);
  });
});
