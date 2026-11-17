/**
 * Needs DATABASE_URL and migrations applied.
 */
import { createHash, randomInt, randomUUID } from "node:crypto";

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { closeDb, withTeam } from "@/lib/db";
import type { Lang } from "@/lib/lang";
import { forgetLanguages, loadLanguages } from "@/lib/languages/catalogue";
import { teamIn } from "@/lib/teams/acting";
import { forgetTeams } from "@/lib/teams/store";
import { asSystem, dropTeam, systemRows, testUser } from "@/lib/teams/testing";

import { manageableInvite } from "./manage";

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
  revokeOpenFor,
} from "./store";

const session = vi.hoisted(() => ({ id: "" }));

vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("@/lib/auth", () => ({
  auth: { api: { getSession: async () => ({ user: { id: session.id, role: null } }) } },
}));

let inviter: Awaited<ReturnType<typeof testUser>>;
const email = () => `invitee-${inviter.id}@example.com`;
const sends = async () => true;
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
  team: null,
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
    await resendInvite(invite.id, true, inviter.id, sends);
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
      invitedByName: inviter.id,
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
    const again = await resendInvite(invite.id, false, inviter.id, sends);
    expect(await lookupInvite(token)).toBeNull();
    expect(await lookupInvite(again.token)).toMatchObject({ state: "pending" });
    const [row] = (await asSystem.query(`select "sendCount" from "invite" where "id" = $1`, [invite.id])).rows;
    expect(row.sendCount).toBe(2);
    await expect(resendInvite(invite.id, true, inviter.id, sends)).rejects.toBeInstanceOf(InviteRateError);
  });

  it("revokes once, then cannot resend, and lists no more", async () => {
    const { invite } = await createInvite(args({ email: `revoke-${email()}` }));
    expect((await revokeInvite(invite.id, inviter.id))?.id).toBe(invite.id);
    expect(await revokeInvite(invite.id, inviter.id)).toBeNull();
    await expect(resendInvite(invite.id, false, inviter.id, sends)).rejects.toBeInstanceOf(InviteGoneError);
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

describe("an invite in a second team", () => {
  const CAPITALS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  const MEMBER = `insert into "team_member" ("teamId", "userId", "lang", "capability") values ($1, $2, $3, 'admin')`;
  let lang: Lang;
  let teamA: string | undefined;
  let teamB: string | undefined;
  let adminA: Awaited<ReturnType<typeof testUser>> | undefined;
  let adminB: Awaited<ReturnType<typeof testUser>> | undefined;

  async function newTeam(name: string, privileged: boolean): Promise<string> {
    const [row] = await systemRows<{ id: string }>(`select new_team($1, $1) as "id"`, [`${name}-${randomUUID().slice(0, 8)}`]);
    await asSystem.query(`insert into "team_language" ("teamId", "lang", "privileged") values ($1, $2, $3)`, [
      row.id, lang, privileged,
    ]);
    forgetTeams();
    return row.id;
  }

  beforeEach(async () => {
    // A code no language has yet, so afterEach never deletes a row it did not make.
    for (;;) {
      const code = `xq${CAPITALS[randomInt(26)]}${CAPITALS[randomInt(26)]}`;
      const made = await asSystem.query(
        `insert into "language" ("code", "name", "native", "bcp47", "provider", "client", "enabled", "textByTeam")
         values ($1, 'Xq', 'Xq', 'xq-XQ', 'xq', false, false, false) on conflict do nothing`,
        [code],
      );
      if (made.rowCount) {
        lang = code as Lang;
        break;
      }
    }
    forgetLanguages();
    await loadLanguages();
    adminA = await testUser("test-invites-a");
    adminB = await testUser("test-invites-b");
    teamA = await newTeam("invites-a", true);
    teamB = await newTeam("invites-b", false);
    await asSystem.query(MEMBER, [teamA, adminA.id, lang]);
    await asSystem.query(MEMBER, [teamB, adminB.id, lang]);
  });

  afterEach(async () => {
    for (const team of [teamA, teamB]) {
      if (!team) continue;
      await asSystem.query(`delete from "activity" where "teamId" = $1`, [team]);
      await dropTeam(team);
    }
    await asSystem.query(`delete from "activity" where "lang" = $1`, [lang]);
    await asSystem.query(`delete from "language" where "code" = $1`, [lang]);
    forgetLanguages();
    forgetTeams();
    // The users' cascade deletes their invites.
    for (const user of [adminA, adminB]) await user?.cleanup();
    teamA = teamB = adminA = adminB = undefined;
  });

  it("joins the inviter's team, is listed and logged there, and is no business of the other team", async () => {
    const { invite } = await createInvite(
      args({ email: `b-${email()}`, lang, invitedBy: adminB!.id, team: await teamIn(adminB!.id, lang) }),
    );
    expect(invite.teamId).toBe(teamB);
    expect(await systemRows(`select "joinTeamId" from "invite" where "id" = $1`, [invite.id])).toEqual([
      { joinTeamId: teamB },
    ]);
    expect((await listInvites([lang], teamB)).map((row) => row.id)).toEqual([invite.id]);
    expect(await listInvites([lang], teamA)).toEqual([]);
    expect(
      await systemRows(`select "kind", "teamId" from "activity" where "subject" = $1`, [invite.id]),
    ).toEqual([{ kind: "invite.sent", teamId: teamB }]);

    session.id = adminA!.id;
    expect(((await manageableInvite(invite.id)) as Response).status).toBe(404);
    session.id = adminB!.id;
    expect(await manageableInvite(invite.id)).not.toBeInstanceOf(Response);

    await asSystem.query(`update "invite" set "sentAt" = now() - interval '1 hour' where "id" = $1`, [invite.id]);
    await resendInvite(invite.id, true, adminB!.id, sends);
    await revokeInvite(invite.id, adminB!.id);
    expect(
      await systemRows(`select "kind", "teamId" from "activity" where "subject" = $1 order by "id"`, [invite.id]),
    ).toEqual([
      { kind: "invite.sent", teamId: teamB },
      { kind: "invite.resent", teamId: teamB },
      { kind: "invite.revoked", teamId: teamB },
    ]);
  });

  it("tells another team's admin the address is invited to another team, not to resend or revoke", async () => {
    const to = `taken-${email()}`;
    await createInvite(args({ email: to, lang, invitedBy: adminA!.id }));
    await expect(createInvite(args({ email: to, lang, invitedBy: adminB!.id, team: teamB! }))).rejects.toThrow(
      "That address is already invited to another team in this language.",
    );
    await expect(createInvite(args({ email: to, lang, invitedBy: adminA!.id }))).rejects.toThrow(
      "That address is already invited; resend or revoke the invite.",
    );
  });

  it("is revoked by a grant in its own team only, and logged there", async () => {
    const to = `granted-${email()}`;
    const { invite: ofB } = await createInvite(args({ email: to, lang, invitedBy: adminB!.id, team: teamB! }));
    const revokeAs = (team: string) =>
      withTeam(team, (client) => revokeOpenFor(client, lang, to, adminA!.id, ["edit", "regenerate"], adminA!.id));

    await revokeAs(teamA!);
    expect((await listInvites([lang])).map((row) => row.id)).toEqual([ofB.id]);
    await revokeAs(teamB!);
    expect(await listInvites([lang])).toEqual([]);
    expect(
      await systemRows(`select "teamId" from "activity" where "kind" = 'invite.revoked' and "subject" = $1`, [ofB.id]),
    ).toEqual([{ teamId: teamB }]);
  });

  it("joins the privileged team when it names none, as before", async () => {
    const { invite } = await createInvite(args({ email: `a-${email()}`, lang, invitedBy: adminA!.id }));
    expect(invite.teamId).toBeNull();
    expect((await listInvites([lang], teamA)).map((row) => row.id)).toEqual([invite.id]);
    expect(await listInvites([lang], teamB)).toEqual([]);
    expect(await systemRows(`select "teamId" from "activity" where "subject" = $1`, [invite.id])).toEqual([
      { teamId: teamA },
    ]);
    session.id = adminB!.id;
    expect(((await manageableInvite(invite.id)) as Response).status).toBe(404);
    session.id = adminA!.id;
    expect(await manageableInvite(invite.id)).not.toBeInstanceOf(Response);
  });
});
