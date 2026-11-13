/**
 * The public registry route against a real Postgres. Needs DATABASE_URL and migrations through 0106.
 *
 * The Manager's own validateRegistry cannot be imported here (it pulls in Electron state), so the
 * entries are held to the same rules through validateNewPack.
 */
import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { validateNewPack } from "@/lib/community/rules";
import { createPack, decide } from "@/lib/community/store";
import { closeDb } from "@/lib/db";
import { asSystem, testUser } from "@/lib/teams/testing";

import { GET } from "./route";

const ID = `test-route-${randomUUID().slice(0, 6)}`;
let author: Awaited<ReturnType<typeof testUser>>;
let admin: Awaited<ReturnType<typeof testUser>>;
let info: ReturnType<typeof vi.spyOn>;

beforeAll(async () => {
  delete process.env.RESEND_API_KEY;
  delete process.env.RESEND_FROM;
  info = vi.spyOn(console, "info").mockImplementation(() => {});
  author = await testUser("test-route-author");
  admin = await testUser("test-route-admin");
  await asSystem.query(`update "user" set "role" = 'pack_author' where "id" = $1`, [author.id]);
  await asSystem.query(`update "user" set "role" = 'admin' where "id" = $1`, [admin.id]);
  const pack = await createPack(author.id, {
    id: ID,
    lang: "plPL",
    section: "quests",
    title: "Polski",
    author: "Somebody",
    description: "A pack for tests.",
    version: "1.0.0",
    size: 1234,
    sha256: "a".repeat(64),
    url: "https://github.com/someone/polski/releases/download/v1.0.0/polski.zip",
  });
  await decide(admin.id, pack.pending!.id, "approve");
});

afterAll(async () => {
  info.mockRestore();
  await asSystem.query(`delete from "activity" where "kind" like 'pack.%' and "subject" = $1`, [ID]);
  await asSystem.query(`delete from "community_pack" where "id" = $1`, [ID]);
  await author?.cleanup();
  await admin?.cleanup();
  await closeDb();
});

const get = (headers?: HeadersInit) => GET(new Request("http://localhost/api/community/packs", { headers }));

describe("GET /api/community/packs", () => {
  it("lists the approved packs, cacheable for five minutes", async () => {
    const response = await get();
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("public, max-age=300");
    expect(response.headers.get("ETag")).toMatch(/^"[0-9a-f]{32}"$/);
    const { packs } = await response.json();
    expect(packs.map((p: { id: string }) => p.id)).toContain(ID);
  });

  it("answers a repeat request with the ETag as 304 and no body", async () => {
    const etag = (await get()).headers.get("ETag")!;
    const response = await get({ "If-None-Match": etag });
    expect(response.status).toBe(304);
    expect(await response.text()).toBe("");
  });

  it("treats a weakened tag, a list of tags and * as matching too", async () => {
    const etag = (await get()).headers.get("ETag")!;
    for (const header of [`W/${etag}`, `"other", ${etag}`, `W/"other", W/${etag}`, "*"]) {
      expect((await get({ "If-None-Match": header })).status, header).toBe(304);
    }
    expect((await get({ "If-None-Match": '"other"' })).status).toBe(200);
  });

  it("gives every entry the shape the Manager validates", async () => {
    const { packs } = await (await get()).json();
    for (const entry of packs) {
      expect(validateNewPack(entry), entry.id).toMatchObject({ ok: true });
      expect(entry.addedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });
});
