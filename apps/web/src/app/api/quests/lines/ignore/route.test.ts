/**
 * Which line ids an ignore accepts. Against a real Postgres, since the whitelist is the
 * quest tables; the ignore itself is mocked, so nothing here writes line_ignore.
 *
 * Needs DATABASE_URL and migrations applied.
 */
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/lib/db";

vi.mock("@/lib/generation/authz", () => ({
  requireConfigure: async () => ({ session: { user: { id: "test-ignore-route" } }, denied: null }),
  requireIn: async (request: Request) => ({
    lang: new URL(request.url).searchParams.get("lang") || "enUS",
    session: { user: { id: "test-ignore-route" } },
    denied: null,
  }),
}));
vi.mock("@/lib/quests/ignores", () => ({
  writeIgnore: async (lineId: string, reason: string) => ({ lineId, reason }),
  clearIgnore: async () => true,
}));

import { DELETE, PUT } from "./route";

// A language nothing else in the suite writes, and an id no corpus has.
const LANG = "koKR";
const NATIVE = `q:0:ignore-route-${Math.random().toString(36).slice(2, 8)}`;

afterEach(async () => {
  await db().query(`delete from "quest_line" where "lineId" = $1`, [NATIVE]);
});

afterAll(closeDb);

/** A line only LANG has, as a native accept writes one. */
async function nativeLine(): Promise<void> {
  await db().query(
    `insert into "quest_line"
       ("lineId", "variant", "lang", "version", "isCurrent", "origin", "source", "questId",
        "fileName", "text", "originalText", "localeText", "generatable")
     values ($1, 0, $2, 1, true, 'contributed', 'accept', 0, '0-accept', '안녕.', '안녕.', '안녕.', true)`,
    [NATIVE, LANG],
  );
}

function put(lineId: string): Request {
  return new Request("https://example.com/api/quests/lines/ignore?scope=all", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ lineId, reason: "test" }),
  });
}

function del(lineId: string): Request {
  return new Request(
    `https://example.com/api/quests/lines/ignore?scope=all&lineId=${encodeURIComponent(lineId)}`,
    { method: "DELETE" },
  );
}

describe("an ignore everywhere (scope=all)", () => {
  it("takes a line only one language has", async () => {
    await nativeLine();
    expect((await PUT(put(NATIVE))).status).toBe(200);
    expect((await DELETE(del(NATIVE))).status).toBe(200);
  });

  it("still refuses an id no language has", async () => {
    expect((await PUT(put(NATIVE))).status).toBe(404);
  });
});
