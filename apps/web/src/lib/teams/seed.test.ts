/**
 * The teams migration seeds one team per maintainer group. These assert what must hold of
 * whatever database it ran against, rather than inserting users: other suites share it.
 *
 * Needs DATABASE_URL and migrations applied.
 */
import { afterAll, describe, expect, it } from "vitest";

import { closeDb, db } from "@/lib/db";

afterAll(closeDb);

const LANGS = `
  select "code" as "lang" from "language"
  union select "lang" from "take"
  union select 'enUS'`;

describe("seeded teams", () => {
  it("gives every language exactly one privileged team", async () => {
    const { rows } = await db().query(
      `select l."lang", count(tl."teamId")::int as "n"
         from (${LANGS}) l
         left join "team_language" tl on tl."lang" = l."lang" and tl."privileged"
        group by l."lang"`,
    );
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) expect({ lang: r.lang, n: r.n }).toEqual({ lang: r.lang, n: 1 });
  });

  it("puts enUS on the english team", async () => {
    const { rows } = await db().query(
      `select t."slug", t."name" from "team" t
         join "team_language" tl on tl."teamId" = t."id"
        where tl."lang" = 'enUS'`,
    );
    expect(rows).toEqual([{ slug: "english", name: "English" }]);
  });

  it("shares a team only between languages with equal, non-empty maintainer sets", async () => {
    const { rows: teams } = await db().query(
      `select tl."teamId", t."slug", array_agg(tl."lang" order by tl."lang") as "langs"
         from "team_language" tl join "team" t on t."id" = tl."teamId"
        group by tl."teamId", t."slug"`,
    );
    const { rows: grants } = await db().query(
      `select "lang", array_agg(distinct "userId" order by "userId") as "key"
         from "language_grant"
        where "capability" in ('edit', 'regenerate', 'configure', 'ignore', 'admin')
        group by "lang"`,
    );
    const key = new Map<string, string>(grants.map((g) => [g.lang, JSON.stringify(g.key)]));
    for (const t of teams) {
      const langs: string[] = t.langs;
      if (t.slug === "english") continue;
      const keys = new Set(langs.map((l) => key.get(l) ?? "[]"));
      expect(keys.size).toBe(1);
      expect([...keys][0]).not.toBe("[]");
      expect(t.slug).toBe(langs.map((l) => l.toLowerCase()).join("-"));
    }
    // A language with maintainers never falls into the english team unless it is English.
    const english: string[] = teams.find((t) => t.slug === "english")?.langs ?? [];
    for (const lang of english) {
      if (lang !== "enUS") expect(key.get(lang) ?? "[]").toBe("[]");
    }
  });
});
