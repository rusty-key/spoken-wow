/**
 * A take's clip cut into sentence pieces as its pack ships them, so a paused line resumes from its
 * sentence (addons/Spoken/SoundQueue.lua). Cut at commit, beside the whole clip's encoding
 * (./encode), and by the backfill for takes committed before or whose cut failed
 * (scripts/cut-pieces.mts).
 *
 * The master is decoded once. A take with word times that fit its words is cut at its sentences'
 * first words; any other at its measured pauses (./cuts). Each piece is encoded from the decoded
 * audio with the whole clip's recipe, so a cut lands on the sample asked for and the audio is
 * encoded once, as the whole clip is. A take neither way finds a cut in is recorded "whole": its
 * line ships as one file.
 *
 * Best effort, as the encoding is: a line with no pieces ships whole, which plays as it always has.
 */
import "server-only";

import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { archive, blobKey, sha256Of } from "@/lib/blobs/store";
import { putArchived } from "@/lib/blobs/keep";
import { blobBytes } from "@/lib/blobs/where";
import { ALL_TEAMS, query, queryIn, type TeamId } from "@/lib/db";
import type { Lang } from "@/lib/lang";
import { speakQuestTokens } from "@/lib/player-words";
import type { Source } from "@/lib/sections";
import { asTeam } from "@/lib/teams/acting";

import { withLocalCopy } from "./bytes";
import { CUTS, NOISE_DB, SNAP_PAUSE, chooseCuts, chooseTimedCuts, parseSilences, snapToPauses } from "./cuts";
import { ENCODERS, PROFILE, encodeOggFrom, oggDurationSec, type Encoders } from "./encode";

const run = promisify(execFile);

/** One decode or measure; a piece's encode has encode.ts's own limit. */
const STEP_TIMEOUT_MS = 60_000;

export type Method = "times" | "pauses" | "whole";

export type Pieces = {
  method: Method;
  /** One per piece, in order; none for "whole". */
  pieces: { encodedSha256: string; bytes: number; lengthSec: number }[];
};

/** What the cut reads off its take besides the audio: the words the times are counted against. */
export type Words = { shownText?: string | null; wordTimes?: readonly number[] | null };

/** The take a cut is for, so a failure names it. */
export type CutTake = Words & { lang: Lang; file: string; version: number };

/** Seconds of 16-bit PCM in a WAV ffmpeg wrote: its data chunk over its byte rate. */
export function wavDurationSec(bytes: Buffer): number {
  if (bytes.toString("latin1", 0, 4) !== "RIFF" || bytes.toString("latin1", 8, 12) !== "WAVE") {
    throw new Error("not a WAV");
  }
  let byteRate = 0;
  for (let at = 12; at + 8 <= bytes.length; ) {
    const id = bytes.toString("latin1", at, at + 4);
    const size = bytes.readUInt32LE(at + 4);
    if (id === "fmt ") byteRate = bytes.readUInt32LE(at + 16);
    if (id === "data") {
      if (!byteRate) throw new Error("a WAV with no format before its data");
      return Math.min(size, bytes.length - at - 8) / byteRate;
    }
    at += 8 + size + (size % 2);
  }
  throw new Error("a WAV with no data");
}

/** The pauses in `wav` as [start, end] seconds, `shortest` long or longer. */
async function measurePauses(wav: string, tools: Encoders, shortest: number): Promise<[number, number][]> {
  // silencedetect reports at info level: a quieter log level would hide it.
  const { stderr } = await run(
    tools.ffmpeg,
    ["-hide_banner", "-nostats", "-nostdin", "-i", wav, "-af", `silencedetect=noise=${NOISE_DB}dB:d=${shortest}`, "-f", "null", "-"],
    { timeout: STEP_TIMEOUT_MS, maxBuffer: 8 * 1024 * 1024 },
  );
  return parseSilences(stderr);
}

/**
 * Cuts `master`, an mp3, and encodes each piece. Returns the method, and the pieces' Oggs in order
 * (none for "whole"). Throws on any tool's failure.
 */
export async function cutPieces(
  master: string,
  words: Words,
  tools: Encoders = ENCODERS,
): Promise<{ method: Method; oggs: Buffer[] }> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "spoken-pieces-"));
  try {
    const wav = path.join(dir, "clip.wav");
    await run(tools.ffmpeg, ["-nostdin", "-loglevel", "error", "-f", "mp3", "-i", master, "-ac", "1", "-f", "wav", wav], {
      timeout: STEP_TIMEOUT_MS,
    });
    const duration = wavDurationSec(await fs.readFile(wav));
    let method: Method = "times";
    let cuts = words.shownText && words.wordTimes ? chooseTimedCuts(words.shownText, words.wordTimes, duration) : null;
    if (cuts?.length) {
      // Word times can be a little off, so each cut is checked against the audio itself.
      cuts = snapToPauses(cuts, await measurePauses(wav, tools, SNAP_PAUSE), duration);
    } else if (cuts === null) {
      method = "pauses";
      cuts = chooseCuts(await measurePauses(wav, tools, Math.min(CUTS.minPause, CUTS.fallbackPause || CUTS.minPause)), duration);
    }
    if (cuts.length === 0) return { method: "whole", oggs: [] };
    const bounds = [0, ...cuts, duration];
    const oggs: Buffer[] = [];
    for (let i = 0; i + 1 < bounds.length; i++) {
      // After -i, so the seek decodes up to it and lands on the sample; the last runs to the end.
      const span = ["-ss", bounds[i].toFixed(3), ...(i + 2 < bounds.length ? ["-to", bounds[i + 1].toFixed(3)] : [])];
      oggs.push(await encodeOggFrom(["-i", wav, ...span], tools));
    }
    return { method, oggs };
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

async function recorded(source: Source, sha256: string): Promise<Pieces | undefined> {
  const [row] = await query<{ method: Method; encodedSha256s: string[]; bytes: number[]; lengthsSec: string[] }>(
    `select "method", "encodedSha256s", "bytes", "lengthsSec"::float8[] as "lengthsSec" from "take_pieces"
      where "source" = $1 and "sha256" = $2 and "profile" = $3`,
    [source, sha256, PROFILE],
  );
  if (!row) return undefined;
  return {
    method: row.method,
    pieces: row.encodedSha256s.map((encodedSha256, i) => ({
      encodedSha256,
      bytes: row.bytes[i],
      lengthSec: Number(row.lengthsSec[i]),
    })),
  };
}

/** Cuts, keeps the pieces and records them. Another caller's row wins, as for the encoding. */
async function cutAndRecord(source: Source, sha256: string, master: string, take: CutTake | undefined): Promise<Pieces> {
  const { method, oggs } = await cutPieces(master, take ?? {});
  const pieces = oggs.map((ogg) => {
    const lengthSec = oggDurationSec(ogg);
    if (!(lengthSec > 0)) throw new Error("a piece's Ogg has no length");
    return { ogg, encodedSha256: sha256Of(ogg), bytes: ogg.byteLength, lengthSec };
  });
  for (const { ogg, encodedSha256 } of pieces) {
    if (take?.lang) await putArchived("encodings", encodedSha256, ogg, "audio/ogg", take.lang);
    else await archive().put(blobKey("encodings", encodedSha256), ogg, "audio/ogg");
  }
  await query(
    `insert into "take_pieces" ("source", "sha256", "profile", "method", "encodedSha256s", "bytes", "lengthsSec")
     values ($1, $2, $3, $4, $5, $6, $7)
     on conflict ("source", "sha256", "profile") do nothing`,
    [
      source,
      sha256,
      PROFILE,
      method,
      pieces.map((p) => p.encodedSha256),
      pieces.map((p) => p.bytes),
      pieces.map((p) => p.lengthSec),
    ],
  );
  const done = await recorded(source, sha256);
  if (!done) throw new Error("its pieces were neither recorded nor found");
  return done;
}

/**
 * The take's pieces, cut now if they are not recorded yet. Never throws: a line without pieces ships
 * whole, so a failure is only logged, and the backfill tries the take again.
 */
export async function cutForPack(source: Source, sha256: string, master: string, take?: CutTake): Promise<Pieces | null> {
  try {
    return (await recorded(source, sha256)) ?? (await cutAndRecord(source, sha256, master, take));
  } catch (error) {
    const name = take ? `${take.file} v${take.version}` : sha256.slice(0, 12);
    console.warn(`cutting ${source} take ${name} into pieces failed:`, error);
    return null;
  }
}

/** The master from the archive, cut. Never throws; false when it could not be. */
async function cutFromArchive(source: Source, sha256: string, take: CutTake): Promise<boolean> {
  try {
    const master = await blobBytes(blobKey("takes", sha256), take.lang);
    if (!master) throw new Error("its audio is not in the archive's bucket");
    if (sha256Of(master) !== sha256) throw new Error("the archive's copy does not match its hash");
    return (await withLocalCopy(master, "mp3", (file) => cutForPack(source, sha256, file, take))) !== null;
  } catch (error) {
    console.warn(`cutting ${source} take ${take.file} v${take.version} into pieces failed:`, error);
    return false;
  }
}

/** For a take put back live, which may be older than cutting at commit. Never throws. */
export async function cutArchivedForPack(source: Source, sha256: string, take: CutTake): Promise<void> {
  try {
    if (await recorded(source, sha256)) return;
  } catch (error) {
    console.warn(`cutting ${source} take ${take.file} v${take.version} into pieces failed:`, error);
    return;
  }
  await cutFromArchive(source, sha256, take);
}

/**
 * The words a quests take with no shownText most likely shows: its line's current text, its tokens as
 * the voice says them, as a pack build ships for it (scripts/audio/relevant.mjs). A line edited
 * since the take was voiced has another word count than its times, and is measured instead.
 */
async function currentQuestText(lang: Lang, files: string[]): Promise<Map<string, string>> {
  if (files.length === 0) return new Map();
  const rows = await queryIn<{ stem: string; text: string; playerGender: "m" | "f" | null }>(
    ALL_TEAMS,
    `select case split_part("lineId", ':', 1) when 'q' then 'quests' when 'g' then 'gossip' when 'f' then 'followup' end
              || '/' || "fileName" as "stem", "text", "playerGender"
       from "quest_line"
      where "lang" = $1 and "isCurrent" and "fileName" = any($2::text[])
      order by "lineId", "variant"`,
    [lang, files.map((file) => path.basename(file).replace(/\.mp3$/, ""))],
  );
  const texts = new Map<string, string>();
  for (const { stem, text, playerGender } of rows) {
    const file = `${stem}.mp3`;
    if (!texts.has(file)) texts.set(file, speakQuestTokens(text, lang, playerGender));
  }
  return texts;
}

/**
 * Every live take of `team`'s in a language with no pieces recorded, cut, newest first, at most
 * 500 and for at most `budgetMs`. A take whose cut fails stays without a row, so its hash is added
 * to `failed` and a call given the same set passes over it: a caller that goes on while a call cut
 * some reaches every take once.
 */
export async function cutMissingForPack(
  source: Source,
  lang: Lang,
  team: TeamId,
  budgetMs: number,
  failed: Set<string> = new Set(),
): Promise<{ cut: number; tried: number }> {
  const until = Date.now() + budgetMs;
  const missing = await queryIn<{
    sha256: string;
    file: string;
    version: number;
    shownText: string | null;
    wordTimes: number[] | null;
  }>(
    ALL_TEAMS,
    `select distinct on (t."sha256") t."sha256", t."file", t."version", t."shownText", t."wordTimes"
       from "take" t
       left join "take_pieces" p
         on p."source" = t."source" and p."sha256" = t."sha256" and p."profile" = $3
      where t."source" = $1 and t."lang" = $2 and t."isCurrent" and t."sha256" is not null
        and t."teamId" = $4 and p."id" is null and not (t."sha256" = any($5::text[]))
      order by t."sha256", t."createdAt" desc
      limit 500`,
    [source, lang, PROFILE, team, [...failed]],
  );
  if (source === "quests") {
    const texts = await currentQuestText(lang, missing.filter((take) => !take.shownText).map((take) => take.file));
    for (const take of missing) take.shownText ??= texts.get(take.file) ?? null;
  }
  const counts = { cut: 0, tried: 0 };
  for (const { sha256, ...take } of missing) {
    if (Date.now() >= until) break;
    counts.tried++;
    // As the team: where the language has several, nobody else finds where its take is kept.
    if (await asTeam(lang, team, () => cutFromArchive(source, sha256, { lang, ...take }))) counts.cut++;
    else failed.add(sha256);
  }
  return counts;
}
