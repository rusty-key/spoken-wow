/**
 * Account events through the real better-auth admin plugin, against a real Postgres: the
 * hook only sees what the plugin hands it -- which path, whether it succeeded, whose session
 * -- so a mocked context would pin a contract nobody checked. Every call here goes through
 * `auth.api`, which runs the same hooks the HTTP route does.
 *
 * Every user is made for the run and removed after it.
 *
 * Needs DATABASE_URL and the migrations applied.
 */
import { randomUUID } from "node:crypto";

import { afterAll, afterEach, describe, expect, it } from "vitest";

const { closeDb, db } = await import("@/lib/db");
const { auth } = await import("@/lib/auth");

type Person = { id: string; headers: Headers };
const made: string[] = [];

async function person(name: string, role?: "admin"): Promise<Person> {
  const email = `auth-events-${randomUUID()}@example.test`;
  const { headers, response } = await auth.api.signUpEmail({
    body: { email, password: `pw-${randomUUID()}`, name },
    returnHeaders: true,
  });
  made.push(response.user.id);
  if (role) await db().query(`update "user" set "role" = $2 where "id" = $1`, [response.user.id, role]);
  // The session cookie alone, as the browser would send it back.
  const cookie = headers.get("set-cookie")!.split(";")[0];
  return { id: response.user.id, headers: new Headers({ cookie }) };
}

/** Every account event about or by the people this test made. */
async function events() {
  const { rows } = await db().query<{ kind: string; lang: string | null; actorId: string | null; subject: string; detail: Record<string, unknown> }>(
    `select "kind", "lang", "actorId", "subject", "detail" from "activity"
      where "kind" like 'user.%' and ("subject" = any($1) or "actorId" = any($1))
      order by "id"`,
    [made],
  );
  return rows;
}

afterEach(async () => {
  await db().query(`delete from "activity" where "subject" = any($1) or "actorId" = any($1)`, [made]);
  await db().query(`delete from "user" where "id" = any($1)`, [made]);
  made.length = 0;
});

afterAll(async () => {
  await closeDb();
});

describe("account events", () => {
  it("records a role change, by whom and to what, for every language", async () => {
    const admin = await person("Admin", "admin");
    const target = await person("Target");

    await auth.api.setRole({ body: { userId: target.id, role: "admin" }, headers: admin.headers });

    expect(await events()).toEqual([
      { kind: "user.role_changed", lang: null, actorId: admin.id, subject: target.id, detail: { role: "admin" } },
    ]);
  });

  it("records several roles as one readable value", async () => {
    const admin = await person("Admin", "admin");
    const target = await person("Target");

    await auth.api.setRole({ body: { userId: target.id, role: ["member", "admin"] }, headers: admin.headers });

    expect((await events())[0].detail).toEqual({ role: "admin, member" });
  });

  it("records a ban with its reason and length, and the unban", async () => {
    const admin = await person("Admin", "admin");
    const target = await person("Target");

    await auth.api.banUser({ body: { userId: target.id, banReason: "spam", banExpiresIn: 3600 }, headers: admin.headers });
    await auth.api.unbanUser({ body: { userId: target.id }, headers: admin.headers });

    expect((await events()).map(({ kind, actorId, detail }) => ({ kind, actorId, detail }))).toEqual([
      { kind: "user.banned", actorId: admin.id, detail: { banReason: "spam", banExpiresIn: 3600 } },
      { kind: "user.unbanned", actorId: admin.id, detail: {} },
    ]);
  });

  it("records a removal", async () => {
    const admin = await person("Admin", "admin");
    const target = await person("Target");

    await auth.api.removeUser({ body: { userId: target.id }, headers: admin.headers });

    expect(await events()).toEqual([
      { kind: "user.removed", lang: null, actorId: admin.id, subject: target.id, detail: {} },
    ]);
  });

  it("records impersonation under the admin who did it, not the person impersonated", async () => {
    const admin = await person("Admin", "admin");
    const target = await person("Target");

    await auth.api.impersonateUser({ body: { userId: target.id }, headers: admin.headers });

    expect(await events()).toEqual([
      { kind: "user.impersonated", lang: null, actorId: admin.id, subject: target.id, detail: {} },
    ]);
  });

  it("records a role change or a ban made through update-user, and nothing for other fields", async () => {
    const admin = await person("Admin", "admin");
    const target = await person("Target");

    await auth.api.adminUpdateUser({ body: { userId: target.id, data: { name: "Renamed" } }, headers: admin.headers });
    await auth.api.adminUpdateUser({ body: { userId: target.id, data: { role: "admin" } }, headers: admin.headers });
    await auth.api.adminUpdateUser({
      body: { userId: target.id, data: { banned: true, banReason: "spam" } },
      headers: admin.headers,
    });
    await auth.api.adminUpdateUser({ body: { userId: target.id, data: { banned: false } }, headers: admin.headers });

    expect((await events()).map(({ kind, actorId, detail }) => ({ kind, actorId, detail }))).toEqual([
      { kind: "user.role_changed", actorId: admin.id, detail: { role: "admin" } },
      { kind: "user.banned", actorId: admin.id, detail: { banReason: "spam" } },
      { kind: "user.unbanned", actorId: admin.id, detail: {} },
    ]);
  });

  it("records nothing when the plugin refuses", async () => {
    const admin = await person("Admin", "admin");
    const member = await person("Member");
    const target = await person("Target");

    // A member may not set roles; nobody may remove themselves; a request must name a user;
    // and nobody signed in may do anything.
    await expect(auth.api.setRole({ body: { userId: target.id, role: "admin" }, headers: member.headers })).rejects.toThrow();
    await expect(auth.api.removeUser({ body: { userId: admin.id }, headers: admin.headers })).rejects.toThrow();
    await expect(auth.api.removeUser({ body: { userId: member.id }, headers: member.headers })).rejects.toThrow();
    await expect(
      auth.api.setRole({ body: { role: "admin" } as { userId: string; role: "admin" }, headers: admin.headers }),
    ).rejects.toThrow();
    await expect(auth.api.removeUser({ body: { userId: target.id }, headers: new Headers() })).rejects.toThrow();

    expect(await events()).toEqual([]);
  });
});
