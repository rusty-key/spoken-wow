/**
 * Needs DATABASE_URL and migrations applied.
 */
import { afterAll, beforeAll, expect, test } from "vitest";

import { closeDb } from "@/lib/db";
import { createInvite } from "@/lib/invites/store";
import { asSystem, testUser } from "@/lib/teams/testing";

import { GET } from "./route";

let inviter: Awaited<ReturnType<typeof testUser>>;
let token = "";

beforeAll(async () => {
  inviter = await testUser("test-invite-open");
  ({ token } = await createInvite({
    email: `${inviter.id}@example.com`,
    lang: "deDE",
    capabilities: ["edit"],
    invitedBy: inviter.id,
    limited: false,
  }));
});

afterAll(async () => {
  await asSystem.query(`delete from "activity" where "actorId" = $1`, [inviter.id]);
  await inviter.cleanup();
  await closeDb();
});

test("keeps the token in a cookie and redirects without it", async () => {
  const response = await GET(new Request(`https://example.com/api/invites/open?token=${token}`));
  expect(response.status).toBe(303);
  const location = response.headers.get("location")!;
  expect(location).toBe("/deDE/invite");
  expect(location).not.toContain(token);
  const cookie = response.headers.get("set-cookie")!;
  expect(cookie).toContain(`spoken_invite=${token}`);
  expect(cookie).toMatch(/HttpOnly/);
  expect(cookie).toMatch(/SameSite=Lax/);
  expect(cookie).toMatch(/Max-Age=3600/);
});

test("without a token it sets nothing", async () => {
  const response = await GET(new Request("https://example.com/api/invites/open"));
  expect(response.status).toBe(303);
  expect(response.headers.get("set-cookie")).toBeNull();
});
