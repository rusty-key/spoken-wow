/**
 * The roster from migration 0071's tables, cached per process: every catalogue read and every
 * triage row asks it, and it changes only when an admin edits a type (api/types), which drops
 * this process's copy. The other pm2 worker keeps its own until TTL_MS runs out.
 */
import { db } from "@/lib/db";

import { Roster, type Gender, type RosterData } from "./roster";

const TTL_MS = 30_000;
const cacheKey = Symbol.for("spoken.roster");
type Holder = { [cacheKey]?: { at: number; roster: Roster } };
const holder = globalThis as Holder;

export async function rosterData(): Promise<RosterData> {
  const q = db();
  const [races, genders, flavors, voices, assignments] = await Promise.all([
    q.query<{ key: string; label: string | null }>(`select "key", "label" from "race" order by "key"`),
    q.query<{ race: string; gender: Gender }>(`select "race", "gender" from "gender"`),
    q.query<RosterData["flavors"][number]>(
      `select "race", "gender", "flavor", "label" from "flavor" order by 1, 2, 3`,
    ),
    q.query<RosterData["voices"][number]>(`select "name", "label", "race", "gender" from "voice" order by 1`),
    q.query<RosterData["assignments"][number]>(
      `select "race", "gender", "flavor", "voice" from "voice_assignment" order by 1, 2, 3`,
    ),
  ]);
  return {
    races: races.rows.map((race) => ({
      ...race,
      genders: genders.rows.filter((g) => g.race === race.key).map((g) => g.gender).sort(),
    })),
    flavors: flavors.rows,
    voices: voices.rows,
    assignments: assignments.rows,
  };
}

export async function loadRoster(): Promise<Roster> {
  const hit = holder[cacheKey];
  if (hit && Date.now() - hit.at < TTL_MS) return hit.roster;
  const roster = new Roster(await rosterData());
  holder[cacheKey] = { at: Date.now(), roster };
  return roster;
}

export function invalidateRoster(): void {
  delete holder[cacheKey];
}
