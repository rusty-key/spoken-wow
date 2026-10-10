/**
 * Another language's quest lines, read over the English ones. Against a real Postgres with
 * the corpus imported, because what is being tested is a join and the rows it joins.
 *
 * Needs DATABASE_URL, migrations applied and the corpus imported:
 *   deploy/web/bin/migrate.sh "$PWD/apps/web" && make quests-import-corpus
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { CorpusLine } from "@/lib/corpus";

const { closeDb, db, query } = await import("@/lib/db");
const { corpus } = await import("./catalogue");
const { keepLanguage } = await import("./keep-language");

const LANG = "koKR";

type Line = {
  lineId: string;
  variant: number;
  questId: number;
  questTitle: string;
  text: string;
  npcType: string;
  npcId: number;
  npcName: string;
};
let line: Line;

beforeAll(async () => {
  const rows = await query<Line>(
    `select l."lineId", l."variant", l."questId", l."questTitle", l."text",
            s."npcType", s."npcId", s."npcName"
       from "quest_line" l
       join "quest_line_speaker" s
         on s."lineId" = l."lineId" and s."variant" = l."variant" and s."lang" = l."lang"
      where l."lang" = 'enUS' and l."isCurrent" and l."questId" is not null and l."generatable"
        and not exists (select 1 from "quest_line" k where k."lineId" = l."lineId" and k."lang" = $1)
        and not exists (select 1 from "entity_name" n
                         where n."lang" = $1 and ((n."kind" = 'quest' and n."entityId" = l."questId"::text)
                            or (n."kind" = s."npcType" and n."entityId" = s."npcId"::text)))
      order by l."lineId" limit 1`,
    [LANG],
  );
  if (!rows[0]) throw new Error("translated.test.ts needs the corpus imported: make quests-import-corpus");
  line = rows[0];
});

keepLanguage(LANG);

afterAll(closeDb);

async function translate(text: string) {
  await db().query(
    `insert into "quest_line"
       ("lineId", "variant", "lang", "version", "isCurrent", "origin", "source", "questId",
        "questTitle", "fileName", "text", "originalText", "generatable")
     select "lineId", "variant", $2, 1, true, 'extracted', "source", "questId",
            "questTitle", "fileName", $3, "originalText", true
       from "quest_line"
      where "lineId" = $1 and "variant" = $4 and "lang" = 'enUS' and "isCurrent"`,
    [line.lineId, LANG, text, line.variant],
  );
}

async function name(kind: string, entityId: string | number, value: string) {
  await db().query(
    `insert into "entity_name" ("kind", "entityId", "lang", "version", "isCurrent", "origin", "name")
     values ($1, $2, $3, 1, true, 'extracted', $4)`,
    [kind, String(entityId), LANG, value],
  );
}

// Each case reads the whole corpus twice, English and the language over it: under 3 s here,
// past vitest's 5 s default on a CI runner once the corpus passed 19k lines.
const WHOLE_CORPUS = { timeout: 20_000 };

function rowOf(lines: CorpusLine[]): CorpusLine {
  return lines.find((candidate) => candidate.lineId === line.lineId)!;
}

describe("a language read over the English lines", WHOLE_CORPUS, () => {
  it("has every English line, and says which it has not translated", async () => {
    const [english, italian] = await Promise.all([corpus(), corpus(LANG)]);
    // Every English row but a second variant's: see "a line with two English variants".
    expect(italian.lines).toHaveLength(english.lines.filter((row) => !row.variant).length);

    const row = rowOf(italian.lines);
    expect(row.text).toBe(line.text);
    expect(row.missing).toEqual({ text: true, questTitle: true, npcName: true });
    // The English is there to be read, never to be recorded under the language's name.
    expect(row.generatable).toBe(false);
    expect(row.skipReason).toBe("untranslated");
  });

  it("takes the language's own text and names where it has them", async () => {
    await translate("Salve, viandante.");
    await name("quest", line.questId, "Il titolo");

    const row = rowOf((await corpus(LANG)).lines);
    expect(row.text).toBe("Salve, viandante.");
    expect(row.questTitle).toBe("Il titolo");
    expect(row.npcName).toBe(line.npcName);
    expect(row.missing).toEqual({ text: false, questTitle: false, npcName: true });
    expect(row.generatable).toBe(true);
  });

  it("leaves English exactly as it reads without any of this", async () => {
    await translate("Salve, viandante.");
    const row = rowOf((await corpus()).lines);
    expect(row.text).toBe(line.text);
    expect(row.missing).toBeUndefined();
  });
});

describe("a line with two English variants", WHOLE_CORPUS, () => {
  // Quest 4265 has a quest_template row per content patch, so the English carries both:
  // complete as one text under two titles, accept as two texts. One file either way.
  const LINE = "q:4265:complete";

  async function translateVariant(variant: number, text: string) {
    await db().query(
      `insert into "quest_line"
         ("lineId", "variant", "lang", "version", "isCurrent", "origin", "source", "questId",
          "questTitle", "fileName", "text", "originalText", "generatable")
       select "lineId", "variant", $2, 1, true, 'extracted', "source", "questId",
              "questTitle", "fileName", $3, "originalText", true
         from "quest_line"
        where "lineId" = $1 and "variant" = $4 and "lang" = 'enUS' and "isCurrent"`,
      [LINE, LANG, text, variant],
    );
  }

  it("is one line per speaker in another language, translated from variant 0", async () => {
    const english = (await corpus()).lines.filter((row) => row.lineId === LINE);
    if (new Set(english.map((row) => row.variant)).size < 2) return;
    await translateVariant(0, "Bienvenido a casa.");

    const rows = (await corpus(LANG)).lines.filter((row) => row.lineId === LINE);
    expect(rows.map((row) => row.variant ?? 0)).toEqual(
      english.filter((row) => !row.variant).map(() => 0),
    );
    expect(rows.every((row) => row.text === "Bienvenido a casa." && row.generatable)).toBe(true);
  });
});

describe("English names in entity_name", () => {
  // The columns stay English's source, and a trigger copies each write across: see 0036.
  it("holds every quest's title and every speaker's name", async () => {
    const rows = await query<{ kind: string; name: string }>(
      `select "kind", "name" from "entity_name"
        where "lang" = 'enUS' and "isCurrent"
          and (("kind" = 'quest' and "entityId" = $1) or ("kind" = $2 and "entityId" = $3))`,
      [String(line.questId), line.npcType, String(line.npcId)],
    );
    expect(rows.map((row) => row.kind).sort()).toEqual(["quest", line.npcType].sort());
  });
});
