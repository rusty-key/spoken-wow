/**
 * Show to players (migration 0136): each press is a showing, and a slot's newest showing is the
 * version /listen plays. Written as the caller's team, like every other workbench write.
 */
import "server-only";

import type { Lang } from "@/lib/lang";
import { asTeamOf } from "@/lib/teams/store";
import { isUuid } from "@/lib/uuid";
import { DesignError } from "@/lib/voice-design/access";

import { queueNotices } from "./follow";

/** `replaced` when the slot was already public, so voters of the earlier round may hear of it. */
export async function showVersion(lang: Lang, designId: string, userId: string): Promise<{ showingId: number; replaced: boolean }> {
  if (!isUuid(designId)) throw new DesignError("no such design", 404);
  return asTeamOf(lang, async (client) => {
    const { rows } = await client.query<{ slot: string; samples: number }>(
      `select d."slot", (select count(*)::int from "voice_design_clip" c where c."designId" = d."id" and c."kind" = 'sample') as "samples"
         from "voice_design" d where d."id" = $1 and d."lang" = $2`,
      [designId, lang],
    );
    const design = rows[0];
    if (!design) throw new DesignError("no such design", 404);
    // Players vote on these lines; a version without them has nothing to play.
    if (design.samples === 0) throw new DesignError("Voice the sample lines before showing this version to players.");
    // Two presses at once on one slot would both think they were first.
    await client.query(`select pg_advisory_xact_lock(hashtext('voice_design:' || $1 || ':' || $2))`, [lang, design.slot]);
    const earlier = await client.query(`select 1 from "voice_design_showing" where "lang" = $1 and "slot" = $2 limit 1`, [lang, design.slot]);
    const inserted = await client.query<{ id: string }>(
      `insert into "voice_design_showing" ("designId", "lang", "slot", "createdBy") values ($1, $2, $3, $4) returning "id"`,
      [designId, lang, design.slot, userId],
    );
    const showingId = Number(inserted.rows[0].id);
    const replaced = earlier.rows.length > 0;
    if (replaced) await queueNotices(client, showingId);
    return { showingId, replaced };
  });
}

/** Hides a spam note from the workbench; the verdict still counts. */
export async function hideNote(lang: Lang, showingId: number, voter: string): Promise<boolean> {
  return asTeamOf(lang, async (client) => {
    const { rowCount } = await client.query(
      `update "voice_feedback" f set "hiddenAt" = now()
         from "voice_design_showing" s
        where f."showingId" = $1 and f."voter" = $2 and s."id" = f."showingId" and s."lang" = $3`,
      [showingId, voter, lang],
    );
    return (rowCount ?? 0) > 0;
  });
}
