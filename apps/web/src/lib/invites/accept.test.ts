/**
 * Needs DATABASE_URL and migrations applied.
 */
import { randomBytes } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { closeDb } from "@/lib/db";
import { grantsOf } from "@/lib/grants/store";
import { asSystem, testUser } from "@/lib/teams/testing";

import { acceptInvite, createInvite, lookupInvite, revokeInvite } from "./store";

type User = Awaited<ReturnType<typeof testUser>>;
let inviter: User;
const users: User[] = [];

async function adminInviter(): Promise<User> {
  const user = await testUser("test-accept-inviter");
  users.push(user);
  await asSystem.query(
    `insert into "team_member" ("teamId", "userId", "lang", "capability")
     select "teamId", $1, 'deDE', 'admin' from "team_language" where "lang" = 'deDE'`,
    [user.id],
  );
  return user;
}

/** An invite to a fresh invitee, whose account has the address in `accountCase`. */
async function setup(accountCase: (s: string) => string = (s) => s) {
  const invitee = await testUser("test-accept-invitee");
  users.push(invitee);
  const address = `${invitee.id}@example.invalid`.toLowerCase();
  await asSystem.query(`update "user" set "email" = $2 where "id" = $1`, [invitee.id, accountCase(address)]);
  const { invite, token } = await createInvite({
    email: address,
    lang: "deDE",
    capabilities: ["edit", "regenerate"],
    invitedBy: inviter.id,
    limited: false,
  });
  return { invitee, invite, token, user: { id: invitee.id, email: accountCase(address) } };
}

beforeAll(async () => {
  inviter = await adminInviter();
});

afterAll(async () => {
  for (const user of users) {
    await asSystem.query(`delete from "activity" where "actorId" = $1 or "subject" = $1`, [user.id]);
    await asSystem.query(`delete from "team_member" where "userId" = $1`, [user.id]);
  }
  for (const user of users) await user.cleanup();
  await closeDb();
});

const kinds = async (kind: string, subject: string) =>
  (await asSystem.query(`select "actorId" from "activity" where "kind" = $1 and "subject" = $2`, [kind, subject])).rows;

describe("acceptInvite", () => {
  it("grants what the invite names, as the inviter, and logs it", async () => {
    const { invite, token, user } = await setup();
    expect(await acceptInvite(token, user)).toEqual({ ok: true, lang: "deDE", capabilities: ["edit", "regenerate"] });
    expect(await grantsOf(user.id)).toEqual([
      { lang: "deDE", capability: "edit" },
      { lang: "deDE", capability: "regenerate" },
    ]);
    const { rows } = await asSystem.query(`select "grantedBy" from "team_member" where "userId" = $1`, [user.id]);
    expect(rows.map((r) => r.grantedBy)).toEqual([inviter.id, inviter.id]);
    const [row] = (await asSystem.query(`select "acceptedAt", "acceptedBy" from "invite" where "id" = $1`, [invite.id])).rows;
    expect(row.acceptedAt).not.toBeNull();
    expect(row.acceptedBy).toBe(user.id);
    expect(await kinds("invite.accepted", invite.id)).toEqual([{ actorId: user.id }]);
    const added = await kinds("grant.added", user.id);
    expect(added).toEqual([{ actorId: inviter.id }, { actorId: inviter.id }]);
    expect((await lookupInvite(token))?.state).toBe("accepted");
  });

  it("accepts when the account's address is in another case", async () => {
    const { token, user } = await setup((s) => s.toUpperCase());
    expect((await acceptInvite(token, user)).ok).toBe(true);
  });

  it("refuses somebody signed in as another address", async () => {
    const { invite, token } = await setup();
    const other = await testUser("test-accept-other");
    users.push(other);
    const outcome = await acceptInvite(token, { id: other.id, email: `${other.id}@example.invalid` });
    expect(outcome).toMatchObject({ ok: false, reason: "wrong-email", email: invite.email });
    expect(await grantsOf(other.id)).toEqual([]);
    expect((await lookupInvite(token))?.state).toBe("pending");
  });

  it("refuses when the inviter may no longer grant, and stays pending", async () => {
    const { token, user } = await setup();
    await asSystem.query(`delete from "team_member" where "userId" = $1`, [inviter.id]);
    expect(await acceptInvite(token, user)).toMatchObject({
      ok: false,
      reason: "inviter-cannot-grant",
      capability: "edit",
    });
    expect(await grantsOf(user.id)).toEqual([]);
    expect((await lookupInvite(token))?.state).toBe("pending");

    // And back, but banned.
    await asSystem.query(
      `insert into "team_member" ("teamId", "userId", "lang", "capability")
       select "teamId", $1, 'deDE', 'admin' from "team_language" where "lang" = 'deDE'`,
      [inviter.id],
    );
    await asSystem.query(`update "user" set "banned" = true where "id" = $1`, [inviter.id]);
    expect(await acceptInvite(token, user)).toMatchObject({ ok: false, reason: "inviter-cannot-grant" });
    await asSystem.query(`update "user" set "banned" = false where "id" = $1`, [inviter.id]);
    expect((await acceptInvite(token, user)).ok).toBe(true);
  });

  it("gives the grants once when pressed twice at the same time", async () => {
    const { invite, token, user } = await setup();
    const outcomes = await Promise.all([acceptInvite(token, user), acceptInvite(token, user)]);
    expect(outcomes.filter((o) => o.ok)).toHaveLength(1);
    expect(outcomes.find((o) => !o.ok)).toMatchObject({ reason: "accepted" });
    expect(await kinds("invite.accepted", invite.id)).toHaveLength(1);
  });

  it("does not accept a link that a resend replaced after the lookup", async () => {
    const { invite, token, user } = await setup();
    // Simulates the resend landing between the lookup and the claim: the hash no longer matches.
    await asSystem.query(`update "invite" set "tokenHash" = 'replaced-' || "id" where "id" = $1`, [invite.id]);
    expect(await acceptInvite(token, user)).toMatchObject({ ok: false, reason: "unknown" });
    expect(await grantsOf(user.id)).toEqual([]);
  });

  it("names an expired, revoked and unknown invite", async () => {
    const expired = await setup();
    await asSystem.query(`update "invite" set "expiresAt" = now() - interval '1 second' where "id" = $1`, [expired.invite.id]);
    expect(await acceptInvite(expired.token, expired.user)).toMatchObject({ ok: false, reason: "expired" });

    const revoked = await setup();
    await revokeInvite(revoked.invite.id, inviter.id);
    expect(await acceptInvite(revoked.token, revoked.user)).toMatchObject({ ok: false, reason: "revoked" });

    expect(await acceptInvite(randomBytes(32).toString("base64url"), revoked.user)).toMatchObject({
      ok: false,
      reason: "unknown",
    });
  });
});
