/**
 * Against a real Postgres, because what is being tested is a comparison against a column the
 * generation path wrote - and the interesting case is the column being null.
 *
 * Needs DATABASE_URL and migrations applied:
 *   docker compose up -d postgres && deploy/bin/migrate.sh "$PWD/web"
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

const { closeDb, db } = await import("@/lib/db");
const { audioRelPath, fileIndex } = await import("@/lib/audio");
const { lineIndex } = await import("@/lib/quests/catalogue");
const { fileDefaults } = await import("@/lib/generation/files");
const { spokenHash } = await import("@/lib/generation/spoken-hash");
const { applyPronunciation } = await import("@/lib/generation/pronunciation");
const { accentTagged } = await import("@/lib/generation/narration");
const { currentConfig } = await import("@/lib/generation/settings");
const { clearOverride, writeOverride } = await import("./overrides");
const { SHAPE } = await import("@/lib/generation/speakers/shape");
const { staleFiles } = await import("./staleness");

/**
 * Deliberately not one of regenerate.test.ts's fixture lines. Test files run in parallel
 * against one database, and two files taking turns owning the same mp3's version rows is a
 * flake that only shows up under load.
 */
const LINE = "q:33:accept";
const file = audioRelPath((await lineIndex()).get(LINE)![0]);

/** What generation would send this line's provider right now. */
async function currentHash(provider: "elevenlabs" | "fish" = "elevenlabs"): Promise<string> {
  const line = (await fileIndex()).get(file)!;
  return spokenHash(SHAPE[provider](applyPronunciation(line.text, fileDefaults().rules), undefined));
}

async function liveTake(hash: string | null, provider: "elevenlabs" | "fish" = "elevenlabs") {
  await db().query(
    `insert into "take"
       ("source", "file", "version", "isCurrent", "origin", "lineId", "voice", "bytes",
        "spokenHash", "provider")
     values ('quests', $1, 9999, true, 'generated', $2, 'human-male-standard', 1, $3, $4)`,
    [file, LINE, hash, provider],
  );
}

beforeAll(async () => {
  try {
    await db().query(`select 1 from "take" limit 1`);
  } catch (error) {
    throw new Error(
      "staleness.test.ts needs a migrated database. Run:\n" +
        '  docker compose up -d postgres && deploy/bin/migrate.sh "$PWD/web"\n' +
        String(error),
    );
  }
});

/**
 * A real take of this line may already be live in whatever database `pnpm test` is pointed
 * at, and only one row per file may claim to be current. So the incumbent stands aside for
 * the duration and is put back afterwards - the same courtesy regenerate.test.ts extends.
 */
let deposed: number[] = [];

beforeEach(async () => {
  const { rows } = await db().query<{ id: string }>(
    `update "take" set "isCurrent" = false
      where "source" = 'quests' and "file" = $1 and "isCurrent"
     returning "id"`,
    [file],
  );
  deposed = rows.map((r) => Number(r.id));
});

afterEach(async () => {
  await db().query(
    `delete from "take" where "source" = 'quests' and "file" = $1 and "version" = 9999`,
    [file],
  );
  if (deposed.length > 0) {
    await db().query(`update "take" set "isCurrent" = true where "id" = any($1::bigint[])`, [
      deposed,
    ]);
  }
  await clearOverride(file, null);
});

afterAll(async () => {
  await closeDb();
});

describe("staleFiles", () => {
  it("says nothing is stale when the live take matches the current text", async () => {
    await liveTake(await currentHash());
    expect(await staleFiles([file])).toEqual(new Set());
  });

  it("catches a take made before the text was rewritten", async () => {
    await liveTake(await currentHash());
    await writeOverride(file, LINE, "Something else entirely.", null);

    expect(await staleFiles([file])).toEqual(new Set([file]));
  });

  it("clears once a take is made from the new text", async () => {
    await writeOverride(file, LINE, "Something else entirely.", null);
    await liveTake(spokenHash(applyPronunciation("Something else entirely.", fileDefaults().rules)));

    expect(await staleFiles([file])).toEqual(new Set());
  });

  it("treats an unknown hash as fresh, because null means unknown and not unchanged", async () => {
    // Version 0 is audio this project inherited; every take from before migration 0006 is the
    // same. Calling those stale would mark most of the store on a claim nothing supports.
    await liveTake(null);
    expect(await staleFiles([file])).toEqual(new Set());
  });

  it("judges a fish.audio take by what fish.audio would be sent", async () => {
    await liveTake(await currentHash("fish"), "fish");
    expect(await staleFiles([file])).toEqual(new Set());

    await writeOverride(file, LINE, "Something else entirely.", null);
    expect(await staleFiles([file])).toEqual(new Set([file]));
  });

  it("says nothing about a file with no take at all", async () => {
    expect(await staleFiles([file])).toEqual(new Set());
    expect(await staleFiles([])).toEqual(new Set());
  });
});

/**
 * A dwarf line, for the race the committed config gives an accent direction.
 *
 * Its own file and its own fixtures, for the reason LINE gives: two describes sharing an
 * mp3's version rows flake under parallel test files.
 */
const DWARF_LINE = "q:48:complete";
const dwarfFile = audioRelPath((await lineIndex()).get(DWARF_LINE)![0]);

describe("a race with an accent tag", () => {
  let deposedDwarf: number[] = [];

  beforeEach(async () => {
    const { rows } = await db().query<{ id: string }>(
      `update "take" set "isCurrent" = false
        where "source" = 'quests' and "file" = $1 and "isCurrent"
       returning "id"`,
      [dwarfFile],
    );
    deposedDwarf = rows.map((r) => Number(r.id));
  });

  afterEach(async () => {
    await db().query(
      `delete from "take" where "source" = 'quests' and "file" = $1 and "version" = 9999`,
      [dwarfFile],
    );
    if (deposedDwarf.length > 0) {
      await db().query(`update "take" set "isCurrent" = true where "id" = any($1::bigint[])`, [
        deposedDwarf,
      ]);
    }
  });

  async function dwarfTake(hash: string) {
    await db().query(
      `insert into "take"
         ("source", "file", "version", "isCurrent", "origin", "lineId", "voice", "bytes",
          "spokenHash")
       values ('quests', $1, 9999, true, 'generated', $2, 'dwarf-male-grim', 1, $3)`,
      [dwarfFile, DWARF_LINE, hash],
    );
  }

  function tagged(text: string): string {
    return accentTagged(text, { dwarf: "[Scottish accent]" }.dwarf);
  }

  // The tag is part of the string that was sent, so a take made with it must compare equal to
  // what would be sent now - otherwise every dwarf line is stale forever rather than once.
  it("leaves a take made with the tag alone", async () => {
    const line = (await fileIndex()).get(dwarfFile)!;
    await dwarfTake(spokenHash(tagged(applyPronunciation(line.text, fileDefaults().rules))));

    expect((await currentConfig()).raceTags.dwarf).toBe("[Scottish accent]");
    expect(await staleFiles([dwarfFile])).toEqual(new Set());
  });

  it("catches a take made before the race had a tag", async () => {
    const line = (await fileIndex()).get(dwarfFile)!;
    await dwarfTake(spokenHash(applyPronunciation(line.text, fileDefaults().rules)));

    expect(await staleFiles([dwarfFile])).toEqual(new Set([dwarfFile]));
  });
});
