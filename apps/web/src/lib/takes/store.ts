/**
 * Every take of every line, for all three sections, over one table and one archive rule.
 *
 * The `take` table has held all three since migration 0020, but only the quests side ever
 * had a history panel to read it with: places could undo its newest take and readables had no
 * way back at all. The difference was never in the data. It was that each section reached
 * its own audio through its own module, so a panel written against one of them could not be
 * shown on the other two.
 *
 * This is the seam that makes them one. What differs between the sections is where the
 * bytes live and how a file is named -- frozen rules, per AGENTS.md -- so that is what the
 * adapter holds, and everything else is written once here.
 *
 * Keyed on `(source, file)` because that is what `take_team_current_idx` is on, and because a
 * quests file is spoken by several NPCs: "restore this line" is really "restore this file".
 */
import "server-only";

import path from "node:path";

import { recordActivity } from "@/lib/activity/store";
import { blobOrFile, type Stored } from "@/lib/blobs/store";
import { BASE_LANG, type Lang } from "@/lib/lang";
import { asTeamOf, readAs } from "@/lib/teams/store";

import { historyDirOf } from "./adapters";
import type { Source } from "@/lib/sections";
import type { Provider } from "@/lib/generation/providers";

export type Take = {
  version: number;
  isCurrent: boolean;
  origin: "imported" | "generated";
  /** Where the bytes are, relative to the line's history directory, or null when unknown. */
  archiveFile: string | null;
  characters: number | null;
  credits: number | null;
  /** Dollars, for a fish.audio take. Never summed with credits. */
  costUsd: number | null;
  provider: Provider;
  modelId: string | null;
  createdAt: string;
  createdByName: string | null;
};

type Row = Omit<Take, "createdAt"> & { createdAt: Date };

const COLUMNS = `t."version", t."isCurrent", t."origin", t."archiveFile", t."characters",
                 t."credits", t."costUsd"::float8 as "costUsd", t."provider", t."modelId",
                 t."createdAt", u."name" as "createdByName"`;

/** Every take of one file, newest first, without asking the filesystem anything. */
export async function listTakes(
  source: Source,
  file: string,
  lang: Lang = BASE_LANG,
): Promise<Take[]> {
  const rows = await readAs<Row>(
    lang,
    `select ${COLUMNS}
       from "take" t
       left join "user" u on u."id" = t."createdBy"
      where t."source" = $1 and t."file" = $2 and t."lang" = $3
      order by t."version" desc`,
    [source, file, lang],
  );
  return rows.map((row) => ({ ...row, createdAt: row.createdAt.toISOString() }));
}

/** One section's live take of one file, with how many takes that file has. */
export type LiveTake = {
  lineId: string;
  file: string;
  version: number;
  /** Every take of this file, the live one included. */
  takes: number;
  spokenHash: string | null;
  characters: number | null;
  credits: number | null;
  durationSec: number | null;
  bytes: number;
  provider: Provider;
  modelId: string | null;
  voiceId: string | null;
  createdAt: Date;
  /** Who asked for it: null for anything the CLI imported, or a deleted account's. */
  createdBy: string | null;
  createdByName: string | null;
};

/**
 * The live take of every file in a section, and how many takes each has.
 *
 * One query for all three sections, which each used to write for themselves -- quests in
 * generation/versions.ts, places and readables in their catalogues -- and all three as a count
 * subquery per live row. Postgres does not flatten a scalar subquery in the select list,
 * so at eleven thousand quests files that was eleven thousand index scans on every
 * search.
 *
 * Two queries joined here rather than one joined in Postgres. The single query joined
 * `take` to a grouped count of itself, and its plan rested on the row estimate for the
 * language: a language whose takes all arrive between two autoanalyzes is estimated at one
 * row, Postgres picked a nested loop that re-grouped every itIT take once per live take,
 * and the itIT explorer spent 18 seconds here on every search (2026-10-03). Each query
 * below is one index scan whatever the estimate says, so a stale one costs nothing. A
 * window count avoids the join too, but reads every column of every take to do it and was
 * four times slower than either half.
 *
 * Counted by file, which is what take_team_current_idx is on. For places and readables a file and a
 * line are the same thing; a quests file is shared by every NPC who speaks it.
 */
export async function liveTakes(source: Source, lang: Lang = BASE_LANG): Promise<LiveTake[]> {
  const [live, counts] = await Promise.all([
    readAs<Omit<LiveTake, "takes">>(
      lang,
      `select t."lineId", t."file", t."version", t."spokenHash", t."characters",
              t."credits", t."durationSec"::float8 as "durationSec", t."bytes"::float8 as "bytes",
              t."provider", t."modelId", t."voiceId", t."createdAt", t."createdBy",
              u."name" as "createdByName"
         from "take" t
         left join "user" u on u."id" = t."createdBy"
        where t."source" = $1 and t."lang" = $2 and t."isCurrent"`,
      [source, lang],
    ),
    readAs<{ file: string; takes: number }>(
      lang,
      `select "file", count(*)::int as "takes" from "take"
        where "source" = $1 and "lang" = $2 group by "file"`,
      [source, lang],
    ),
  ]);
  const takes = new Map(counts.map((row) => [row.file, row.takes]));
  // Never zero: the live take is one of the rows it was counted from.
  return live.map((row) => ({ ...row, takes: takes.get(row.file) ?? 1 }));
}

/** The version of the live take of one file, or null when it has never been generated. */
export async function liveVersion(
  source: Source,
  file: string,
  lang: Lang = BASE_LANG,
): Promise<number | null> {
  const rows = await readAs<{ version: number }>(
    lang,
    `select "version" from "take"
      where "source" = $1 and "file" = $2 and "lang" = $3 and "isCurrent"`,
    [source, file, lang],
  );
  return rows[0]?.version ?? null;
}

/**
 * Make one take the live one.
 *
 * In a transaction, because clearing the old flag and setting the new one must not half
 * apply: `take_team_current_idx` allows exactly one live take per file, so a half-applied pair
 * would either leave the file with none -- the export then ships nothing for that line --
 * or make the next write fail against the index, which looks like a bug in the next run
 * rather than in this one.
 *
 * `by` is who asked, for the activity log: moving the flag writes no take row, so this is
 * the only record that a restore happened at all.
 */
export async function setLiveTake(
  source: Source,
  file: string,
  version: number,
  lang: Lang,
  by: string | null,
): Promise<void> {
  await asTeamOf(lang, async (client) => {
    const { rows: was } = await client.query<{ version: number }>(
      `update "take" set "isCurrent" = false
        where "source" = $1 and "file" = $2 and "lang" = $3 and "isCurrent"
        returning "version"`,
      [source, file, lang],
    );
    const { rows: now } = await client.query<{ lineId: string }>(
      `update "take" set "isCurrent" = true
        where "source" = $1 and "file" = $2 and "lang" = $3 and "version" = $4
        returning "lineId"`,
      [source, file, lang, version],
    );
    if (now.length === 0) {
      throw new Error(`no version ${version} of ${file} in ${source}`);
    }
    // Readables pages folded into one another have takes under two files; one stays live.
    if (source === "readables") {
      await client.query(
        `update "take" set "isCurrent" = false
          where "source" = 'readables' and "lineId" = $1 and "lang" = $2 and "isCurrent" and "file" <> $3`,
        [now[0].lineId, lang, file],
      );
    }
    await recordActivity(
      {
        kind: "take.restored",
        lang,
        source,
        subject: file,
        lineId: now[0].lineId,
        actorId: by,
        detail: { version, from: was[0]?.version ?? null },
      },
      client,
    );
  });
}

/** Where one take's bytes are, or why there are none to read. */
export type TakeBytes =
  | Stored
  /** No such take was ever recorded. */
  | { kind: "none" };

/**
 * Where one take's bytes are, from its row alone -- the live take exactly like any other.
 *
 *   - reading from the bucket and sha256 set: that object
 *   - archiveFile set: that file in the line's history directory
 *   - not set: the take happened and its clip was not kept -- pruned by the code before
 *     this branch, consumed by its rename-to-restore, or retired somewhere this archive
 *     never saw. Known to be gone, so nothing is looked for.
 *
 * Whether a named file is really there is answered by whoever reads it.
 */
export async function takePath(
  source: Source,
  file: string,
  version: number,
  lang: Lang = BASE_LANG,
): Promise<TakeBytes> {
  const rows = await readAs<Located>(
    lang,
    `select "archiveFile", "sha256" from "take"
      where "source" = $1 and "file" = $2 and "lang" = $3 and "version" = $4`,
    [source, file, lang, version],
  );
  return located(source, file, lang, rows[0]);
}

/** The live take's bytes, the way takePath finds any take's. What the live audio routes play. */
export async function livePath(source: Source, file: string, lang: Lang = BASE_LANG): Promise<TakeBytes> {
  const rows = await readAs<Located>(
    lang,
    `select "archiveFile", "sha256" from "take"
      where "source" = $1 and "file" = $2 and "lang" = $3 and "isCurrent"`,
    [source, file, lang],
  );
  return located(source, file, lang, rows[0]);
}

type Located = { archiveFile: string | null; sha256: string | null };

function located(source: Source, file: string, lang: Lang, take: Located | undefined): TakeBytes {
  if (!take) return { kind: "none" };
  return blobOrFile("takes", take.sha256, take.archiveFile && path.join(historyDirOf(source, file, lang), take.archiveFile));
}
