/**
 * Session and grants mocked, writes real.
 *
 * Needs DATABASE_URL and migrations applied.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { closeDb } from "@/lib/db";
import { forgetLanguages, loadLanguages } from "@/lib/languages/catalogue";
import type { Viewer } from "@/lib/permissions";
import { asSystem, testUser } from "@/lib/teams/testing";

const who = vi.hoisted(() => ({ viewer: { role: null, grants: [] } as Viewer, id: "" }));

vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("@/lib/auth", () => ({
  auth: { api: { getSession: async () => ({ user: { id: who.id, role: who.viewer.role } }) } },
}));
const sent = vi.hoisted(() => [] as { to: string; args: { url: string; capabilities: string[] } }[]);
vi.mock("@/lib/email", () => ({
  sendInviteEmail: (to: string, args: { url: string; capabilities: string[] }) => sent.push({ to, args }),
  sendEmail: () => {},
  sendPasswordResetEmail: () => {},
}));
vi.mock("@/lib/grants/store", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/grants/store")>()),
  viewerOf: async () => who.viewer,
}));

import { grantsOf } from "@/lib/grants/store";
import { lookupInvite } from "@/lib/invites/store";

import { DELETE, PUT } from "./route";

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

    it("refuses what is not an address", async () => {
      expect((await putTo("not an address", ["edit"])).status).toBe(400);
    });
  });
});
