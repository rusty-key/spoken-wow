/**
 * Needs DATABASE_URL and migrations applied.
 */
import { createHash } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { closeDb } from "@/lib/db";
import { asSystem, testUser } from "@/lib/teams/testing";

import {
  createInvite,
  InviteExistsError,
  InviteGoneError,
  InviteRateError,
  listInvites,
  lookupInvite,
  normalEmail,
  resendInvite,
  revokeInvite,
} from "./store";

let inviter: Awaited<ReturnType<typeof testUser>>;
const email = () => `invitee-${inviter.id}@example.com`;
const sha = (token: string) => createHash("sha256").update(token).digest("hex");

beforeAll(async () => {
  inviter = await testUser("test-invites");
});

afterAll(async () => {
  await asSystem.query(`delete from "activity" where "actorId" = $1`, [inviter.id]);
  // The app role may not delete invites; the user's cascade does.
  await inviter.cleanup();
  await closeDb();
});

const args = (over: Partial<Parameters<typeof createInvite>[0]> = {}) => ({
  email: email(),
  lang: "deDE" as const,
  capabilities: ["edit", "regenerate"] as ("edit" | "regenerate")[],
  invitedBy: inviter.id,
  limited: false,
  ...over,
});

describe("normalEmail", () => {
  it("trims and lower-cases, and refuses what is not an address", () => {
    expect(normalEmail(" Ana@Example.com ")).toBe("ana@example.com");
    expect(normalEmail("nope")).toBeNull();
    expect(normalEmail(`${"a".repeat(250)}@b.cd`)).toBeNull();
  });
});

describe("invites", () => {
  it("records each act in the activity log, and nothing when the act fails", async () => {
    const to = `logged-${email()}`;
    const kinds = async (subject: string) =>
      (await asSystem.query(`select "kind" from "activity" where "subject" = $1 order by "id"`, [subject])).rows.map((r) => r.kind);
    const { invite } = await createInvite(args({ email: to }));
    await asSystem.query(`update "invite" set "sentAt" = now() - interval '1 hour' where "id" = $1`, [invite.id]);
    await resendInvite(invite.id, true, inviter.id);
    await revokeInvite(invite.id, inviter.id);
    expect(await kinds(invite.id)).toEqual(["invite.sent", "invite.resent", "invite.revoked"]);

    // A bad capability fails the insert, after which nothing may be logged.
    const before = (await asSystem.query(`select count(*)::int as n from "activity" where "actorId" = $1`, [inviter.id])).rows[0].n;
    await expect(createInvite(args({ email: `bad-${to}`, capabilities: ["nonsense" as never] }))).rejects.toThrow();
    const after = (await asSystem.query(`select count(*)::int as n from "activity" where "actorId" = $1`, [inviter.id])).rows[0].n;
    expect(after).toBe(before);
  });

  it("stores only the hash, and looks the invite up by token", async () => {
    const { invite, token } = await createInvite(args());
    expect(token).toHaveLength(43);
    const [row] = (await asSystem.query(`select * from "invite" where "id" = $1`, [invite.id])).rows;
    expect(row.tokenHash).toBe(sha(token));
    expect(Object.values(row)).not.toContain(token);
    expect(Math.abs(row.expiresAt.getTime() - (Date.now() + 14 * 86_400_000))).toBeLessThan(60_000);

    expect(await lookupInvite(token)).toMatchObject({
      id: invite.id,
      state: "pending",
      capabilities: ["edit", "regenerate"],
      inviterName: inviter.id,
    });
    expect(await lookupInvite("x")).toBeNull();
  });

  it("refuses a second open invite, and replaces an expired one", async () => {
    const [first] = (await asSystem.query(`select "id" from "invite" where "invitedBy" = $1 and "email" = $2`, [inviter.id, email()])).rows;
    await expect(createInvite(args())).rejects.toBeInstanceOf(InviteExistsError);
    await asSystem.query(`update "invite" set "expiresAt" = now() - interval '1 second' where "id" = $1`, [first.id]);
    await createInvite(args());
    const [old] = (await asSystem.query(`select "revokedAt" from "invite" where "id" = $1`, [first.id])).rows;
    expect(old.revokedAt).not.toBeNull();
  });

  it("resends with a new token, and rate limits a resend", async () => {
    const { invite, token } = await createInvite(args({ email: `resend-${email()}` }));
    const again = await resendInvite(invite.id, false, inviter.id);
    expect(await lookupInvite(token)).toBeNull();
    expect(await lookupInvite(again.token)).toMatchObject({ state: "pending" });
    const [row] = (await asSystem.query(`select "sendCount" from "invite" where "id" = $1`, [invite.id])).rows;
    expect(row.sendCount).toBe(2);
    await expect(resendInvite(invite.id, true, inviter.id)).rejects.toBeInstanceOf(InviteRateError);
  });

  it("revokes once, then cannot resend, and lists no more", async () => {
    const { invite } = await createInvite(args({ email: `revoke-${email()}` }));
    expect((await revokeInvite(invite.id, inviter.id))?.id).toBe(invite.id);
    expect(await revokeInvite(invite.id, inviter.id)).toBeNull();
    await expect(resendInvite(invite.id, false, inviter.id)).rejects.toBeInstanceOf(InviteGoneError);
    expect((await listInvites(["deDE"])).map((row) => row.id)).not.toContain(invite.id);
  });

  it("limits an inviter to twenty a day", async () => {
    const busy = await testUser("test-invites-busy");
    await asSystem.query(
      `insert into "invite" ("email", "lang", "capabilities", "tokenHash", "invitedBy", "expiresAt")
       select 'bulk' || n || '-' || $1 || '@example.com', 'deDE', array['edit'], 'hash-' || $1 || n, $1, now() + interval '1 day'
         from generate_series(1, 20) n`,
      [busy.id],
    );
    await expect(createInvite(args({ limited: true, invitedBy: busy.id }))).rejects.toBeInstanceOf(InviteRateError);
    await expect(createInvite(args({ limited: false, invitedBy: busy.id, email: `free-${email()}` }))).resolves.toBeDefined();
    await busy.cleanup();
  });
});
