/**
 * The community pack tables against a real Postgres: the seed that replaces community/packs.json,
 * and the constraints the store relies on (one pending submission per pack, a closed status set).
 *
 * Needs DATABASE_URL and migrations applied.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import { closeDb } from "@/lib/db";
import { asSystem } from "@/lib/teams/testing";

afterAll(async () => {
  await asSystem.query(`delete from "community_pack" where "id" like 'test-schema-%'`);
  await closeDb();
});

type Seed = Record<string, string | number | null | undefined>;

const packs: Seed[] = JSON.parse(readFileSync(resolve(__dirname, "../../../../../community/packs.json"), "utf8")).packs;

const EXPECTED_SECTION_AND_VERSION = {
  polski: { lang: "plPL", version: "0.3.0" },
  ivrit: { lang: "heIL", version: "0.6.3" },
} as const;

describe("seeded packs", () => {
  for (const [id, expected] of Object.entries(EXPECTED_SECTION_AND_VERSION)) {
    it(`${id} is approved, unowned and equal to packs.json`, async () => {
      const file = packs.find((p) => p.id === id)!;
      const { rows } = await asSystem.query(
        `select p.*, s."title", s."author", s."description", s."version", s."size", s."sha256", s."url",
                s."homepage", s."license", s."status", s."submittedAt", s."reviewedAt"
           from "community_pack" p join "community_pack_submission" s on s."packId" = p."id"
          where p."id" = $1`,
        [id],
      );
      expect(rows).toHaveLength(1);
      const row = rows[0];
      expect(row.ownerId).toBeNull();
      expect(row.section).toBe("quests");
      expect(row.lang).toBe(expected.lang);
      expect(row.version).toBe(expected.version);
      expect(row.status).toBe("approved");
      for (const field of ["title", "author", "description", "version", "sha256", "url", "homepage", "license", "lang", "section"]) {
        expect(row[field], field).toBe(file[field]);
      }
      // bigint comes back as a string from pg.
      expect(Number(row.size)).toBe(file.size);
      const day = (d: Date) => d.toISOString().slice(0, 10);
      expect(day(row.submittedAt)).toBe(file.addedAt);
      expect(day(row.reviewedAt)).toBe(file.addedAt);
    });
  }
});

describe("constraints", () => {
  const insertSubmission = (packId: string, status: string) =>
    asSystem.query(
      `insert into "community_pack_submission"
         ("packId", "title", "author", "description", "version", "size", "sha256", "url", "status")
       values ($1, 't', 'a', 'd', '1.0', 1, $2, 'https://example.invalid/x.zip', $3)`,
      [packId, "0".repeat(64), status],
    );

  it("allows one pending submission per pack but not two", async () => {
    const id = "test-schema-pending";
    await asSystem.query(`insert into "community_pack" ("id", "lang", "section") values ($1, 'deDE', 'quests')`, [id]);
    await insertSubmission(id, "pending");
    await insertSubmission(id, "rejected");
    await expect(insertSubmission(id, "pending")).rejects.toMatchObject({ code: "23505" });
  });

  it("refuses a status outside the four", async () => {
    const id = "test-schema-status";
    await asSystem.query(`insert into "community_pack" ("id", "lang", "section") values ($1, 'deDE', 'quests')`, [id]);
    await expect(insertSubmission(id, "bogus")).rejects.toMatchObject({ code: "23514" });
  });
});
