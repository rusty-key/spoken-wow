/**
 * Against a real Postgres, deliberately, for the reason history.test.ts gives.
 *
 * What this module is for is an invariant the schema owns: `take_team_current_idx` allows
 * exactly one live take per (team, source, lang, file). A mocked database would test that the
 * code runs the statements the code runs, which is not a test -- the thing worth pinning is
 * that the pair of updates cannot leave a file with two live takes or none.
 *
 * Needs DATABASE_URL and migrations applied:
 *   docker compose up -d postgres && deploy/web/bin/migrate.sh "$PWD/apps/web"
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "takes-store-int-"));
process.env.SPOKEN_QUESTS_AUDIO_HISTORY = path.join(root, "audio-history");

const { closeDb } = await import("@/lib/db");
const { asSystem } = await import("@/lib/teams/testing");
const { listTakes, livePath, liveTakes, setLiveTake, takePath } = await import("./store");
const { forgetTeams, teamOf } = await import("@/lib/teams/store");

/** A file no other run will collide with, so this can share a database with anything else. */
let file: string;

/** Rows only: what the bytes are, without pretending any exist yet. */
async function record(version: number, isCurrent = false, archiveFile: string | null = null) {
  await asSystem.query(
    `insert into "take"
       ("source", "lang", "file", "lineId", "version", "isCurrent", "origin", "bytes",
        "archiveFile", "teamId")
     values ('quests', 'enUS', $1, 'g:test', $2, $3, 'generated', 1, $4, (select "teamId" from "team_language" where "lang" = 'enUS' and "privileged"))`,
    [file, version, isCurrent, archiveFile],
  );
}

beforeAll(async () => {
  try {
    await asSystem.query(`select "archiveFile" from take limit 1`);
  } catch (error) {
    throw new Error(
      "store.test.ts needs a migrated database (migration 0031). Run:\n" +
        '  deploy/web/bin/migrate.sh "$PWD/apps/web"\n' +
        String(error),
    );
  }
});

beforeEach(() => {
  file = `gossip/${Math.random().toString(16).slice(2).padEnd(12, "0")}test.mp3`;
});

afterEach(async () => {
  await asSystem.query(`delete from "take" where "file" = $1`, [file]);
  await asSystem.query(`delete from "activity" where "subject" = $1`, [file]);
});

afterAll(async () => {
  fs.rmSync(root, { recursive: true, force: true });
  await closeDb();
});

describe("listing takes", () => {
  it("returns them newest first, which is the order the panel reads in", async () => {
    await record(1);
    await record(2);
    await record(3, true);

    expect((await listTakes("quests", file)).map((take) => take.version)).toEqual([3, 2, 1]);
  });

  it("answers for a file with no takes at all rather than throwing", async () => {
    expect(await listTakes("quests", file)).toEqual([]);
  });
});

describe("finding a take's bytes", () => {
  const stem = () => path.basename(file, ".mp3");

  it("believes the name a take recorded for itself", async () => {
    await record(3, false, "v3-1a2b3c4d.mp3");
    await record(4, true);

    expect(await takePath("quests", file, 3)).toEqual({
      kind: "file",
      path: path.join(root, "audio-history", "gossip", stem(), "v3-1a2b3c4d.mp3"),
      prefix: "takes",
    });
  });

  it("finds the live take in the archive like any other, which is the only place it is", async () => {
    await record(1);
    await record(2, true, "v2-00ff00ff.mp3");

    const archived = {
      kind: "file",
      path: path.join(root, "audio-history", "gossip", stem(), "v2-00ff00ff.mp3"),
      prefix: "takes",
    };
    expect(await takePath("quests", file, 2)).toEqual(archived);
    expect(await livePath("quests", file)).toEqual(archived);
  });

  it("says a line has no live take, rather than pointing anywhere", async () => {
    await record(1);

    expect(await livePath("quests", file)).toEqual({ kind: "none" });
  });

  it("says a clip was not kept, rather than guessing a name for it", async () => {
    // This used to fall back to the section's naming rule. For places and readables that rule
    // named clips by overwrite position, not version, so the guess could land on a real
    // file holding a different take.
    await record(2);
    await record(3, true);

    expect(await takePath("quests", file, 2)).toEqual({ kind: "gone" });
  });

  it("says when a version was never recorded", async () => {
    await record(1, true);

    expect(await takePath("quests", file, 9)).toEqual({ kind: "none" });
  });
});

describe("moving the live flag", () => {
  it("leaves exactly one live take, which is the whole point of the index", async () => {
    await record(1);
    await record(2, true);

    await setLiveTake("quests", file, 1, "enUS", null);

    const live = (await listTakes("quests", file)).filter((take) => take.isCurrent);
    expect(live.map((take) => take.version)).toEqual([1]);
  });

  it("writes no new row: a restore says which take is right, it does not make one", async () => {
    await record(1);
    await record(2, true);

    await setLiveTake("quests", file, 1, "enUS", null);

    expect(await listTakes("quests", file)).toHaveLength(2);
  });

  it("refuses a version that was never recorded, and leaves the live one alone", async () => {
    await record(1, true);

    await expect(setLiveTake("quests", file, 9, "enUS", null)).rejects.toThrow(/no version 9/);

    const live = (await listTakes("quests", file)).filter((take) => take.isCurrent);
    expect(live.map((take) => take.version)).toEqual([1]);
  });
});

describe("a language's live takes", () => {
  it("are the files the query by language alone found, read as the language's team", async () => {
    await asSystem.query(
      `insert into "take" ("source", "lang", "file", "lineId", "version", "isCurrent", "origin", "bytes", "teamId")
       values ('quests', 'deDE', $1, 'g:test', 1, false, 'generated', 1, (select "teamId" from "team_language" where "lang" = 'deDE' and "privileged")),
              ('quests', 'deDE', $1, 'g:test', 2, true, 'generated', 1, (select "teamId" from "team_language" where "lang" = 'deDE' and "privileged"))`,
      [file],
    );
    // What liveTakes asked before takes had a team.
    const { rows } = await asSystem.query<{ file: string }>(
      `select "file" from "take" where "source" = 'quests' and "lang" = 'deDE' and "isCurrent"`,
    );

    const live = await liveTakes("quests", "deDE");
    expect(live.map((take) => take.file).sort()).toEqual(rows.map((row) => row.file).sort());
    expect(live.find((take) => take.file === file)).toMatchObject({ version: 2, takes: 2 });
  });

  it("answers none for a language nobody owns, rather than failing the page", async () => {
    const owner = await teamOf("viVN");
    await asSystem.query(`delete from "team_language" where "lang" = 'viVN'`);
    forgetTeams();
    try {
      expect(await liveTakes("quests", "viVN")).toEqual([]);
    } finally {
      await asSystem.query(`insert into "team_language" ("teamId", "lang") values ($1, 'viVN')`, [owner]);
      forgetTeams();
    }
  });
});

describe("a restore", () => {
  it("is logged under the language's team", async () => {
    await record(1);
    await record(2, true);

    await setLiveTake("quests", file, 1, "enUS", null);

    const { rows } = await asSystem.query(
      `select "teamId" from "activity" where "kind" = 'take.restored' and "subject" = $1`,
      [file],
    );
    expect(rows).toEqual([{ teamId: await teamOf("enUS") }]);
  });
});
