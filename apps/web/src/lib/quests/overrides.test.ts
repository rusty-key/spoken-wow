/**
 * Against a real Postgres, for the reason store.test.ts is: what this module has to get right
 * is a memo that notices a delete, and a delete is exactly the change a timestamp cannot see.
 *
 * Needs DATABASE_URL and migrations applied:
 *   docker compose up -d postgres && deploy/bin/migrate.sh "$PWD/web"
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

const { closeDb, db } = await import("@/lib/db");
const { clearOverride, effectiveText, readOverrides, writeOverride } = await import("./overrides");

let file: string;

beforeAll(async () => {
  try {
    await db().query(`select 1 from "line_override" limit 1`);
  } catch (error) {
    throw new Error(
      "overrides.test.ts needs a migrated database. Run:\n" +
        '  docker compose up -d postgres && deploy/bin/migrate.sh "$PWD/web"\n' +
        String(error),
    );
  }
});

afterEach(async () => {
  // The file is made up for this case, so everything logged against it is this case's.
  await db().query(`delete from "activity" where "subject" = $1 and "kind" like 'override.%'`, [file]);
  await db().query(`delete from "line_override" where "file" = $1`, [file]);
});

afterAll(async () => {
  await closeDb();
});

function fresh() {
  file = `quests/${Math.random().toString(16).slice(2, 10)}-accept.mp3`;
}

describe("writeOverride", () => {
  it("is visible to the next read, in the worker that wrote it", async () => {
    fresh();
    await readOverrides(); // warm the memo, so a stale one would be served
    await writeOverride(file, "q:1155:accept", "A crystal fragment.", null);

    expect((await readOverrides()).get(file)?.text).toBe("A crystal fragment.");
  });

  it("replaces rather than accumulates - one file says one thing", async () => {
    fresh();
    await writeOverride(file, "q:1155:accept", "first", null);
    await writeOverride(file, "q:1155:accept", "second", null);

    const stored = await readOverrides();
    expect(stored.get(file)?.text).toBe("second");
    const { rows } = await db().query(`select 1 from "line_override" where "file" = $1`, [file]);
    expect(rows).toHaveLength(1);
  });
});

describe("clearOverride", () => {
  it("is noticed by a warm memo, which max(updatedAt) alone would not be", async () => {
    fresh();
    await writeOverride(file, "q:1155:accept", "A crystal fragment.", null);
    await readOverrides();

    expect(await clearOverride(file, null)).toBe(true);
    expect((await readOverrides()).get(file)).toBeUndefined();
  });

  it("reports that there was nothing to clear", async () => {
    fresh();
    expect(await clearOverride(file, null)).toBe(false);
  });
});

describe("effectiveText", () => {
  it("prefers the rewrite and falls back to what the corpus says", () => {
    const line = { text: "x" };
    const overrides = new Map([
      ["quests/1155-accept.mp3", { file: "", lineId: "", text: "A crystal fragment.", updatedAt: "", updatedBy: null }],
    ]);

    expect(effectiveText(line, "quests/1155-accept.mp3", overrides)).toBe("A crystal fragment.");
    expect(effectiveText(line, "quests/33-accept.mp3", overrides)).toBe("x");
  });
});
