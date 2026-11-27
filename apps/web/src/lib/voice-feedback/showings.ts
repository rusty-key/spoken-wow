/**
 * Show to players (migration 0136): each press is a showing, and a slot's newest showing is the
 * version /listen plays.
 */
import "server-only";

import type { Lang } from "@/lib/lang";
import { asTeamOf, teamOf } from "@/lib/teams/store";
import { isUuid } from "@/lib/uuid";
import { DesignError } from "@/lib/voice-design/access";
import { sameLines } from "@/lib/voice-design/groups";
import { lockSlot } from "@/lib/voice-design/store";
import type { ShownLine } from "@/lib/voice-design/types";

import { queueNotices } from "./follow";
import { listenTeamOf } from "./public";

/** `replaced` when another version was public, so voters of the earlier round may hear of it. */
export async function showVersion(lang: Lang, designId: string, userId: string): Promise<{ showingId: number; replaced: boolean }> {
  if (!isUuid(designId)) throw new DesignError("no such design", 404);
  const team = await teamOf(lang);
  if (team !== (await listenTeamOf(lang))) {
    throw new DesignError("The Listen page plays this language's first team's voices only, so yours cannot be shown there yet.");
  }
  return asTeamOf(lang, async (client) => {
    const slot = await lockSlot(client, lang, designId);
    if (slot === null) throw new DesignError("no such design", 404);
    const { rows } = await client.query<{ samples: number }>(
      `select count(*)::int as "samples" from "voice_design_clip" where "designId" = $1 and "kind" = 'sample'`,
      [designId],
    );
    // Players vote on these lines; a version without them has nothing to play.
    if (rows[0].samples === 0) throw new DesignError("Voice the sample lines before showing this version to players.");
    const previous = await client.query<{ designId: string; samples: ShownLine[] | null }>(
      `select "designId", "samples" from "voice_design_showing" where "lang" = $1 and "slot" = $2 order by "id" desc limit 1`,
      [lang, slot],
    );
    // The trigger of migration 0138 keeps the version's lines with the showing.
    const inserted = await client.query<{ id: string; samples: ShownLine[] }>(
      `insert into "voice_design_showing" ("designId", "lang", "slot", "createdBy") values ($1, $2, $3, $4) returning "id", "samples"`,
      [designId, lang, slot, userId],
    );
    const showingId = Number(inserted.rows[0].id);
    // Voters hear of new audio: another version, or this one voiced again. The same lines shown
    // again are only a fresh round.
    const before = previous.rows[0];
    const replaced = before !== undefined && (before.designId !== designId || !sameLines(before.samples ?? [], inserted.rows[0].samples));
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
