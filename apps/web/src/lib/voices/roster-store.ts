/**
 * The roster from migration 0071's tables, kept per process and checked against ROSTER_STAMP on
 * every read, as lib/stamp.ts's memos are: an admin's edit on one pm2 worker is seen by the other
 * on its next read, and an unchanged roster stays the same instance, so whatever is keyed on it
 * (slots.ts) keeps.
 */
import { db } from "@/lib/db";

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

const cacheKey = Symbol.for("spoken.roster");
type Holder = { [cacheKey]?: { stamp: string; roster: Promise<Roster> } };
const holder = globalThis as Holder;

async function rosterData(): Promise<RosterData> {
  const q = db();
  const [races, genders, flavors, voices, assignments] = await Promise.all([
    q.query<{ key: string }>(`select "key" from "race" order by "key"`),
    q.query<{ race: string; gender: Gender }>(`select "race", "gender" from "gender" order by 1, 2`),
    q.query<RosterData["flavors"][number]>(`select "race", "gender", "flavor" from "flavor" order by 1, 2, 3`),
    q.query<RosterData["voices"][number]>(`select "name", "race", "gender" from "voice" order by 1`),
    q.query<RosterData["assignments"][number]>(
      `select "race", "gender", "flavor", "voice" from "voice_assignment" order by 1, 2, 3`,
    ),
  ]);
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

export async function loadRoster(): Promise<Roster> {
  const { rows } = await db().query<{ stamp: string }>(`select ${ROSTER_STAMP} as "stamp"`);
  const stamp = rows[0].stamp;
  const hit = holder[cacheKey];
  if (hit?.stamp === stamp) return hit.roster;
  const roster = rosterData().then((data) => new Roster(data));
  holder[cacheKey] = { stamp, roster };
  // A failed read is not the answer until the tables next move.
  roster.catch(() => {
    if (holder[cacheKey]?.roster === roster) delete holder[cacheKey];
  });
  return roster;
}
