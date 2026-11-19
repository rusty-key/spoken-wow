/**
 * Session mocked, writes real.
 *
 * Needs DATABASE_URL and migrations applied.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb } from "@/lib/db";
import { createInvite } from "@/lib/invites/store";
import { asSystem, plainTeam, testUser } from "@/lib/teams/testing";

const session = vi.hoisted(() => ({ current: null as null | { user: { id: string; email: string; role: null } } }));

const jar = vi.hoisted(() => ({ cookie: null as string | null }));

vi.mock("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({
    get: (name: string) => {
      const pair = jar.cookie?.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${name}=`));
      return pair === undefined ? undefined : { name, value: pair.slice(name.length + 1) };
    },
  }),
}));
vi.mock("@/lib/auth", () => ({ auth: { api: { getSession: async () => session.current } } }));

import { POST } from "./route";

let inviter: Awaited<ReturnType<typeof testUser>>;
let invitee: Awaited<ReturnType<typeof testUser>>;
let other: Awaited<ReturnType<typeof testUser>>;
let token = "";
let inviteId = "";

const post = (cookie: string | null = `spoken_invite=${token}`, id: unknown = inviteId) => {
  jar.cookie = cookie;
  return POST(
    new Request("https://example.com/api/invites/accept", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id }),
    }),
  );
};
const as = (user: { id: string }) => ({ user: { id: user.id, email: `${user.id}@example.invalid`, role: null } });

beforeAll(async () => {
  inviter = await testUser("test-accept-route-by");
  invitee = await testUser("test-accept-route");
  other = await testUser("test-accept-route-other");
  await asSystem.query(
    `insert into "team_member" ("teamId", "userId", "lang", "capability")
     select "teamId", $1, 'deDE', 'admin' from "team_language" where "lang" = 'deDE'`,
    [inviter.id],
  );
  let invite;
  ({ token, invite } = await createInvite({
    email: `${invitee.id}@example.invalid`,
    lang: "deDE",
    capabilities: ["edit"],
    invitedBy: inviter.id,
    limited: false,
    team: await plainTeam("deDE"),
  }));
  inviteId = invite.id;
});

afterAll(async () => {
  for (const user of [inviter, invitee, other]) {
    await asSystem.query(`delete from "activity" where "actorId" = $1 or "subject" = $1`, [user.id]);
    await asSystem.query(`delete from "team_member" where "userId" = $1`, [user.id]);
  }
  await inviter.cleanup();
  await invitee.cleanup();
  await other.cleanup();
  await closeDb();
});

describe("POST /api/invites/accept", () => {
  it("needs a session", async () => {
    session.current = null;
    expect((await post()).status).toBe(401);
  });

  it("answers 400 to a null body", async () => {
    session.current = as(invitee);
    jar.cookie = `spoken_invite=${token}`;
    const response = await POST(
      new Request("https://example.com/api/invites/accept", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "null",
      }),
    );
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "expected { id }" });
  });

  it("refuses when the link's invite is not the one the page showed, and grants nothing", async () => {
    session.current = as(invitee);
    const changed = await post(undefined, "00000000-0000-0000-0000-000000000000");
    expect(changed.status).toBe(409);
    expect((await changed.json()).reason).toBe("changed");
    const { rowCount } = await asSystem.query(`select 1 from "team_member" where "userId" = $1`, [invitee.id]);
    expect(rowCount).toBe(0);
    expect((await post(undefined, null)).status).toBe(400);
  });

  it("refuses another account, accepts the right one, and says so on a second press", async () => {
    session.current = as(other);
    const wrong = await post();
    expect(wrong.status).toBe(403);
    expect((await wrong.json()).reason).toBe("wrong-email");

    session.current = as(invitee);
    const ok = await post();
    expect(ok.status).toBe(200);
    expect(await ok.json()).toMatchObject({ lang: "deDE" });

    const again = await post();
    expect(again.status).toBe(409);
    expect((await again.json()).reason).toBe("accepted");
  });

  it("answers 404 to a token nobody has, and to no cookie", async () => {
    expect((await post("spoken_invite=nope")).status).toBe(404);
    expect((await post(null)).status).toBe(404);
  });
});
