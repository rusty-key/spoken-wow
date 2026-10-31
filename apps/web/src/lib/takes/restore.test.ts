/**
 * What a restore must not do: touch a file, or invent a take.
 *
 * Against a real Postgres and a real directory, because both halves of the claim are
 * about things outside the code -- the bytes on disk and the partial unique index that
 * allows one live take per file.
 *
 * The failure this pins used to be real: restoring copied or renamed audio into a store,
 * and on two of the three sections that destroyed the only archived copy of the take being
 * restored. Now a restore moves the live flag and nothing else.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeEach, expect, it } from "vitest";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "restore-proof-"));
process.env.SPOKEN_QUESTS_AUDIO_HISTORY = path.join(root, "audio-history");

const { closeDb, db } = await import("@/lib/db");
const { commitTake } = await import("@/lib/takes/commit");
const { restoreTake } = await import("@/lib/takes/restore");
const { listTakes, livePath } = await import("@/lib/takes/store");

let file: string;
beforeEach(() => {
  file = `gossip/${Math.random().toString(16).slice(2).padEnd(12, "0")}proof.mp3`;
});
afterAll(async () => {
  await db().query(`delete from "take" where "file" like '%proof.mp3'`);
  fs.rmSync(root, { recursive: true, force: true });
  await closeDb();
});

function take(text: string) {
  return commitTake("quests", file, Buffer.from(text), { lineId: "g:proof" });
}

/** Every file under the archive, with its inode and mtime: what "untouched" means. */
function snapshot(): string[] {
  const dir = path.join(root, "audio-history", "gossip", path.basename(file, ".mp3"));
  return fs
    .readdirSync(dir)
    .sort()
    .map((name) => {
      const info = fs.statSync(path.join(dir, name));
      return `${name} ${info.ino} ${info.mtimeMs}`;
    });
}

async function live(): Promise<string> {
  const bytes = await livePath("quests", file);
  if (bytes.kind !== "file") throw new Error(`no live file: ${bytes.kind}`);
  return fs.readFileSync(bytes.path, "utf8");
}

it("puts a take back by moving the flag, touching no file and adding no take", async () => {
  await take("take one");
  await take("take two");
  await take("take three");
  const before = snapshot();

  await restoreTake("quests", file, 1, "enUS", null);

  expect(snapshot()).toEqual(before);
  expect(await live()).toBe("take one");
  const rows = await listTakes("quests", file);
  expect(rows).toHaveLength(3);
  expect(rows.filter((r) => r.isCurrent).map((r) => r.version)).toEqual([1]);
  // Nothing in the take table says a restore happened, so the activity log is its record.
  const { rows: logged } = await db().query(
    `select "detail" from "activity" where "kind" = 'take.restored' and "subject" = $1`,
    [file],
  );
  expect(logged.map((row) => row.detail)).toEqual([{ version: 1, from: 3 }]);

  // Twice over, which is the case that used to eat the archive entry.
  await restoreTake("quests", file, 3, "enUS", null);
  expect(snapshot()).toEqual(before);
  expect(await live()).toBe("take three");
});

it("refuses a take whose clip was not kept, and leaves the live one alone", async () => {
  await take("kept");
  await db().query(
    `insert into "take" ("source", "lang", "file", "lineId", "version", "isCurrent", "origin", "bytes", "teamId")
     values ('quests', 'enUS', $1, 'g:proof', 2, false, 'generated', 1, (select "teamId" from "team_language" where "lang" = 'enUS' and "privileged"))`,
    [file],
  );

  await expect(restoreTake("quests", file, 2, "enUS", null)).rejects.toThrow(/was not kept/);
  expect(await live()).toBe("kept");
});
