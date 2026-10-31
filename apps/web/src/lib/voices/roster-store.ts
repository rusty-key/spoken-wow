/**
 * The roster from migration 0071's tables, kept per process and checked against ROSTER_STAMP on
 * every read, as lib/stamp.ts's memos are: an admin's edit on one pm2 worker is seen by the other
 * on its next read, and an unchanged roster stays the same instance, so whatever is keyed on it
 * (slots.ts) keeps.
 *
 * Races, genders and flavors are every team's; the voices and the assignments are a team's own,
 * read as the team whose roster a language is voiced from (rosterTeam).
 */
import type { PoolClient } from "pg";

import { queryIn, withTeam } from "@/lib/db";
import { BASE_LANG, type Lang } from "@/lib/lang";
import { teamOf, type TeamId } from "@/lib/teams/store";

import { Roster, type Gender, type RosterData } from "./roster";

/**
 * Everything a roster is made of, in one cheap value: its few dozen assignments hashed whole,
 * and the counts of the rows they can name. Also part of the catalogue's stamp, which the roster
 * voices.
 */
export const ROSTER_STAMP = `(select md5(coalesce(string_agg(k, ',' order by k), ''))
     from (select a."race" || ':' || coalesce(a."gender", '') || ':' || coalesce(a."flavor", '') ||
                  ':' || a."voice" as k
             from "voice_assignment" a) assignments) || ':' ||
  (select count(*) from "race") || ':' || (select count(*) from "gender") || ':' ||
  (select count(*) from "flavor") || ':' || (select count(*) from "voice")`;

/**
 * The team whose roster `lang` is voiced from, and the one its edits are written as. The
 * english team's for every language: there is one roster, and its rows are that team's.
 */
export async function rosterTeam(_lang: Lang): Promise<TeamId> {
  return teamOf(BASE_LANG);
}

const cacheKey = Symbol.for("spoken.roster.by-team");
type Holder = { [cacheKey]?: Map<TeamId, { stamp: string; roster: Promise<Roster> }> };
const holder = globalThis as Holder;

/** One client, in turn: a pooled read per table would each pay withTeam's own round trips. */
async function rosterData(client: PoolClient): Promise<RosterData> {
  const races = await client.query<{ key: string }>(`select "key" from "race" order by "key"`);
  const genders = await client.query<{ race: string; gender: Gender }>(
    `select "race", "gender" from "gender" order by 1, 2`,
  );
  const flavors = await client.query<RosterData["flavors"][number]>(
    `select "race", "gender", "flavor" from "flavor" order by 1, 2, 3`,
  );
  const voices = await client.query<RosterData["voices"][number]>(
    `select "name", "race", "gender" from "voice" order by 1`,
  );
  const assignments = await client.query<RosterData["assignments"][number]>(
    `select "race", "gender", "flavor", "voice" from "voice_assignment" order by 1, 2, 3`,
  );
  return {
    races: races.rows.map(({ key }) => ({
      key,
      genders: genders.rows.filter((g) => g.race === key).map((g) => g.gender),
    })),
    flavors: flavors.rows,
    voices: voices.rows,
    assignments: assignments.rows,
  };
}

export async function loadRoster(lang: Lang): Promise<Roster> {
  const team = await rosterTeam(lang);
  const [{ stamp }] = await queryIn<{ stamp: string }>(team, `select ${ROSTER_STAMP} as "stamp"`);
  const memo = (holder[cacheKey] ??= new Map());
  const hit = memo.get(team);
  if (hit?.stamp === stamp) return hit.roster;
  const roster = withTeam(team, rosterData).then((data) => new Roster(data));
  memo.set(team, { stamp, roster });
  // A failed read is not the answer until the tables next move.
  roster.catch(() => {
    if (memo.get(team)?.roster === roster) memo.delete(team);
  });
  return roster;
}
