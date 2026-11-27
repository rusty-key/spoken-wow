/**
 * What /listen reads and writes. Always the language's default team, whoever is looking: a link
 * to the page shows everyone the same voices, and a member of a second team votes on them too.
 */
import "server-only";

import { queryIn, withTeam, type TeamId } from "@/lib/db";
import type { Lang } from "@/lib/lang";
import { defaultTeamOf } from "@/lib/teams/store";
import { corpus } from "@/lib/quests/catalogue";
import { flavorOf } from "@/lib/voice-design/groups";
import { slotExamples } from "@/lib/voice-design/lines";
import { NEWEST_SHOWING } from "@/lib/voice-design/store";
import type { GeminiResult, Verdict } from "@/lib/voice-design/types";

export type PublicVoice = {
  slot: string;
  race: string;
  gender: string;
  flavor: string | null;
  archetype: string | null;
  /** The NPCs who speak the most lines in this voice: who players will hear it from. */
  examples: string[];
  showingId: number;
  samples: { sha256: string; text: string; npcName: string | null }[];
};

export type OwnVote = { verdict: Verdict; note: string };

export class VoteError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

/** The team whose shown voices /listen plays; Show to players refuses any other. */
export async function listenTeamOf(lang: Lang): Promise<TeamId | undefined> {
  return (await defaultTeamOf(lang))?.id;
}

/** Gemini's blind analysis labels each slot by a letter; its archetype for `slot`, if any. */
function archetypeIn(labels: Record<string, string>, result: GeminiResult, slot: string): string | null {
  const letter = Object.entries(labels).find(([, labelled]) => labelled === slot)?.[0];
  return (letter && result.voices[letter]?.archetype) || null;
}

export async function publicVoices(lang: Lang): Promise<PublicVoice[]> {
  const team = await listenTeamOf(lang);
  if (!team) return [];
  const shown = await queryIn<{ showingId: string; slot: string; designId: string; analysis: Record<string, unknown> | null }>(
    team,
    `select s."id" as "showingId", s."slot", d."id" as "designId", d."analysis"
       from "voice_design_showing" s join "voice_design" d on d."id" = s."designId"
      where s."lang" = $1 and s."id" = ${NEWEST_SHOWING}
      order by s."slot"`,
    [lang],
  );
  if (shown.length === 0) return [];
  const [samples, analyses, { lines }] = await Promise.all([
    queryIn<{ designId: string; sha256: string; text: string | null; npcName: string | null }>(
      team,
      `select "designId", "sha256", "text", "npcName" from "voice_design_clip"
        where "designId" = any($1::uuid[]) and "kind" = 'sample' order by "position"`,
      [shown.map((row) => row.designId)],
    ),
    queryIn<{ labels: Record<string, string>; result: GeminiResult }>(
      team,
      `select distinct on ("group") "labels", "result" from "voice_design_analysis"
        where "lang" = $1 order by "group", "createdAt" desc`,
      [lang],
    ),
    corpus(lang),
  ]);
  const examples = slotExamples(lines, shown.map((row) => row.slot));
  return shown.map((row) => {
    const [race, gender] = row.slot.split("-");
    const own = typeof row.analysis?.archetype === "string" && row.analysis.archetype ? row.analysis.archetype : null;
    return {
      slot: row.slot,
      race,
      gender,
      flavor: flavorOf(row.slot),
      archetype: own ?? analyses.map((a) => archetypeIn(a.labels, a.result, row.slot)).find(Boolean) ?? null,
      examples: examples.get(row.slot) ?? [],
      showingId: Number(row.showingId),
      samples: samples
        .filter((sample) => sample.designId === row.designId)
        .map((sample) => ({ sha256: sample.sha256, text: sample.text ?? "", npcName: sample.npcName })),
    };
  });
}

/** Only the lines players hear now are public; drafts and older versions stay private. */
export async function isPublicClip(lang: Lang, sha256: string): Promise<boolean> {
  const team = await listenTeamOf(lang);
  if (!team) return false;
  const rows = await queryIn(
    team,
    `select 1 from "voice_design_showing" s
       join "voice_design_clip" c on c."designId" = s."designId" and c."kind" = 'sample'
      where s."lang" = $1 and c."sha256" = $2 and s."id" = ${NEWEST_SHOWING}
      limit 1`,
    [lang, sha256],
  );
  return rows.length > 0;
}

/**
 * One vote per voter per showing; a second replaces the first. A showing players no longer hear
 * refuses, so a tab left open over a new version cannot vote on audio that is gone.
 */
export async function castVote(
  lang: Lang,
  vote: { showingId: number; voter: string; userId: string | null; verdict: Verdict; note: string },
): Promise<void> {
  const team = await listenTeamOf(lang);
  if (!team) throw new VoteError("no such voice", 404);
  await withTeam(team, async (client) => {
    const { rows } = await client.query<{ current: boolean }>(
      `select s."id" = ${NEWEST_SHOWING} as "current" from "voice_design_showing" s where s."id" = $1 and s."lang" = $2`,
      [vote.showingId, lang],
    );
    if (!rows[0]) throw new VoteError("no such voice", 404);
    if (!rows[0].current) throw new VoteError("This voice has a newer version. Reload the page to hear it.", 409);
    await client.query(
      `insert into "voice_feedback" ("showingId", "teamId", "voter", "userId", "verdict", "note")
       values ($1, $2, $3, $4, $5, $6)
       on conflict ("showingId", "voter") do update
         set "verdict" = excluded."verdict", "note" = excluded."note", "userId" = excluded."userId", "updatedAt" = now()`,
      [vote.showingId, team, vote.voter, vote.userId, vote.verdict, vote.note],
    );
  });
}

export async function votesOf(lang: Lang, voter: string): Promise<Record<number, OwnVote>> {
  const team = await listenTeamOf(lang);
  if (!team) return {};
  const rows = await queryIn<{ showingId: string; verdict: Verdict; note: string }>(
    team,
    `select f."showingId", f."verdict", f."note" from "voice_feedback" f
       join "voice_design_showing" s on s."id" = f."showingId"
      where f."voter" = $1 and s."lang" = $2`,
    [voter, lang],
  );
  return Object.fromEntries(rows.map((row) => [Number(row.showingId), { verdict: row.verdict, note: row.note }]));
}
