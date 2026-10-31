/**
 * Against a real Postgres, for the reason history.test.ts gives: the invariant worth
 * pinning belongs to the schema. `book_line_current_idx` allows exactly one live version
 * per page, and a save is two statements that must not half-apply -- between them the page
 * would have no current version at all, and the export ships nothing for it.
 *
 * Needs DATABASE_URL and migrations applied:
 *   deploy/web/bin/migrate.sh "$PWD/apps/web"
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

const { closeDb } = await import("@/lib/db");
const { asSystem } = await import("@/lib/teams/testing");
const { BookConflict, BookMissing, bookHistory, restoreBookText, saveBookText } = await import("./text");

/** A page id no other run will collide with, so this can share a database. */
let lineId: string;

async function seed(text: string, skipReason: string | null = null) {
  const bookId = 900_000_000 + Math.floor(Math.random() * 90_000_000);
  await asSystem.query(
    `insert into "book_page"
       ("lineId", "pageTextId", "bookId", "pageNumber", "ownerKind", "ownerIds", "material")
     values ($1, $2::int, $2::int::text, 1, 'item', '{1}'::integer[], 0)`,
    [lineId, bookId],
  );
  await asSystem.query(
    `insert into "book_line"
       ("lineId", "lang", "version", "isCurrent", "origin", "pageId", "bookId",
        "pageNumber", "pageCount", "title", "ownerKind", "ownerIds", "material", "text",
        "generatable", "skipReason")
     values ($1, 'enUS', 1, true, 'extracted', 1, 1, 1, 1, 'A Test Tome', 'item',
             '{1}'::integer[], 0, $2, $3::text is null, $3)`,
    [lineId, text, skipReason],
  );
}

async function voiceable(lang: string) {
  const { rows } = await asSystem.query<{ generatable: boolean; skipReason: string | null }>(
    `select "generatable", "skipReason" from "book_line"
      where "lineId" = $1 and "lang" = $2 and "isCurrent"`,
    [lineId, lang],
  );
  return rows[0];
}

/**
 * A real account to edit as: a save is logged in the activity table, whose actor is a
 * foreign key onto "user", and the site only ever saves as somebody signed in.
 */
let editor: string;

beforeAll(async () => {
  editor = `test-${Math.random().toString(36).slice(2, 10)}`;
  await asSystem.query(
    `insert into "user" ("id", "name", "email", "emailVerified", "createdAt", "updatedAt")
     values ($1, 'Editor', $1 || '@test', false, now(), now())`,
    [editor],
  );
});

beforeEach(() => {
  lineId = `b:test-${Math.random().toString(16).slice(2)}`;
});

afterEach(async () => {
  await asSystem.query(`delete from "activity" where "lineId" = $1`, [lineId]);
  await asSystem.query(`delete from "book_line" where "lineId" = $1`, [lineId]);
  await asSystem.query(`delete from "book_page" where "lineId" = $1`, [lineId]);
});

afterAll(async () => {
  await asSystem.query(`delete from "user" where "id" = $1`, [editor]);
  await closeDb();
});

describe("a page with no words yet", () => {
  it("takes the first words of a page English lacks", async () => {
    const id = 900_000_000 + Math.floor(Math.random() * 90_000_000);
    await asSystem.query(
      `insert into "book_page" ("lineId", "pageTextId", "bookId", "pageNumber", "ownerKind", "ownerIds")
       values ($1, $2::int, $2::int::text, 1, 'item', '{1}'::integer[])`,
      [lineId, id],
    );
    const saved = await saveBookText({ lineId, text: "Hola.", editedBy: editor, lang: "esES" });
    expect(saved).toMatchObject({ lineId, version: 1, text: "Hola." });
    const { rows } = await asSystem.query(
      `select "pageId", "bookId", "pageNumber", "pageCount", "title" from "book_line"
        where "lineId" = $1 and "lang" = 'esES'`,
      [lineId],
    );
    expect(rows[0]).toEqual({ pageId: id, bookId: id, pageNumber: 1, pageCount: 1, title: "" });
  });

  it("takes the first words of a minted page, leaving the structure the game never gave it empty", async () => {
    const bookId = `n${crypto.randomUUID()}`;
    lineId = `b:${bookId}`;
    await asSystem.query(`insert into "book_page" ("lineId", "bookId", "pageNumber") values ($1, $2, 1)`, [lineId, bookId]);
    const saved = await saveBookText({ lineId, text: "Hola.", editedBy: editor, lang: "esES" });
    expect(saved).toMatchObject({ lineId, version: 1, text: "Hola." });
    const { rows } = await asSystem.query(
      `select "pageId", "bookId", "pageNumber", "pageCount", "ownerKind", "ownerIds" from "book_line"
        where "lineId" = $1 and "lang" = 'esES'`,
      [lineId],
    );
    expect(rows[0]).toEqual({ pageId: null, bookId: null, pageNumber: 1, pageCount: 1, ownerKind: null, ownerIds: null });
  });

  it("refuses a page that has words but no book_page row", async () => {
    await seed("Words.");
    await asSystem.query(`delete from "book_page" where "lineId" = $1`, [lineId]);
    await expect(saveBookText({ lineId, text: "Other.", editedBy: editor })).rejects.toThrow(BookMissing);
    const history = await bookHistory(lineId);
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({ isCurrent: true, text: "Words." });
  });
});

describe("rewriting a page", () => {
  it("adds a version and leaves exactly one live", async () => {
    await seed("The orignal text.");

    const saved = await saveBookText({
      lineId,
      text: "The original text.",
      editedBy: editor,
      expectedVersion: 1,
    });

    expect(saved).toMatchObject({ version: 2, isCurrent: true, origin: "edited" });
    const history = await bookHistory(lineId);
    expect(history.map((v) => v.version)).toEqual([2, 1]);
    expect(history.filter((v) => v.isCurrent)).toHaveLength(1);
  });

  it("carries the structural fields, which are the extract's and not an editor's", async () => {
    // Which book a page belongs to and what opens it are facts about the dump. An API that
    // let a text edit move them would be one bad request from a page the addon cannot find.
    await seed("Before.");
    await saveBookText({ lineId, text: "After.", editedBy: editor });

    const { rows } = await asSystem.query<{ title: string; pageCount: number }>(
      `select "title", "pageCount" from "book_line" where "lineId" = $1 and "isCurrent"`,
      [lineId],
    );
    expect(rows[0]).toMatchObject({ title: "A Test Tome", pageCount: 1 });
  });

  it("spends no version on a save that changes nothing", async () => {
    // The history is a record of what the page has said, not of who opened the dialog.
    await seed("Unchanged.");
    await saveBookText({ lineId, text: "Unchanged.", editedBy: editor });

    expect(await bookHistory(lineId)).toHaveLength(1);
  });

  it("refuses an edit that started from a version somebody has since replaced", async () => {
    await seed("First.");
    await saveBookText({ lineId, text: "Second.", editedBy: editor });

    // Still holding v1, as a dialog opened before the other save would be.
    await expect(
      saveBookText({ lineId, text: "Third.", editedBy: editor, expectedVersion: 1 }),
    ).rejects.toThrow(BookConflict);

    const live = (await bookHistory(lineId)).find((v) => v.isCurrent);
    expect(live?.text).toBe("Second.");
  });

  it("refuses empty text rather than shipping a silent page", async () => {
    await seed("Something.");
    await expect(saveBookText({ lineId, text: "   ", editedBy: editor })).rejects.toThrow(/empty/);
  });
});

describe("whether a page can be voiced", () => {
  it("is decided per language, from that language's own text", async () => {
    await seed("Greetings, $N.", "substitution");

    await saveBookText({ lineId, text: "Saudações, viajante.", editedBy: editor, lang: "ptBR" });
    expect(await voiceable("ptBR")).toEqual({ generatable: true, skipReason: null });
    // The English row is not the Portuguese one's to judge.
    expect(await voiceable("enUS")).toEqual({ generatable: false, skipReason: "substitution" });

    // A $N is spoken as the language's word (player-words.ts); a token nothing speaks is not.
    await saveBookText({ lineId, text: "Saudações, $N.", editedBy: editor, lang: "ptBR" });
    expect(await voiceable("ptBR")).toEqual({ generatable: true, skipReason: null });
    await saveBookText({ lineId, text: "Saudações, $Nama.", editedBy: editor, lang: "ptBR" });
    expect(await voiceable("ptBR")).toEqual({ generatable: false, skipReason: "substitution" });
  });

  it("unblocks an English page once its edit removes the token", async () => {
    await seed("Greetings, $N.", "substitution");

    await saveBookText({ lineId, text: "Greetings, traveller.", editedBy: editor });

    expect(await voiceable("enUS")).toEqual({ generatable: true, skipReason: null });
  });
});

describe("putting an earlier version back", () => {
  it("moves the live flag rather than writing another version", async () => {
    // The same thing restore means for a lore version and for a take: a statement about
    // which of these texts is right, not a new one.
    await seed("First.");
    await saveBookText({ lineId, text: "Second.", editedBy: editor });

    await restoreBookText(lineId, 1, "enUS", editor);

    const history = await bookHistory(lineId);
    expect(history).toHaveLength(2);
    expect(history.find((v) => v.isCurrent)).toMatchObject({ version: 1, text: "First." });
  });

  it("carries the restored version's title into the next edit", async () => {
    await seed("First.");
    await saveBookText({ lineId, text: "Second.", editedBy: editor });
    await restoreBookText(lineId, 1, "enUS", editor);
    await asSystem.query(
      `update "book_line" set "title" = 'Corrected' where "lineId" = $1 and "version" = 1`,
      [lineId],
    );

    await saveBookText({ lineId, text: "Third.", editedBy: editor });

    const { rows } = await asSystem.query(
      `select "title" from "book_line" where "lineId" = $1 and "version" = 3`,
      [lineId],
    );
    expect(rows[0].title).toBe("Corrected");
  });
});
