/**
 * The language table carries what a language is, seeded from the list that used to live only in
 * code (pipelines/lib/locales.mjs).
 *
 * Needs DATABASE_URL and migrations applied.
 */
import { LOCALES } from "@tools/lib/locales.mjs";
import { afterAll, describe, expect, it } from "vitest";

import { closeDb, query } from "@/lib/db";

afterAll(closeDb);

describe("language table seed", () => {
  it.each(LOCALES)("describes $code", async (l) => {
    const rows = await query(
      `select "name", "native", "bcp47", "provider", "client" from "language" where "code" = $1`,
      [l.code],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      name: l.name,
      bcp47: l.bcp47,
      provider: l.elevenLabs,
      client: l.client !== false,
    });
    expect(rows[0].native).not.toBe("");
  });
});
