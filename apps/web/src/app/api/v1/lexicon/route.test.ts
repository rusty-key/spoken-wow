/**
 * The lexicon over the text API, with real tokens and only grants mocked. The token owner has no
 * ElevenLabs key, so nothing here reaches ElevenLabs: every write lands as pending.
 *
 * Needs DATABASE_URL and migrations applied.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { Grant } from "@/lib/permissions";

const viewer = vi.hoisted(() => ({ grants: [] as Grant[] }));

vi.mock("@/lib/grants/store", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/grants/store")>()),
  viewerOf: async (session: { user: { role?: string | null } }) => ({
    role: session.user.role,
    grants: viewer.grants,
  }),
}));

import { closeDb } from "@/lib/db";
import { NO_KEY_TO_SYNC } from "@/lib/generation/dictionary";
import { asSystem, testUser } from "@/lib/teams/testing";
import { createToken } from "@/lib/tokens/store";

import { GET as one, PATCH as patchOne } from "./[grapheme]/route";
import { GET, PATCH } from "./route";

const LANG = "koKR";
const BASE = "https://example.com/api/v1/lexicon";

const A = { grapheme: "Gnomeregan", ipa: "ˈnoʊmɹəɡæn", confidence: "high" };
const B = { grapheme: "Thrall", alias: "thrawl", confidence: "check" };

let user: string;
let removeUser: () => Promise<void>;

async function token(access: "read" | "write" = "write") {
  return (await createToken({ userId: user, lang: LANG, access, label: "agent", expiresAt: new Date(Date.now() + 86_400_000) }))
    .token;
}

const init = (auth: string, method = "GET", body?: unknown) => ({
  method,
  headers: { authorization: `Bearer ${auth}`, "content-type": "application/json" },
  ...(body === undefined ? {} : { body: JSON.stringify(body) }),
});

const list = (auth: string) => GET(new Request(BASE, init(auth)));
const patch = (auth: string, body: unknown) => PATCH(new Request(BASE, init(auth, "PATCH", body)));
const params = (grapheme: string) => ({ params: Promise.resolve({ grapheme: encodeURIComponent(grapheme) }) });
const getOne = (auth: string, grapheme: string) =>
  one(new Request(`${BASE}/${encodeURIComponent(grapheme)}`, init(auth)), params(grapheme));
const patchEntry = (auth: string, grapheme: string, body: unknown) =>
  patchOne(new Request(`${BASE}/${encodeURIComponent(grapheme)}`, init(auth, "PATCH", body)), params(grapheme));

async function clear() {
  await asSystem.query(`delete from "pronunciation_lexicon_locale" where "lang" = $1`, [LANG]);
  await asSystem.query(`delete from "lexicon_change" where "changedBy" = $1`, [user]);
}

beforeEach(async () => {
  ({ id: user, cleanup: removeUser } = await testUser("test-lexicon-api"));
  viewer.grants = [
    { lang: LANG, capability: "text" },
    { lang: LANG, capability: "configure" },
  ];
  await clear();
  return async () => {
    await clear();
    await removeUser();
  };
});

// koKR's real lexicon, if this database has one, is put back afterwards.
let saved: Record<string, unknown> | undefined;

beforeAll(async () => {
  const { rows } = await asSystem.query(`select * from "pronunciation_lexicon_locale" where "lang" = $1`, [LANG]);
  saved = rows[0];
});

afterAll(async () => {
  if (saved) {
    const row = saved;
    const columns = Object.keys(row);
    await asSystem.query(
      `insert into "pronunciation_lexicon_locale" (${columns.map((c) => `"${c}"`).join(", ")})
       values (${columns.map((_, i) => `$${i + 1}`).join(", ")})`,
      columns.map((c) => (c === "entries" ? JSON.stringify(row[c]) : row[c])),
    );
  }
  await closeDb();
});

describe("GET /api/v1/lexicon", () => {
  it("401 with no token", async () => {
    expect((await GET(new Request(BASE))).status).toBe(401);
  });

  it("reads an empty lexicon with any token", async () => {
    viewer.grants = [{ lang: LANG, capability: "text" }];
    const response = await list(await token("read"));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ lang: LANG, entries: [], version: null, sync: "never" });
  });

  it("refuses an unknown parameter", async () => {
    const response = await GET(new Request(`${BASE}?lang=deDE`, init(await token())));
    expect(response.status).toBe(400);
  });
});

describe("PATCH /api/v1/lexicon", () => {
  it("adds, then replaces and keeps the rest", async () => {
    const auth = await token();
    const first = await patch(auth, { items: [A, B] });
    expect(first.status).toBe(200);
    const body = (await first.json()) as { results: { status: string }[]; sync: string; syncError: string };
    expect(body.results.map((r) => r.status)).toEqual(["created", "created"]);
    expect(body.sync).toBe("never");
    expect(body.syncError).toBe(NO_KEY_TO_SYNC);

    const changed = { ...B, alias: "thraal" };
    const second = (await (await patch(auth, { items: [changed] })).json()) as { results: { status: string }[] };
    expect(second.results[0].status).toBe("updated");

    const read = (await (await list(auth)).json()) as { entries: unknown[] };
    expect(read.entries).toEqual([A, changed]);
  });

  it("logs the change as the token's owner", async () => {
    await patch(await token(), { items: [A] });
    const { rows } = await asSystem.query(`select "grapheme", "kind" from "lexicon_change" where "changedBy" = $1`, [user]);
    expect(rows).toEqual([{ grapheme: "Gnomeregan", kind: "added" }]);
  });

  it("refuses the whole request over one bad item", async () => {
    const auth = await token();
    const response = await patch(auth, { items: [A, { grapheme: "Thrall", confidence: "high" }] });
    expect(response.status).toBe(400);
    expect(((await response.json()) as { error: string }).error).toMatch(/entry 1/);
    expect(((await (await list(auth)).json()) as { entries: unknown[] }).entries).toEqual([]);
  });

  it("409 when expectedVersion is stale", async () => {
    const auth = await token();
    await patch(auth, { items: [A] });
    const { version } = (await (await list(auth)).json()) as { version: string };
    await patch(auth, { items: [B] });

    const response = await patch(auth, { items: [{ ...A, confidence: "check" }], expectedVersion: version });
    expect(response.status).toBe(409);

    const current = ((await response.json()) as { version: string }).version;
    expect((await patch(auth, { items: [{ ...A, confidence: "check" }], expectedVersion: current })).status).toBe(200);
  });

  it("needs configure, as the site does", async () => {
    viewer.grants = [{ lang: LANG, capability: "text" }];
    expect((await patch(await token(), { items: [A] })).status).toBe(403);
  });

  it("needs a write token", async () => {
    expect((await patch(await token("read"), { items: [A] })).status).toBe(403);
  });
});

describe("/api/v1/lexicon/{grapheme}", () => {
  it("writes one entry from the URL and reads it back ignoring case", async () => {
    const auth = await token();
    const response = await patchEntry(auth, "Gnomeregan", { ipa: A.ipa, confidence: "high" });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ entry: A, status: "created" });

    expect(await (await getOne(auth, "gnomeregan")).json()).toMatchObject({ entry: A });
    expect((await getOne(auth, "Orgrimmar")).status).toBe(404);
  });

  it("writes nothing when nothing changed", async () => {
    const auth = await token();
    await patchEntry(auth, "Gnomeregan", A);
    const { version } = (await (await list(auth)).json()) as { version: string };

    const again = (await (await patchEntry(auth, "Gnomeregan", A)).json()) as { status: string; version: string };
    expect(again).toMatchObject({ status: "unchanged", version });
  });

  it("refuses a different grapheme in the body", async () => {
    expect((await patchEntry(await token(), "Gnomeregan", B)).status).toBe(400);
  });

  it("refuses an entry with both ipa and alias", async () => {
    const response = await patchEntry(await token(), "Gnomeregan", { ipa: "x", alias: "y", confidence: "high" });
    expect(response.status).toBe(400);
  });
});
