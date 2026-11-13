/**
 * Session mocked, writes real.
 *
 * Needs DATABASE_URL and migrations applied.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb } from "@/lib/db";
import { createInvite } from "@/lib/invites/store";
import { asSystem, testUser } from "@/lib/teams/testing";

const session = vi.hoisted(() => ({ current: null as null | { user: { id: string; email: string; role: null } } }));

vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("@/lib/auth", () => ({ auth: { api: { getSession: async () => session.current } } }));

import { POST } from "./route";

let inviter: Awaited<ReturnType<typeof testUser>>;
let invitee: Awaited<ReturnType<typeof testUser>>;
let other: Awaited<ReturnType<typeof testUser>>;
let token = "";

const post = (cookie: string | null = `spoken_invite=${token}`) =>
  POST(
    new Request("https://example.com/api/invites/accept", {
      method: "POST",
      headers: cookie ? { cookie } : {},
    }),
  );
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
  ({ token } = await createInvite({
    email: `${invitee.id}@example.invalid`,
    lang: "deDE",
    capabilities: ["edit"],
    invitedBy: inviter.id,
    limited: false,
  }));
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
