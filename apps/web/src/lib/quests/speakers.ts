/**
 * Writing who speaks a line, outside the import: a speaker a player's contribution brought in
 * (contributions/accept.ts), and one an admin added, removed or replaced by hand from the
 * explorer.
 *
 * Both are rows the importer (tts_cli/corpus_db.py) keeps when it replaces every extracted
 * speaker, marked by "contributionId" (migration 0034) or "addedBy" (0076), and both take an
 * `ord` from ORD_FLOOR up. `ord` is unique per language, the extract numbers its own rows 0..n
 * on every import, and the export lists rows in `ord` order, so these always come after it.
 *
 * A speaker is written to the line, never to a voice's id (`{lineId}~{voice}`): the catalogue
 * gives each NPC its own voice's line from the speakers of the plain one.
 *
 * Removing one of the dump's speakers deletes its rows and records it in
 * "quest_line_speaker_removed" (migration 0077), which the importer reads so the next import
 * does not put it back.
 */
import type { PoolClient } from "pg";

import { answersQuestMomentSql } from "@/lib/contributions/naming";
import { noVoice } from "@/lib/contributions/speaker";
import { inTransaction } from "@/lib/db";
import { BASE_LANG, type Lang } from "@/lib/lang";
import type { NpcRowKind } from "@/lib/npc/npc";
import { getResolution, type NpcResolution } from "@/lib/npc/store";
import type { Roster } from "@/lib/voices/roster";
import { loadRoster } from "@/lib/voices/roster-store";

export const ORD_FLOOR = 1_000_000;

/**
 * Who speaks, as a speaker row spells it. `race` and `gender` are the ones its voice's files are
 * named by (migration 0071's voice table), not the NPC's type: a gameobject reads as the
 * narrator, as every one the extract wrote does.
 */
export type Speaker = {
  npcId: number;
  npcName: string | null;
  npcType: NpcRowKind;
  race: string;
  gender: string;
  flavor: string | null;
  /** "" while no voice reads the NPC's type; nothing here writes such a speaker. */
  voice: string;
};

/**
 * The speaker an NPC's answer makes, or null when it has no type. With no voice for its type,
 * race and gender stay the NPC's own, which is what noVoice names.
 */
export function speakerFromResolution(
  resolution: NpcResolution,
  roster: Roster,
  fallbackName: string | null = null,
): Speaker | null {
  if (!resolution.race) return null;
  const voice = roster.voiceFor(resolution.race, resolution.gender, resolution.flavor);
  const family = voice ? roster.familyOf(voice) : null;
  return {
    npcId: resolution.npcId,
    npcName: resolution.npcName ?? fallbackName,
    npcType: resolution.npcKind,
    race: family?.race ?? resolution.race,
    gender: family?.gender ?? resolution.gender ?? "",
    flavor: resolution.flavor,
    voice: voice ?? "",
  };
}

/** The speaker an NPC's answer in `npc` makes, or null when it has no type. */
export async function speakerOf(npcType: NpcRowKind, npcId: number): Promise<Speaker | null> {
  // No language: a speaker is added to a moment in whichever languages it has, from the shared
  // npc answer, and its voice is named by English's roster -- every team's names the same.
  const [resolution, roster] = await Promise.all([getResolution(npcType, npcId), loadRoster(BASE_LANG)]);
  return resolution ? speakerFromResolution(resolution, roster) : null;
}

/** One writer per moment past this point, keyed by the moment's id. */
export async function lockLine(client: PoolClient, lineId: string): Promise<void> {
  await client.query(`select pg_advisory_xact_lock(hashtext('quest_line:' || $1))`, [lineId]);
}

/** A speaker row, marked by the contribution or the admin it came from. */
export async function insertSpeaker(
  client: PoolClient,
  row: {
    lineId: string;
    variant: number;
    lang: Lang;
    speaker: Speaker;
    contributionId?: number | null;
    addedBy?: string | null;
  },
): Promise<void> {
  // One writer at a time past this point, so two writes can never pick the same `ord`.
  await client.query(`select pg_advisory_xact_lock(hashtext('quest_line_speaker.contributed_ord'))`);
  const { speaker } = row;
  await client.query(
    `insert into "quest_line_speaker"
       ("lineId", "variant", "lang", "ord", "npcType", "npcId", "npcName", "race", "gender",
        "flavor", "voice", "contributionId", "addedBy")
     select $1, $2, $3,
            greatest(coalesce(max("ord") + 1, 0), $4),
            $5, $6, $7, $8, $9, $10, $11, $12, $13
       from "quest_line_speaker" where "lang" = $3`,
    [
      row.lineId, row.variant, row.lang, ORD_FLOOR, speaker.npcType, speaker.npcId,
      speaker.npcName ?? `npc ${speaker.npcId}`, speaker.race, speaker.gender, speaker.flavor,
      speaker.voice, row.contributionId ?? null, row.addedBy ?? null,
    ],
  );
}

export type SpeakerRow = {
  lineId: string;
  variant: number;
  lang: string;
  npcType: string;
  npcId: number;
  addedBy: string | null;
  contributionId: number | null;
};

/**
 * Every speaker row of a moment's lines (the plain one and its `:m`/`:f`), English's first and
 * each language's in `ord` order.
 */
export async function momentSpeakers(client: PoolClient, moment: string): Promise<SpeakerRow[]> {
  const { rows } = await client.query<SpeakerRow>(
    `select "lineId", "variant", "lang", "npcType", "npcId", "addedBy", "contributionId"
       from "quest_line_speaker"
      where ${answersQuestMomentSql(`"lineId"`, "$1")}
      order by "lang" <> $2, "ord"`,
    [moment, BASE_LANG],
  );
  return rows;
}

/**
 * Whether the NPC is one of a moment's speakers. With no kind (an envelope that names none) it
 * is matched by id alone, as idOnlyResolution answers it. accept.ts's momentHasSpeaker asks the
 * same in SQL, for a page of rows at once.
 */
export function speaksMoment(rows: SpeakerRow[], npcId: number, npcKind: string | null): boolean {
  return rows.some((row) => row.npcId === npcId && (!npcKind || row.npcType === npcKind));
}

type Npc = { npcType: NpcRowKind; npcId: number };

function isNpc(row: { npcType: string; npcId: number }, npc: Npc): boolean {
  return row.npcType === npc.npcType && row.npcId === npc.npcId;
}

/**
 * Makes `speaker` one more speaker of the moment, beside the ones it has: on each of its lines
 * (both player-gender sides of a split one) and each variant, in the language its speakers are
 * in. That is English's wherever English has any, since the catalogue reads only English's
 * speakers of such a line, and otherwise the first language that wrote one.
 *
 * Returns "spoken" when the NPC already speaks it, "unknown" when the moment has no speaker to
 * stand beside -- a line is in the explorer only through its speakers -- and "added" otherwise.
 * The caller holds the moment's lock, and passes the moment's speakers when it already read them.
 */
export async function addToMoment(
  client: PoolClient,
  moment: string,
  speaker: Speaker,
  mark: { contributionId?: number | null; addedBy?: string | null },
  rows?: SpeakerRow[],
): Promise<"added" | "spoken" | "unknown"> {
  rows ??= await momentSpeakers(client, moment);
  if (rows.length === 0) return "unknown";
  if (speaksMoment(rows, speaker.npcId, speaker.npcType)) return "spoken";

  const lang = rows[0].lang as Lang;
  const targets = new Map<string, { lineId: string; variant: number }>();
  for (const row of rows) {
    if (row.lang === lang) targets.set(`${row.lineId}|${row.variant}`, { lineId: row.lineId, variant: row.variant });
  }
  for (const target of targets.values()) await insertSpeaker(client, { ...target, lang, speaker, ...mark });
  // Adding a speaker back is what takes a removal back: the next import keeps the dump's row again.
  await client.query(
    `delete from "quest_line_speaker_removed" where "moment" = $1 and "npcType" = $2 and "npcId" = $3`,
    [moment, speaker.npcType, speaker.npcId],
  );
  return "added";
}

export type AddOutcome =
  | { ok: true; speaker: Speaker }
  | { ok: false; reason: "unknown-line" | "spoken" | "no-voice"; message: string };

/** The speaker an NPC makes, or why it makes none: a speaker is written with its voice. */
async function voicedSpeaker(npc: Npc): Promise<Speaker | { ok: false; reason: "no-voice"; message: string }> {
  const speaker = await speakerOf(npc.npcType, npc.npcId);
  if (speaker?.voice) return speaker;
  return { ok: false, reason: "no-voice", message: speaker ? noVoice(speaker) : "This NPC has no type yet" };
}

/**
 * An admin adds an NPC as one more speaker of a line, from the explorer. The NPC must already
 * be answered (`npc`) with a type a voice reads: a speaker is written with its voice, and the
 * catalogue gives it its own voice's line from there.
 */
export async function addSpeaker(args: {
  moment: string;
  npcType: NpcRowKind;
  npcId: number;
  addedBy: string;
}): Promise<AddOutcome> {
  const speaker = await voicedSpeaker(args);
  if ("ok" in speaker) return speaker;
  const outcome = await inTransaction(async (client) => {
    await lockLine(client, args.moment);
    return addToMoment(client, args.moment, speaker, { addedBy: args.addedBy });
  });
  if (outcome === "unknown") return { ok: false, reason: "unknown-line", message: "unknown line" };
  if (outcome === "spoken") return { ok: false, reason: "spoken", message: "This NPC already speaks the line" };
  return { ok: true, speaker };
}

export type RemoveOutcome =
  | { ok: true; removed: number; npcName: string | null }
  | { ok: false; reason: "last"; message: string };

/**
 * Takes an NPC off a moment, every line and language of it, while another NPC still speaks it in
 * each of those languages: a line is in the explorer only through its speakers. A speaker of the
 * dump's or a contribution's is recorded as removed, so no import brings it back. The caller
 * holds the moment's lock.
 *
 * A line's file was made in its first speaker's voice, as the site and the pack build read it, so
 * when that speaker goes the next one inherits the voice its row is written with. The file then
 * stays the old voice's, each speaker keeps its own voice's line and takes, and a pack plays the
 * old file for a speaker whose own has no audio yet.
 */
async function removeFromMoment(
  client: PoolClient,
  args: Npc & { moment: string; removedBy: string },
): Promise<RemoveOutcome> {
  const rows = await momentSpeakers(client, args.moment);
  const ofNpc = rows.filter((row) => isNpc(row, args));
  if (ofNpc.length === 0) return { ok: true, removed: 0, npcName: null };
  const langs = new Set(ofNpc.map((row) => row.lang));
  if ([...langs].some((lang) => !rows.some((row) => row.lang === lang && !isNpc(row, args)))) {
    return { ok: false, reason: "last", message: "A line needs a speaker: add another before removing this one" };
  }

  await client.query(
    `with "owner" as (
       select distinct on ("lineId", "variant", "lang") "lineId", "variant", "lang", "npcType", "npcId", "voice"
         from "quest_line_speaker" where ${answersQuestMomentSql(`"lineId"`, "$1")}
        order by "lineId", "variant", "lang", "ord", "id"
     ), "heir" as (
       select distinct on (s."lineId", s."variant", s."lang") s."id", o."voice"
         from "quest_line_speaker" s
         join "owner" o using ("lineId", "variant", "lang")
        where o."npcType" = $2 and o."npcId" = $3 and not (s."npcType" = $2 and s."npcId" = $3)
        order by s."lineId", s."variant", s."lang", s."ord", s."id"
     )
     update "quest_line_speaker" s set "voice" = h."voice" from "heir" h where s."id" = h."id"`,
    [args.moment, args.npcType, args.npcId],
  );

  const { rows: removed } = await client.query<{ npcName: string | null; byHand: boolean }>(
    `delete from "quest_line_speaker"
      where ${answersQuestMomentSql(`"lineId"`, "$1")} and "npcType" = $2 and "npcId" = $3
      returning "npcName", "addedBy" is not null as "byHand"`,
    [args.moment, args.npcType, args.npcId],
  );
  if (removed.some((row) => !row.byHand)) {
    await client.query(
      `insert into "quest_line_speaker_removed" ("moment", "npcType", "npcId", "removedBy")
       values ($1, $2, $3, $4) on conflict do nothing`,
      [args.moment, args.npcType, args.npcId, args.removedBy],
    );
  }
  return { ok: true, removed: removed.length, npcName: removed[0]?.npcName ?? null };
}

export async function removeSpeaker(args: Npc & { moment: string; removedBy: string }): Promise<RemoveOutcome> {
  return inTransaction(async (client) => {
    await lockLine(client, args.moment);
    return removeFromMoment(client, args);
  });
}

export type ReplaceOutcome =
  | { ok: true; speaker: Speaker; npcName: string | null }
  | { ok: false; reason: "unknown-line" | "no-voice" | "last" | "same" | "gone"; message: string };

/** Carries a refusal out of the transaction, so the add before it is rolled back. */
class Refused extends Error {
  constructor(readonly outcome: Extract<ReplaceOutcome, { ok: false }>) {
    super(outcome.message);
  }
}

/**
 * The new NPC is added before the old one goes, so the line always has a speaker. It inherits the
 * old one's file (removeFromMoment), so the line shows as missing in its own voice until that is
 * generated, and the addon plays the old file until then.
 */
export async function replaceSpeaker(args: { moment: string; from: Npc; to: Npc; by: string }): Promise<ReplaceOutcome> {
  if (isNpc(args.from, args.to)) return { ok: false, reason: "same", message: "That is the speaker already" };
  const speaker = await voicedSpeaker(args.to);
  if ("ok" in speaker) return speaker;
  try {
    return await inTransaction(async (client): Promise<ReplaceOutcome> => {
      await lockLine(client, args.moment);
      // "spoken" is no failure: the new NPC already speaks the line, and only the old one has to go.
      const added = await addToMoment(client, args.moment, speaker, { addedBy: args.by });
      if (added === "unknown") return { ok: false, reason: "unknown-line", message: "unknown line" };
      const removed = await removeFromMoment(client, { moment: args.moment, ...args.from, removedBy: args.by });
      if (!removed.ok) throw new Refused(removed);
      // Taken off by somebody else meanwhile: the add alone would be no replace.
      if (removed.removed === 0) {
        throw new Refused({ ok: false, reason: "gone", message: "That NPC no longer speaks the line" });
      }
      return { ok: true, speaker, npcName: removed.npcName };
    });
  } catch (error) {
    if (error instanceof Refused) return error.outcome;
    throw error;
  }
}
