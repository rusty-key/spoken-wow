/**
 * For tests: a language moved onto a team of its own, and back. On a test database every
 * language shares the english team, so only a moved language makes "the job's team" observable.
 */
import { db } from "@/lib/db";
import type { Lang } from "@/lib/lang";

import { forgetTeams, type TeamId } from "./store";

/** Tables a test may leave rows in under the borrowed team, deleted before the team is. */
const STAMPED = [
  "regeneration_pause", "regeneration_batch", "take_ack", "take", "recording", "activity", "report", "line_ignore",
  "voice_assignment", "voice", "generation_setting", "queue_dismissal",
];

/**
 * What every team has a copy of, copied from the english team as migration 0089 copied it to
 * every team: the roster, the base generation settings and the dismissal mark.
 */
const COPIED = [
  `insert into "voice" ("teamId", "name", "race", "gender")
   select $1, "name", "race", "gender" from "voice" where "teamId" = $2`,
  `insert into "voice_assignment" ("teamId", "race", "gender", "flavor", "voice")
   select $1, "race", "gender", "flavor", "voice" from "voice_assignment" where "teamId" = $2`,
  `insert into "generation_setting" ("teamId", "modelId", "voiceSettings", "seedStrategy", "raceTags", "updatedBy")
   select $1, "modelId", "voiceSettings", "seedStrategy", "raceTags", "updatedBy"
     from "generation_setting" where "teamId" = $2`,
  `insert into "queue_dismissal" ("teamId", "throughJobId", "dismissedBy")
   select $1, "throughJobId", "dismissedBy" from "queue_dismissal" where "teamId" = $2`,
];

export async function ownTeam(lang: Lang): Promise<{ team: TeamId; restore: () => Promise<void> }> {
  const slug = `test-${lang.toLowerCase()}-${Math.random().toString(36).slice(2, 8)}`;
  const { rows } = await db().query<{ id: TeamId }>(
    `insert into "team" ("slug", "name") values ($1, $1) returning "id"`,
    [slug],
  );
  const team = rows[0].id;
  const { rows: was } = await db().query<{ teamId: TeamId }>(
    `delete from "team_language" where "lang" = $1 and "privileged" returning "teamId"`,
    [lang],
  );
  await db().query(`insert into "team_language" ("teamId", "lang") values ($1, $2)`, [team, lang]);
  const { rows: english } = await db().query<{ id: TeamId }>(`select "id" from "team" where "slug" = 'english'`);
  for (const sql of COPIED) await db().query(sql, [team, english[0].id]);
  forgetTeams();

  return {
    team,
    async restore() {
      for (const table of STAMPED) {
        await db().query(`delete from "${table}" where "teamId" = $1`, [team]);
      }
      await db().query(`delete from "team_language" where "teamId" = $1`, [team]);
      if (was[0]) {
        await db().query(`insert into "team_language" ("teamId", "lang") values ($1, $2)`, [was[0].teamId, lang]);
      }
      await db().query(`delete from "team" where "id" = $1`, [team]);
      forgetTeams();
    },
  };
}
