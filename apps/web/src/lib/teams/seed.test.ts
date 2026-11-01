/**
 * The teams migration seeds one team per maintainer group. These assert what must hold of
 * whatever database it ran against, rather than inserting users: other suites share it.
 *
 * Needs DATABASE_URL and migrations applied.
 */
import { afterAll, describe, expect, it } from "vitest";

import { closeDb, db } from "@/lib/db";
import { asSystem } from "@/lib/teams/testing";

afterAll(closeDb);

/** Every language some per-team row names, as 0087 gathers them. */
const LANGS = `
  select "lang" from (
    select "code" as "lang" from "language"
    union select 'enUS'
    union select "lang" from "take" union select "lang" from "recording"
    union select "lang" from "take_ack" union select "lang" from "voice_clone"
    union select "lang" from "fish_reference" union select "lang" from "generation_setting_locale"
    union select "lang" from "pronunciation_lexicon_locale" union select "lang" from "lexicon_change"
    union select "lang" from "line_ignore" union select "lang" from "line_flag"
    union select "lang" from "line_issue" union select "lang" from "report"
    union select "lang" from "regeneration_batch" union select "lang" from "regeneration_job"
    union select "lang" from "regeneration_pause" union select "lang" from "activity"
    union select nullif(split_part("clone", '@', 2), '') from "voice_sample"
  ) l
   where "lang" is not null`;

describe("seeded teams", () => {
  it("gives every language exactly one privileged team", async () => {
    const { rows } = await asSystem.query(
      `select l."lang", count(tl."teamId")::int as "n"
         from (${LANGS}) l
         left join "team_language" tl on tl."lang" = l."lang" and tl."privileged"
        group by l."lang"`,
    );
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) expect({ lang: r.lang, n: r.n }).toEqual({ lang: r.lang, n: 1 });
  });

  it("puts enUS on the english team", async () => {
    const { rows } = await asSystem.query(
      `select t."slug", t."name" from "team" t
         join "team_language" tl on tl."teamId" = t."id"
        where tl."lang" = 'enUS'`,
    );
    expect(rows).toEqual([{ slug: "english", name: "English" }]);
  });

  it("shares a team only between languages with equal, non-empty maintainer sets", async () => {
    const { rows: teams } = await asSystem.query(
      `select tl."teamId", t."slug", array_agg(tl."lang" order by tl."lang") as "langs"
         from "team_language" tl join "team" t on t."id" = tl."teamId"
        group by tl."teamId", t."slug"`,
    );
    const { rows: grants } = await asSystem.query(
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
      // Since 0091 a language nobody maintains is a team of its own.
      if (langs.length > 1) expect([...keys][0]).not.toBe("[]");
      expect(t.slug).toBe(langs.map((l) => l.toLowerCase()).join("-"));
    }
    // A language with maintainers never falls into the english team unless it is English.
    const english: string[] = teams.find((t) => t.slug === "english")?.langs ?? [];
    for (const lang of english) {
      if (lang !== "enUS") expect(key.get(lang) ?? "[]").toBe("[]");
    }
  });
});
