/**
 * Session and grants mocked, writes real.
 *
 * Needs DATABASE_URL and migrations applied.
 */
import { randomInt, randomUUID } from "node:crypto";

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { closeDb } from "@/lib/db";
import { forgetLanguages, loadLanguages } from "@/lib/languages/catalogue";
import type { Viewer } from "@/lib/permissions";
import { forgetTeams } from "@/lib/teams/store";
import { asSystem, dropTeam, systemRows, testUser } from "@/lib/teams/testing";

const who = vi.hoisted(() => ({ viewer: { role: null, grants: [] } as Viewer, id: "" }));

vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("@/lib/auth", () => ({
  auth: { api: { getSession: async () => ({ user: { id: who.id, role: who.viewer.role } }) } },
}));
const sent = vi.hoisted(() => [] as { to: string; args: { url: string; capabilities: string[] } }[]);
const mail = vi.hoisted(() => ({ delivers: true }));
vi.mock("@/lib/email", () => ({
  sendInviteEmail: async (to: string, args: { url: string; capabilities: string[] }) => {
    sent.push({ to, args });
    return mail.delivers;
  },
  sendEmail: () => {},
  sendPasswordResetEmail: () => {},
}));
vi.mock("@/lib/grants/store", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/grants/store")>()),
  viewerOf: async () => who.viewer,
}));

import { grantsOf } from "@/lib/grants/store";
import { createInvite, lookupInvite, openInvite } from "@/lib/invites/store";

import { DELETE, GET, PUT } from "./route";

let target: Awaited<ReturnType<typeof testUser>>;
let granter: Awaited<ReturnType<typeof testUser>>;
const email = () => `${target.id}@example.invalid`;

beforeAll(async () => {
  target = await testUser("test-grants-route");
  granter = await testUser("test-grants-route-by");
  who.id = granter.id;
  await asSystem.query(
    `insert into "language" ("code", "name", "native", "bcp47", "provider", "client", "enabled", "textByTeam")
     values ('xqGR', 'Xq', 'Xq', 'xq-GR', 'xq', false, false, true) on conflict do nothing`,
  );
  forgetLanguages();
  await loadLanguages();
});

beforeEach(() => {
  sent.length = 0;
  who.viewer = { role: null, grants: [{ lang: "deDE", capability: "admin" }] };
});

afterAll(async () => {
  await asSystem.query(`delete from "activity" where "subject" = $1 or "actorId" = $2`, [target.id, granter.id]);
  await asSystem.query(`delete from "language_grant" where "userId" = $1`, [target.id]);
  await asSystem.query(`delete from "team_member" where "userId" = $1`, [target.id]);
  await asSystem.query(`delete from "language" where "code" = 'xqGR'`);
  forgetLanguages();
  await target.cleanup();
  await granter.cleanup();
  await closeDb();
});

function put(capabilities: string[], lang = "deDE"): Promise<Response> {
  return PUT(
    new Request("https://example.com/api/grants", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: email(), lang, capabilities }),
    }),
  );
}

function remove(capability: string, userId = target.id, lang = "deDE"): Promise<Response> {
  const params = new URLSearchParams({ userId, lang, capability });
  return DELETE(new Request(`https://example.com/api/grants?${params}`, { method: "DELETE" }));
}

describe("/api/grants", () => {
  it("refuses a language admin text, alone or among what they may give", async () => {
    expect((await put(["text"])).status).toBe(403);
    expect((await put(["edit", "text"])).status).toBe(403);
    expect(await grantsOf(target.id)).toEqual([]);
  });

  it("lets a language admin give the team's edit", async () => {
    expect((await put(["edit"])).status).toBe(200);
    expect(await grantsOf(target.id)).toEqual([{ lang: "deDE", capability: "edit" }]);
  });

  it("lets a site owner appoint, and a language admin not dismiss", async () => {
    who.viewer = { role: "admin", grants: [] };
    expect((await put(["text"])).status).toBe(200);
    who.viewer = { role: null, grants: [{ lang: "deDE", capability: "admin" }] };
    expect((await remove("text")).status).toBe(403);
    expect(await grantsOf(target.id)).toContainEqual({ lang: "deDE", capability: "text" });
  });

  it("refuses a language admin their own admin, and lets a site owner take it", async () => {
    expect((await remove("admin", granter.id)).status).toBe(403);
    who.viewer = { role: "admin", grants: [] };
    expect((await remove("admin", granter.id)).status).toBe(200);
  });

  it("lets the admin of a textByTeam language appoint and dismiss text there, not elsewhere", async () => {
    who.viewer = {
      role: null,
      grants: [{ lang: "xqGR", capability: "admin" }, { lang: "deDE", capability: "admin" }],
    };
    expect((await put(["text"], "xqGR")).status).toBe(200);
    const rows = await asSystem.query(`select 1 from "language_grant" where "userId" = $1 and "lang" = 'xqGR'`, [target.id]);
    expect(rows.rowCount).toBe(1);
    expect((await remove("text", target.id, "xqGR")).status).toBe(200);
    expect((await put(["text"], "deDE")).status).toBe(403);
  });

  describe("an address with no account", () => {
    const stranger = `nobody-${Math.random().toString(36).slice(2, 10)}@example.invalid`;
    const putTo = (to: string, capabilities: string[]) =>
      PUT(
        new Request("https://example.com/api/grants", {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ email: to, lang: "deDE", capabilities }),
        }),
      );

    it("sends an invite, once", async () => {
      const response = await putTo(stranger, ["edit", "record"]);
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.invited).toBe(true);
      expect(body.invites).toContainEqual(
        expect.objectContaining({ email: stranger, capabilities: ["edit", "record"] }),
      );
      expect(sent).toHaveLength(1);
      expect(sent[0].to).toBe(stranger);
      expect(sent[0].args.url).toContain("/api/invites/open?token=");
      await expect(lookupInvite(sent[0].args.url.split("token=")[1])).resolves.toMatchObject({ state: "pending" });
      const log = await asSystem.query(`select 1 from "activity" where "kind" = 'invite.sent' and "actorId" = $1`, [granter.id]);
      expect(log.rowCount).toBe(1);

      expect((await putTo(stranger, ["edit"])).status).toBe(409);
    });

    it("creates no invite when its email cannot be sent", async () => {
      const to = `undelivered-${stranger}`;
      mail.delivers = false;
      try {
        const response = await putTo(to, ["edit"]);
        expect(response.status).toBe(502);
        expect((await response.json()).error).toBe("The email could not be sent; try again later.");
      } finally {
        mail.delivers = true;
      }
      expect(sent).toHaveLength(1);
      const rows = await asSystem.query(`select 1 from "invite" where "email" = $1`, [to]);
      expect(rows.rowCount).toBe(0);
    });

    it("refuses text to a language admin, and sends nothing", async () => {
      expect((await putTo(`other-${stranger}`, ["text"])).status).toBe(403);
      expect(sent).toHaveLength(0);
    });

    it("grants directly to an existing account, whatever the case", async () => {
      const response = await putTo(email().toUpperCase(), ["edit"]);
      expect(response.status).toBe(200);
      expect((await response.json()).invited).toBe(false);
      expect(sent).toHaveLength(0);
      expect(await grantsOf(target.id)).toContainEqual({ lang: "deDE", capability: "edit" });
    });

    it("revokes an open invite for an address that has an account, as it grants", async () => {
      const { invite } = await createInvite({
        email: email(),
        lang: "deDE",
        capabilities: ["edit"],
        invitedBy: granter.id,
        limited: false,
      });
      expect((await putTo(email(), ["edit"])).status).toBe(200);
      expect(await openInvite(invite.id)).toBeNull();
      const log = await asSystem.query(
        `select "actorId" from "activity" where "kind" = 'invite.revoked' and "subject" = $1`,
        [invite.id],
      );
      expect(log.rows).toEqual([{ actorId: granter.id }]);
    });

    it("leaves an invite open while the grants do not cover all it names, and revokes it once they do", async () => {
      const { invite } = await createInvite({
        email: email(),
        lang: "deDE",
        capabilities: ["edit", "regenerate"],
        invitedBy: granter.id,
        limited: false,
      });
      expect((await putTo(email(), ["edit"])).status).toBe(200);
      expect(await openInvite(invite.id)).not.toBeNull();
      expect((await putTo(email(), ["regenerate"])).status).toBe(200);
      expect(await openInvite(invite.id)).toBeNull();
    });

    it("refuses what is not an address", async () => {
      expect((await putTo("not an address", ["edit"])).status).toBe(400);
    });
  });
});

describe("/api/grants in a language with a second team", () => {
  const CAPITALS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  const MEMBER = `insert into "team_member" ("teamId", "userId", "lang", "capability") values ($1, $2, $3, $4)`;
  let lang: string;
  let teamA: string;
  let teamB: string;
  let w: Awaited<ReturnType<typeof testUser>>;
  let v: Awaited<ReturnType<typeof testUser>>;
  let fresh: Awaited<ReturnType<typeof testUser>>;

  async function newTeam(name: string, privileged: boolean): Promise<string> {
    const [row] = await systemRows<{ id: string }>(`select new_team($1, $1) as "id"`, [`${name}-${randomUUID().slice(0, 8)}`]);
    await asSystem.query(`insert into "team_language" ("teamId", "lang", "privileged") values ($1, $2, $3)`, [
      row.id, lang, privileged,
    ]);
    forgetTeams();
    return row.id;
  }

  const putFor = (to: string, capabilities: string[]) =>
    PUT(
      new Request("https://example.com/api/grants", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: to, lang, capabilities }),
      }),
    );

  beforeEach(async () => {
    // A code no language has yet, so afterEach never deletes a row it did not make.
    for (;;) {
      const code = `xq${CAPITALS[randomInt(26)]}${CAPITALS[randomInt(26)]}`;
      const made = await asSystem.query(
        `insert into "language" ("code", "name", "native", "bcp47", "provider", "client", "enabled", "textByTeam")
         values ($1, 'Xq', 'Xq', 'xq-XQ', 'xq', false, false, true) on conflict do nothing`,
        [code],
      );
      if (made.rowCount) {
        lang = code;
        break;
      }
    }
    forgetLanguages();
    await loadLanguages();
    w = await testUser("test-grants-route-w");
    v = await testUser("test-grants-route-v");
    fresh = await testUser("test-grants-route-fresh");
    teamA = await newTeam("grants-route-a", true);
    teamB = await newTeam("grants-route-b", false);
    await asSystem.query(MEMBER, [teamB, w.id, lang, "admin"]);
    await asSystem.query(MEMBER, [teamA, v.id, lang, "regenerate"]);
    who.id = w.id;
    who.viewer = { role: null, grants: [{ lang, capability: "admin", privileged: false }] };
  });

  afterEach(async () => {
    who.id = granter.id;
    for (const team of [teamA, teamB]) {
      await asSystem.query(`delete from "activity" where "teamId" = $1`, [team]);
      await dropTeam(team);
    }
    await asSystem.query(`delete from "activity" where "lang" = $1`, [lang]);
    await asSystem.query(`delete from "language" where "code" = $1`, [lang]);
    forgetLanguages();
    forgetTeams();
    for (const user of [w, v, fresh]) await user.cleanup();
  });

  it("lists none of the privileged team's rows to the second team's admin", async () => {
    const response = await GET();
    expect(response.status).toBe(200);
    const { grants } = (await response.json()) as { grants: { userId: string }[] };
    expect(grants.map((grant) => grant.userId)).toEqual([w.id]);
  });

  it("refuses to grant somebody in the other team, with the reason", async () => {
    const response = await putFor(`${v.id}@example.invalid`, ["record"]);
    expect(response.status).toBe(409);
    expect((await response.json()).error).toBe(
      "That person already works on Xq in another team; one person works in one team per language.",
    );
    expect(await systemRows(`select "teamId" from "team_member" where "userId" = $1`, [v.id])).toEqual([
      { teamId: teamA },
    ]);
  });

  it("refuses to remove the other team's row, and leaves it", async () => {
    const params = new URLSearchParams({ userId: v.id, lang, capability: "regenerate" });
    const response = await DELETE(new Request(`https://example.com/api/grants?${params}`, { method: "DELETE" }));
    expect(response.status).toBe(403);
    expect(await systemRows(`select "teamId" from "team_member" where "userId" = $1`, [v.id])).toEqual([
      { teamId: teamA },
    ]);
  });

  it("refuses the second team's admin text, even where the team appoints it", async () => {
    expect((await putFor(`${fresh.id}@example.invalid`, ["text"])).status).toBe(403);
  });

  it("puts a site owner's grant to a second team's member in their own team", async () => {
    who.id = granter.id;
    who.viewer = { role: "admin", grants: [] };
    expect((await putFor(`${w.id}@example.invalid`, ["record"])).status).toBe(200);
    expect(
      await systemRows(`select "teamId", "capability" from "team_member" where "userId" = $1 order by "capability"`, [
        w.id,
      ]),
    ).toEqual([
      { teamId: teamB, capability: "admin" },
      { teamId: teamB, capability: "record" },
    ]);
  });

  it("files a site owner's removal of a second team's row under that team", async () => {
    who.id = granter.id;
    who.viewer = { role: "admin", grants: [] };
    const params = new URLSearchParams({ userId: w.id, lang, capability: "admin" });
    const response = await DELETE(new Request(`https://example.com/api/grants?${params}`, { method: "DELETE" }));
    expect(response.status).toBe(200);
    expect(
      await systemRows(`select "teamId" from "activity" where "kind" = 'grant.removed' and "subject" = $1`, [w.id]),
    ).toEqual([{ teamId: teamB }]);
  });

  it("puts a site owner's grant to somebody new in the privileged team", async () => {
    who.id = granter.id;
    who.viewer = { role: "admin", grants: [] };
    expect((await putFor(`${fresh.id}@example.invalid`, ["edit"])).status).toBe(200);
    expect(await systemRows(`select "teamId" from "team_member" where "userId" = $1`, [fresh.id])).toEqual([
      { teamId: teamA },
    ]);
  });
});
