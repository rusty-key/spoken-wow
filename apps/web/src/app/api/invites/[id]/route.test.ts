/**
 * Session and grants mocked, writes real.
 *
 * Needs DATABASE_URL and migrations applied.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { closeDb } from "@/lib/db";
import { createInvite, lookupInvite } from "@/lib/invites/store";
import type { Viewer } from "@/lib/permissions";
import { asSystem, testUser } from "@/lib/teams/testing";

const who = vi.hoisted(() => ({ viewer: { role: null, grants: [] } as Viewer, id: "" }));
const sent = vi.hoisted(() => [] as { to: string; args: { url: string } }[]);

vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("@/lib/auth", () => ({
  auth: { api: { getSession: async () => ({ user: { id: who.id, role: who.viewer.role } }) } },
}));
vi.mock("@/lib/email", () => ({
  sendInviteEmail: (to: string, args: { url: string }) => sent.push({ to, args }),
  sendEmail: () => {},
  sendPasswordResetEmail: () => {},
}));
vi.mock("@/lib/grants/store", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/grants/store")>()),
  viewerOf: async () => who.viewer,
}));

import { DELETE } from "./route";
import { POST } from "./resend/route";

let inviter: Awaited<ReturnType<typeof testUser>>;
let id = "";
let firstToken = "";

const DE_ADMIN: Viewer = { role: null, grants: [{ lang: "deDE", capability: "admin" }] };
const FR_ADMIN: Viewer = { role: null, grants: [{ lang: "frFR", capability: "admin" }] };
const params = () => ({ params: Promise.resolve({ id }) });
const resend = () => POST(new Request("https://example.com/x", { method: "POST" }), params());
const revoke = () => DELETE(new Request("https://example.com/x", { method: "DELETE" }), params());

beforeAll(async () => {
  inviter = await testUser("test-invites-route");
  who.id = inviter.id;
  const made = await createInvite({
    email: `route-${inviter.id}@example.com`,
    lang: "deDE",
    capabilities: ["edit"],
    invitedBy: inviter.id,
    limited: false,
  });
  id = made.invite.id;
  firstToken = made.token;
  // Sent long enough ago for the resend gap.
  await asSystem.query(`update "invite" set "sentAt" = now() - interval '1 hour' where "id" = $1`, [id]);
});

beforeEach(() => {
  sent.length = 0;
  who.viewer = DE_ADMIN;
});

afterAll(async () => {
  await asSystem.query(`delete from "activity" where "actorId" = $1`, [inviter.id]);
  await inviter.cleanup();
  await closeDb();
});

describe("/api/invites/[id]", () => {
  it("refuses another language's admin", async () => {
    who.viewer = FR_ADMIN;
    expect((await resend()).status).toBe(403);
    expect((await revoke()).status).toBe(403);
  });

  it("resends with a new link, and the old one stops working", async () => {
    // A site admin is not rate limited; a language admin is, below.
    expect((await resend()).status).toBe(200);
    expect(sent).toHaveLength(1);
    expect(sent[0].args.url).not.toContain(firstToken);
    expect(await lookupInvite(firstToken)).toBeNull();
    expect(await lookupInvite(sent[0].args.url.split("token=")[1])).toMatchObject({ state: "pending" });
    expect((await resend()).status).toBe(429);
    expect(sent).toHaveLength(1);
  });

  it("revokes once, then answers 404", async () => {
    const response = await revoke();
    expect(response.status).toBe(200);
    expect((await response.json()).invites.map((row: { id: string }) => row.id)).not.toContain(id);
    expect((await revoke()).status).toBe(404);
    expect((await resend()).status).toBe(404);
  });
});
