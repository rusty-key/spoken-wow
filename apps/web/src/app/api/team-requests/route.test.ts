/** Needs DATABASE_URL and migrations through 0108 applied; the session and the email are mocked. */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { closeDb } from "@/lib/db";
import { forgetLanguages, loadLanguages } from "@/lib/languages/catalogue";
import { forgetTeams } from "@/lib/teams/store";
import { asSystem, dropTeam, systemRows, testUser } from "@/lib/teams/testing";

const who = vi.hoisted(() => ({ role: "user" as string | null, signedOut: false, id: "" }));

vi.mock("@/lib/session", () => ({
  currentSession: async () => (who.signedOut ? null : { user: { id: who.id, role: who.role } }),
}));
vi.mock("@/lib/email", () => ({ sendEmail: () => {} }));

import { DELETE, PATCH } from "./[id]/route";
import { GET, POST } from "./route";

let member: Awaited<ReturnType<typeof testUser>>;
let admin: Awaited<ReturnType<typeof testUser>>;
let codes: string[];

function code(): string {
  const capital = () => String.fromCharCode(65 + Math.floor(Math.random() * 26));
  const made = `xq${capital()}${capital()}`;
  codes.push(made);
  return made;
}

const names = { name: "Xq Test", native: "Xq Tést" };
const json = (method: string, body: unknown) => new Request("http://x/api/team-requests", { method, body: JSON.stringify(body) });
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const as = (user: { id: string }, role: string | null) => {
  who.id = user.id;
  who.role = role;
};
const ask = (body: unknown) => POST(json("POST", body));
const idOf = async (response: Response) => ((await response.json()) as { request: { id: string } }).request.id;

beforeAll(async () => {
  member = await testUser("test-reqroute-member");
  admin = await testUser("test-reqroute-admin");
});

beforeEach(() => {
  codes = [];
  who.signedOut = false;
  as(member, null);
  forgetTeams();
});

afterEach(async () => {
  const held = await systemRows<{ teamId: string }>(`select "teamId" from "team_language" where "lang" = any($1::text[])`, [codes]);
  const users = [member.id, admin.id];
  await asSystem.query(`delete from "activity" where "actorId" = any($1::text[]) or "lang" = any($2::text[])`, [users, codes]);
  await asSystem.query(`delete from "team_request" where "userId" = any($1::text[])`, [users]);
  await asSystem.query(`delete from "language_grant" where "lang" = any($1::text[])`, [codes]);
  await asSystem.query(`delete from "language" where "code" = any($1::text[])`, [codes]);
  for (const { teamId } of held) await dropTeam(teamId);
  forgetLanguages();
  await loadLanguages();
  forgetTeams();
});

afterAll(async () => {
  await member.cleanup();
  await admin.cleanup();
  await closeDb();
});

describe("team requests routes", () => {
  it("answers 401 to nobody", async () => {
    who.signedOut = true;
    expect((await GET(new Request("http://x/api/team-requests"))).status).toBe(401);
    expect((await ask({ lang: code(), language: names, teamName: "T" })).status).toBe(401);
  });

  it("lets a member ask for a new language and see the request", async () => {
    const lang = code();
    const response = await ask({ lang, language: names, teamName: "Xq Team" });
    expect(response.status).toBe(200);
    const id = await idOf(response);
    const listed = (await (await GET(new Request("http://x/api/team-requests"))).json()) as { requests: { id: string }[] };
    expect(listed.requests.map((r) => r.id)).toEqual([id]);
  });

  it("refuses bad requests", async () => {
    const ok = { language: names, teamName: "Xq Team" };
    expect((await ask({ lang: "enUS", ...ok })).status).toBe(400);
    expect((await ask({ lang: "deDE", ...ok })).status).toBe(400);
    expect((await ask({ lang: code(), teamName: "Xq Team" })).status).toBe(400);
    expect((await ask({ lang: code(), language: names, teamName: "x".repeat(61) })).status).toBe(400);
    expect((await ask({ lang: code(), language: names, teamName: "" })).status).toBe(400);
    expect((await ask({ lang: code(), ...ok, note: "x".repeat(1001) })).status).toBe(400);
    expect((await ask({ lang: "nonsense", ...ok })).status).toBe(400);
  });

  it("lets the requester withdraw, and keeps members out of PATCH", async () => {
    const id = await idOf(await ask({ lang: code(), language: names, teamName: "Xq Team" }));
    expect((await PATCH(json("PATCH", { decision: "approve" }), ctx(id))).status).toBe(403);
    const response = await DELETE(json("DELETE", null), ctx(id));
    expect(response.status).toBe(200);
    expect(((await response.json()) as { request: { state: string } }).request.state).toBe("withdrawn");
  });

  it("lets a site admin list the pending, approve once, and bound a reason", async () => {
    const id = await idOf(await ask({ lang: code(), language: names, teamName: "Xq Team" }));
    as(admin, "admin");
    const pending = (await (await GET(new Request("http://x/api/team-requests?state=pending"))).json()) as { requests: { id: string }[] };
    expect(pending.requests.map((r) => r.id)).toContain(id);
    expect((await PATCH(json("PATCH", { decision: "reject", reason: "x".repeat(501) }), ctx(id))).status).toBe(400);
    const approved = await PATCH(json("PATCH", { decision: "approve" }), ctx(id));
    expect(approved.status).toBe(200);
    expect(((await approved.json()) as { request: { state: string } }).request.state).toBe("approved");
    expect((await PATCH(json("PATCH", { decision: "approve" }), ctx(id))).status).toBe(409);
  });
});
