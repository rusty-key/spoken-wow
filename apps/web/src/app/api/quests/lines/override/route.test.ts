/**
 * The override route against a real Postgres, with only the session and its grants mocked, so the
 * language check is the real requireIn, and the corpus mocked because it changes only through an
 * import.
 *
 * Needs DATABASE_URL and migrations applied.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { closeDb } from "@/lib/db";
import type { CorpusLine } from "@/lib/corpus";
import type { Grant } from "@/lib/permissions";
import { asSystem } from "@/lib/teams/testing";

const viewer = vi.hoisted(() => ({ grants: [] as Grant[] }));
const USER = vi.hoisted(() => `test-override-${Math.random().toString(36).slice(2, 10)}`);
const lines = vi.hoisted(() => new Map<string, Map<string, unknown>>());

vi.mock("@/lib/session", () => ({ currentSession: async () => ({ user: { id: USER, role: null } }) }));
vi.mock("@/lib/grants/store", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/grants/store")>()),
  viewerOf: async () => ({ role: null, grants: viewer.grants }),
}));
vi.mock("@/lib/audio", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/audio")>()),
  fileIndex: async (lang: string) => (lines.get(lang) ?? new Map()) as unknown as Map<string, CorpusLine>,
}));

import { readOverrides } from "@/lib/quests/overrides";

import { DELETE, PUT } from "./route";

const LINE = "q:1999999999:accept";
const FILE = "quests/test-route-override.mp3";
const UNWRITTEN = "quests/test-route-unwritten.mp3";

function put(lang: string, text: string, file = FILE) {
  return PUT(
    new Request(`http://test/api/quests/lines/override?lang=${lang}`, {
      method: "PUT",
      body: JSON.stringify({ file, lineId: LINE, text }),
    }),
  );
}

function remove(lang: string) {
  return DELETE(new Request(`http://test/api/quests/lines/override?lang=${lang}&file=${FILE}`, { method: "DELETE" }));
}

beforeAll(async () => {
  await asSystem.query(
    `insert into "user" ("id", "name", "email", "emailVerified") values ($1, 'Test Override', $2, false)`,
    [USER, `${USER}@example.invalid`],
  );
  const line = (text: string, skipReason: string | null = null) => ({ lineId: LINE, text, skipReason });
  lines.set("enUS", new Map([[FILE, line("Well met.")]]));
  lines.set(
    "deDE",
    new Map([
      [FILE, line("Gut gemacht, $C.")],
      [UNWRITTEN, line("Well met.", "untranslated")],
    ]),
  );
});

beforeEach(() => {
  viewer.grants = [{ lang: "deDE", capability: "regenerate" }];
});

afterEach(async () => {
  await asSystem.query(`delete from "activity" where "subject" = $1`, [FILE]);
  await asSystem.query(`delete from "line_override" where "file" = $1`, [FILE]);
});

afterAll(async () => {
  await asSystem.query(`delete from "user" where "id" = $1`, [USER]);
  await closeDb();
});

describe("/api/quests/lines/override", () => {
  it("lets regenerate in a language override a line there, tokens and all", async () => {
    expect((await put("deDE", "Gut gemacht, $C. *seufzt*")).status).toBe(200);
    expect((await readOverrides("deDE")).get(FILE)?.text).toBe("Gut gemacht, $C. *seufzt*");
    expect((await readOverrides("enUS")).has(FILE)).toBe(false);
  });

  it("refuses text without regenerate, in the language it asked about", async () => {
    viewer.grants = [{ lang: "deDE", capability: "text" }];
    expect((await put("deDE", "Nein.")).status).toBe(403);
    expect((await remove("deDE")).status).toBe(403);

    viewer.grants = [{ lang: "deDE", capability: "regenerate" }];
    expect((await put("enUS", "No.")).status).toBe(403);
    expect((await readOverrides("deDE")).has(FILE)).toBe(false);
  });

  it("refuses a line with no text in the language", async () => {
    expect((await put("deDE", "Hallo.", UNWRITTEN)).status).toBe(409);
  });

  it("removes only that language's", async () => {
    viewer.grants = [
      { lang: "deDE", capability: "regenerate" },
      { lang: "enUS", capability: "regenerate" },
    ];
    await put("deDE", "Auf Deutsch.");
    await put("enUS", "In English.");
    expect((await remove("deDE")).status).toBe(200);
    expect((await readOverrides("deDE")).has(FILE)).toBe(false);
    expect((await readOverrides("enUS")).get(FILE)?.text).toBe("In English.");
  });
});
