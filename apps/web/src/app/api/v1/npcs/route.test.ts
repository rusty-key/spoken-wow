/**
 * NPCs over the text API, with real tokens and only grants mocked.
 *
 * Needs DATABASE_URL and migrations applied.
 */
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { Grant } from "@/lib/permissions";

const viewer = vi.hoisted(() => ({ grants: [] as Grant[] }));

vi.mock("@/lib/grants/store", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/grants/store")>()),
  viewerOf: async (session: { user: { role?: string | null } }) => ({ role: session.user.role, grants: viewer.grants }),
}));

import { closeDb } from "@/lib/db";
import type { Lang } from "@/lib/lang";
import { directionsIn, setDirection, upsertResolution } from "@/lib/npc/store";
import type { NpcItem } from "@/lib/text-api/npcs";
import { LANG } from "@/lib/text-api/testing";
import { asSystem, testUser } from "@/lib/teams/testing";
import { createToken } from "@/lib/tokens/store";

import { GET as getOne, PATCH } from "./[id]/route";
import { GET } from "./route";

const BASE = "https://example.com/api/v1/npcs";
// Above any real creature id, so the list's tail is ours alone.
const first = 2_000_000_000 + Math.floor(Math.random() * 100_000_000);
const ids = [first, first + 1, first + 2];
const key = `creature:${first}`;

let user: string;

async function token(access: "read" | "write" = "write", lang: Lang = LANG) {
  return (await createToken({ userId: user, lang, access, generate: false, label: "agent", expiresAt: new Date(Date.now() + 86_400_000) }))
    .token;
}

const init = (auth: string, method = "GET", body?: unknown) => ({
  method,
  headers: { authorization: `Bearer ${auth}`, "content-type": "application/json" },
  ...(body === undefined ? {} : { body: JSON.stringify(body) }),
});
const params = (id: string) => ({ params: Promise.resolve({ id: encodeURIComponent(id) }) });
const list = async (auth: string, query = "") => GET(new Request(`${BASE}${query}`, init(auth)));
const patch = (auth: string, id: string, body: unknown) =>
  PATCH(new Request(`${BASE}/${encodeURIComponent(id)}`, init(auth, "PATCH", body)), params(id));

async function clear() {
  await asSystem.query(`delete from "npc_direction_locale" where "npcId" = any($1::int[])`, [ids]);
  await asSystem.query(`delete from "npc" where "npcId" = any($1::int[])`, [ids]);
}

beforeEach(async () => {
  const created = await testUser("test-npcs-api");
  user = created.id;
  viewer.grants = [
    { lang: LANG, capability: "text" },
    { lang: LANG, capability: "configure" },
    { lang: "enUS", capability: "text" },
    { lang: "enUS", capability: "configure" },
  ];
  await clear();
  for (const npcId of ids) {
    await upsertResolution({
      npcKind: "creature", npcId, npcName: null, race: "dwarf", gender: "male", flavor: "standard",
      provenance: "corpus", confirmed: true, doubtful: false, modelFileId: null, sex: null,
      creatureType: null, build: null, note: null, resolvedBy: null,
    });
  }
  await setDirection("creature", first, "[gruff]");
  return async () => {
    await clear();
    await asSystem.query(`delete from "activity" where "actorId" = $1`, [user]);
    await created.cleanup();
  };
});

afterAll(closeDb);

describe("GET /api/v1/npcs", () => {
  it("pages after a cursor", async () => {
    const auth = await token("read");
    const page = (await (await list(auth, `?cursor=creature:${first - 1}&limit=2`)).json()) as {
      items: NpcItem[];
      nextCursor: string;
    };
    expect(page.items.map((item) => item.id)).toEqual([key, `creature:${first + 1}`]);
    expect(page.items[0]).toMatchObject({ race: "dwarf", direction: "[gruff]", languageDirection: null });
    expect(page.nextCursor).toBe(`creature:${first + 1}`);

    const next = (await (await list(auth, `?cursor=${page.nextCursor}`)).json()) as { items: NpcItem[]; nextCursor: null };
    expect(next.items.map((item) => item.id)).toEqual([`creature:${first + 2}`]);
    expect(next.nextCursor).toBeNull();
  });

  it("keeps only directed NPCs when asked", async () => {
    const auth = await token();
    await patch(auth, `creature:${first + 2}`, { direction: "hushed" });
    const { items } = (await (await list(auth, `?directed=true&cursor=creature:${first - 1}`)).json()) as { items: NpcItem[] };
    expect(items.map((item) => item.id)).toEqual([key, `creature:${first + 2}`]);
  });

  it("refuses without configure, and an unknown parameter", async () => {
    expect((await list(await token("read"), "?lang=deDE")).status).toBe(400);
    viewer.grants = [{ lang: LANG, capability: "text" }];
    expect((await list(await token("read"))).status).toBe(403);
  });
});

describe("/api/v1/npcs/{id}", () => {
  it("sets the language's direction over the global one, and clears it", async () => {
    const auth = await token();
    const response = await patch(auth, key, { direction: "weary" });
    expect(response.status).toBe(200);
    expect(((await response.json()) as { npc: NpcItem }).npc).toMatchObject({ direction: "[gruff]", languageDirection: "[weary]" });
    expect((await directionsIn(LANG)).get(key)).toBe("[weary]");

    expect((await patch(auth, key, { direction: null })).status).toBe(200);
    expect((await directionsIn(LANG)).get(key)).toBe("[gruff]");
    const read = await getOne(new Request(`${BASE}/${key}`, init(auth)), params(key));
    expect(((await read.json()) as { npc: NpcItem }).npc.languageDirection).toBeNull();
  });

  it("404 for an NPC not on file, 400 for a bad direction", async () => {
    const auth = await token();
    expect((await patch(auth, "creature:1999999999", { direction: "x" })).status).toBe(404);
    expect((await patch(auth, "dragon:1", { direction: "x" })).status).toBe(404);
    expect((await patch(auth, key, { direction: "<x>" })).status).toBe(400);
    expect((await patch(auth, key, {})).status).toBe(400);
  });

  it("refuses English, whose direction is the global one", async () => {
    const response = await patch(await token("write", "enUS"), key, { direction: "weary" });
    expect(response.status).toBe(400);
    expect((await directionsIn("enUS")).get(key)).toBe("[gruff]");
  });

  it("refuses a read-only token", async () => {
    expect((await patch(await token("read"), key, { direction: "weary" })).status).toBe(403);
  });
});
