/**
 * Writing another language's quest text and names. Against a real Postgres with the corpus
 * imported, because the structure a first translation copies is a row that has to exist.
 *
 * Needs DATABASE_URL, migrations applied and the corpus imported.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

const { closeDb, db, query } = await import("@/lib/db");
const { questTextHistory, restoreQuestText, saveQuestText, QuestTextConflict, QuestTextMissing } = await import("./text");
const { saveName, nameHistory } = await import("@/lib/names/store");
const { clearIgnore, readIgnores, writeIgnore } = await import("./ignores");

const LANG = "koKR";
let english: { lineId: string; variant: number; questId: number; fileName: string; source: string };
let userId: string;

beforeAll(async () => {
  const rows = await query<typeof english>(
    `select "lineId", "variant", "questId", "fileName", "source" from "quest_line"
      where "lang" = 'enUS' and "isCurrent" and "questId" is not null and "source" = 'accept'
      order by "lineId" limit 1`,
  );
  if (!rows[0]) throw new Error("text.test.ts needs the corpus imported");
  english = rows[0];
  userId = `test-${Math.random().toString(36).slice(2, 10)}`;
  await db().query(
    `insert into "user" ("id", "name", "email", "emailVerified", "createdAt", "updatedAt")
     values ($1, 'Translator', $1 || '@test', false, now(), now())`,
    [userId],
  );
});

afterEach(async () => {
  // Every write here is logged as this user's, so their rows are exactly the ones to drop.
  await db().query(`delete from "activity" where "actorId" = $1`, [userId]);
  await db().query(`delete from "quest_line" where "lang" = $1`, [LANG]);
  await db().query(`delete from "entity_name" where "lang" = $1`, [LANG]);
  await db().query(`delete from "line_ignore" where "lineId" = $1`, ["q:0:ignore-test"]);
});

afterAll(async () => {
  await db().query(`delete from "user" where "id" = $1`, [userId]);
  await closeDb();
});

describe("a first translation", () => {
  it("takes its structure from the English line and is live", async () => {
    const saved = await saveQuestText({
      lineId: english.lineId,
      variant: english.variant,
      lang: LANG,
      text: "Salve, viandante.",
      editedBy: userId,
    });
    expect(saved).toMatchObject({ version: 1, isCurrent: true, origin: "edited" });

    const rows = await query<{ fileName: string; source: string; generatable: boolean }>(
      `select "fileName", "source", "generatable" from "quest_line"
        where "lineId" = $1 and "variant" = $2 and "lang" = $3 and "isCurrent"`,
      [english.lineId, english.variant, LANG],
    );
    expect(rows[0]).toEqual({ fileName: english.fileName, source: english.source, generatable: true });
  });

  it("is voiceable with a player-name token, which is spoken as the language's word", async () => {
    await saveQuestText({
      lineId: english.lineId,
      variant: english.variant,
      lang: LANG,
      text: "고맙소, $N.",
      editedBy: userId,
    });
    const rows = await query<{ generatable: boolean; skipReason: string | null }>(
      `select "generatable", "skipReason" from "quest_line"
        where "lineId" = $1 and "lang" = $2 and "isCurrent"`,
      [english.lineId, LANG],
    );
    expect(rows[0]).toEqual({ generatable: true, skipReason: null });
  });

  it("is not voiceable while it holds a token nothing can speak", async () => {
    await saveQuestText({
      lineId: english.lineId,
      variant: english.variant,
      lang: LANG,
      text: "$2113w 상자, $N.",
      editedBy: userId,
    });
    const rows = await query<{ generatable: boolean; skipReason: string | null }>(
      `select "generatable", "skipReason" from "quest_line"
        where "lineId" = $1 and "lang" = $2 and "isCurrent"`,
      [english.lineId, LANG],
    );
    expect(rows[0]).toEqual({ generatable: false, skipReason: "invalid-chars" });
  });
});

describe("a later translation", () => {
  it("is refused when somebody else saved in between", async () => {
    const base = { lineId: english.lineId, variant: english.variant, lang: LANG as "koKR", editedBy: userId };
    await saveQuestText({ ...base, text: "Uno." });
    await saveQuestText({ ...base, text: "Due.", expectedVersion: 1 });
    await expect(saveQuestText({ ...base, text: "Tre.", expectedVersion: 1 })).rejects.toBeInstanceOf(
      QuestTextConflict,
    );
  });

  it("can be put back", async () => {
    const base = { lineId: english.lineId, variant: english.variant, lang: LANG as "koKR", editedBy: userId };
    await saveQuestText({ ...base, text: "Uno." });
    await saveQuestText({ ...base, text: "Due." });
    await restoreQuestText(english.lineId, english.variant, LANG, 1, userId);
    const history = await questTextHistory(english.lineId, english.variant, LANG);
    expect(history.find((v) => v.isCurrent)?.text).toBe("Uno.");

    // The flag moving writes no row that names anybody, so the log is the only record.
    const logged = await query<{ lineId: string; source: string; detail: unknown }>(
      `select "lineId", "source", "detail" from "activity"
        where "actorId" = $1 and "lang" = $2 and "kind" = 'text.restored'`,
      [userId, LANG],
    );
    expect(logged).toEqual([
      { lineId: english.lineId, source: "quests", detail: { version: 1, from: 2 } },
    ]);
  });

  it("is never English, which is rewritten through line_override", async () => {
    await expect(
      saveQuestText({ lineId: english.lineId, variant: english.variant, lang: "enUS", text: "x", editedBy: userId }),
    ).rejects.toThrow(/line_override/);
  });
});

describe("a line English does not have", () => {
  const NATIVE = "q:0:native-test";

  it("is refused while the language has no line either", async () => {
    await expect(
      saveQuestText({ lineId: NATIVE, variant: 0, lang: LANG, text: "Salve.", editedBy: userId }),
    ).rejects.toBeInstanceOf(QuestTextMissing);
  });

  it("versions from the language's own row", async () => {
    // No English row for the id at all.
    await db().query(
      `insert into "quest_line"
         ("lineId", "variant", "lang", "version", "isCurrent", "origin", "source", "questId",
          "fileName", "text", "originalText", "localeText", "generatable")
       values ($1, 0, $2, 1, true, 'contributed', 'accept', 0, '0-accept', 'Salve.', 'Salve.', 'Salve.', true)`,
      [NATIVE, LANG],
    );
    const saved = await saveQuestText({ lineId: NATIVE, variant: 0, lang: LANG, text: "Salve, $N.", editedBy: userId });
    expect(saved).toMatchObject({ version: 2, isCurrent: true, origin: "edited" });

    const rows = await query<{ fileName: string; source: string; localeText: string; generatable: boolean }>(
      `select "fileName", "source", "localeText", "generatable" from "quest_line"
        where "lineId" = $1 and "lang" = $2 and "isCurrent"`,
      [NATIVE, LANG],
    );
    expect(rows[0]).toEqual({ fileName: "0-accept", source: "accept", localeText: "Salve.", generatable: true });
  });
});

describe("naming", () => {
  it("names a thing English has a name for, and refuses one it has not", async () => {
    await saveName({ kind: "quest", entityId: String(english.questId), lang: LANG, name: "Titolo", editedBy: userId });
    expect((await nameHistory("quest", String(english.questId), LANG))[0]).toMatchObject({
      name: "Titolo",
      origin: "edited",
      isCurrent: true,
    });
    await expect(
      saveName({ kind: "quest", entityId: "999999999", lang: LANG, name: "x", editedBy: userId }),
    ).rejects.toThrow(/no English name/);
  });
});

describe("ignores at two levels", () => {
  it("counts a line ignored in one language only there", async () => {
    await writeIgnore("q:0:ignore-test", "the Italian never says this", userId, LANG);
    expect((await readIgnores(LANG)).get("q:0:ignore-test")?.lang).toBe(LANG);
    expect((await readIgnores("enUS")).has("q:0:ignore-test")).toBe(false);
    expect(await clearIgnore("q:0:ignore-test", LANG, userId)).toBe(true);
  });

  it("counts a line ignored everywhere in every language", async () => {
    await writeIgnore("q:0:ignore-test", "nobody voices this", userId);
    expect((await readIgnores(LANG)).get("q:0:ignore-test")?.lang).toBeNull();
    expect((await readIgnores("enUS")).has("q:0:ignore-test")).toBe(true);
  });

  // Both levels at once since 0038: the broader decision is the one a language reads.
  it("keeps a language's own ignore beside one for every language", async () => {
    await writeIgnore("q:0:ignore-test", "nobody voices this", userId);
    await writeIgnore("q:0:ignore-test", "nor the Italian", userId, LANG);
    expect((await readIgnores(LANG)).get("q:0:ignore-test")?.reason).toBe("nobody voices this");
    expect(await clearIgnore("q:0:ignore-test", null, userId)).toBe(true);
    expect((await readIgnores(LANG)).get("q:0:ignore-test")?.reason).toBe("nor the Italian");
  });
});
