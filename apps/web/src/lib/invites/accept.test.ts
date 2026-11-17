/**
 * Needs DATABASE_URL and migrations applied.
 */
import { randomBytes, randomInt, randomUUID } from "node:crypto";

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { closeDb } from "@/lib/db";
import { grantsOf, viewerById } from "@/lib/grants/store";
import type { Lang } from "@/lib/lang";
import { forgetLanguages, loadLanguages } from "@/lib/languages/catalogue";
import type { Capability } from "@/lib/permissions";
import { asActor } from "@/lib/teams/acting";
import { forgetTeams } from "@/lib/teams/store";
import { asSystem, dropTeam, systemRows, testUser } from "@/lib/teams/testing";

import { acceptInvite, createInvite, lookupInvite, revokeInvite } from "./store";

// Wrapped, so a test can act between acceptInvite's lookup and its claim.
vi.mock("@/lib/grants/store", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/grants/store")>();
  return { ...original, viewerById: vi.fn(original.viewerById) };
});

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
    team: null,
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
    expect(await lookupInvite(token)).toMatchObject({ state: "accepted", acceptedBy: user.id });
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
    // The inviter's check runs after the lookup and before the claim: the resend lands there.
    const original = (await vi.importActual<typeof import("@/lib/grants/store")>("@/lib/grants/store")).viewerById;
    vi.mocked(viewerById).mockImplementationOnce(async (id) => {
      expect((await lookupInvite(token))?.state).toBe("pending");
      await asSystem.query(`update "invite" set "tokenHash" = 'replaced-' || "id" where "id" = $1`, [invite.id]);
      return original(id);
    });
    expect(await acceptInvite(token, user)).toMatchObject({ ok: false, reason: "unknown" });
    expect(vi.mocked(viewerById)).toHaveBeenCalled();
    expect(await grantsOf(user.id)).toEqual([]);
    expect(await kinds("invite.accepted", invite.id)).toEqual([]);
  });

  it("refuses an invite other than the one the page showed", async () => {
    const { token, user } = await setup();
    expect(await acceptInvite(token, user, "another-invite")).toMatchObject({ ok: false, reason: "changed" });
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

describe("acceptInvite in a language with a second team", () => {
  const CAPITALS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  const MEMBER = `insert into "team_member" ("teamId", "userId", "lang", "capability") values ($1, $2, $3, $4)`;
  let lang: Lang;
  let teamA: string | undefined;
  let teamB: string | undefined;
  let made: User[] = [];

  async function newTeam(name: string, privileged: boolean): Promise<string> {
    const [row] = await systemRows<{ id: string }>(`select new_team($1, $1) as "id"`, [`${name}-${randomUUID().slice(0, 8)}`]);
    await asSystem.query(`insert into "team_language" ("teamId", "lang", "privileged") values ($1, $2, $3)`, [
      row.id, lang, privileged,
    ]);
    forgetTeams();
    return row.id;
  }

  async function user(prefix: string): Promise<User> {
    const one = await testUser(prefix);
    made.push(one);
    return one;
  }

  /** An invite from an admin of `team` (null: the privileged team's admin, naming no team). */
  async function invite(team: string | null, capabilities: Capability[] = ["edit", "regenerate"]) {
    const admin = await user("test-accept-admin");
    await asSystem.query(MEMBER, [team ?? teamA, admin.id, lang, "admin"]);
    // Only a site owner appoints text where the team does not.
    if (capabilities.includes("text")) await asSystem.query(`update "user" set "role" = 'admin' where "id" = $1`, [admin.id]);
    const invitee = await user("test-accept-invitee");
    const address = `${invitee.id}@example.invalid`;
    const created = await createInvite({
      email: address,
      lang,
      capabilities,
      invitedBy: admin.id,
      limited: false,
      team,
    });
    return { ...created, admin, user: { id: invitee.id, email: address } };
  }

  const teamsOf = async (userId: string) =>
    (await systemRows<{ teamId: string }>(`select distinct "teamId" from "team_member" where "userId" = $1`, [userId])).map(
      (row) => row.teamId,
    );

  beforeEach(async () => {
    // A code no language has yet, so afterEach never deletes a row it did not make.
    for (;;) {
      const code = `xq${CAPITALS[randomInt(26)]}${CAPITALS[randomInt(26)]}`;
      const inserted = await asSystem.query(
        `insert into "language" ("code", "name", "native", "bcp47", "provider", "client", "enabled", "textByTeam")
         values ($1, 'Xq', 'Xq', 'xq-XQ', 'xq', false, false, false) on conflict do nothing`,
        [code],
      );
      if (inserted.rowCount) {
        lang = code as Lang;
        break;
      }
    }
    forgetLanguages();
    await loadLanguages();
    teamA = await newTeam("accept-a", true);
    teamB = await newTeam("accept-b", false);
  });

  afterEach(async () => {
    for (const team of [teamA, teamB]) {
      if (!team) continue;
      await asSystem.query(`delete from "activity" where "teamId" = $1`, [team]);
      await dropTeam(team);
    }
    await asSystem.query(`delete from "activity" where "lang" = $1`, [lang]);
    await asSystem.query(`delete from "language_grant" where "lang" = $1`, [lang]);
    await asSystem.query(`delete from "language" where "code" = $1`, [lang]);
    forgetLanguages();
    forgetTeams();
    for (const one of made) await one.cleanup();
    made = [];
    teamA = teamB = undefined;
  });

  it("puts the grants in the invite's team, and files the acts there", async () => {
    const { invite: sent, token, user } = await invite(teamB!);
    expect(await acceptInvite(token, user)).toEqual({ ok: true, lang, capabilities: ["edit", "regenerate"] });
    expect(await teamsOf(user.id)).toEqual([teamB]);
    expect(
      await systemRows(`select "teamId" from "activity" where "kind" = 'invite.accepted' and "subject" = $1`, [sent.id]),
    ).toEqual([{ teamId: teamB }]);
    expect(
      await systemRows(`select "teamId" from "activity" where "kind" = 'grant.added' and "subject" = $1`, [user.id]),
    ).toEqual([{ teamId: teamB }, { teamId: teamB }]);
  });

  it("refuses somebody who already works on the language in the other team, and stays pending", async () => {
    const { token, user } = await invite(teamB!);
    await asSystem.query(MEMBER, [teamA, user.id, lang, "record"]);
    expect(await acceptInvite(token, user)).toMatchObject({ ok: false, reason: "other-team", lang });
    expect(await teamsOf(user.id)).toEqual([teamA]);
    expect((await grantsOf(user.id)).filter((grant) => grant.lang === lang)).toEqual([
      { lang, capability: "record" },
    ]);
    expect((await lookupInvite(token))?.state).toBe("pending");
  });

  it("accepts a text-only invite for somebody in the second team, logged under the team they act as", async () => {
    const { invite: sent, token, user } = await invite(null, ["text"]);
    await asSystem.query(MEMBER, [teamB, user.id, lang, "record"]);
    expect(await asActor(user.id, () => acceptInvite(token, user))).toEqual({ ok: true, lang, capabilities: ["text"] });
    expect((await grantsOf(user.id)).filter((grant) => grant.lang === lang)).toContainEqual({ lang, capability: "text" });
    expect(
      await systemRows(`select "teamId" from "activity" where "kind" = 'invite.accepted' and "subject" = $1`, [sent.id]),
    ).toEqual([{ teamId: teamB }]);
  });

  it("puts an invite that names no team in the privileged team", async () => {
    const { invite: sent, token, user } = await invite(null);
    expect((await acceptInvite(token, user)).ok).toBe(true);
    expect(await teamsOf(user.id)).toEqual([teamA]);
    expect(
      await systemRows(`select "teamId" from "activity" where "kind" = 'invite.accepted' and "subject" = $1`, [sent.id]),
    ).toEqual([{ teamId: teamA }]);
  });
});
