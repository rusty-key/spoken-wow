/**
 * What the pipelines read.
 *
 * NDJSON rather than a write into a staging table, because there is no staging table to write
 * into: the quests corpus is built in pipelines/quests against vmangos, not in this database,
 * and the readables corpus is built from the same world DB. A file the pipeline pulls is the
 * boundary those two already have.
 *
 * Behind English regenerate, like the other moderator routes: accepted text is still text
 * somebody typed into a public form, and the queue it came from is not public reading.
 */
import { requireRegenerate } from "@/lib/generation/authz";
import { acceptedContributions, observationMeta } from "@/lib/contributions/store";
import { idOnlyResolution } from "@/lib/contributions/triage";
import { observedFrom } from "@/lib/npc/resolve";
import { getResolutions, getResolutionsById, resolutionKey, type NpcRowKind } from "@/lib/npc/store";

export const dynamic = "force-dynamic";

export async function GET() {
  const { denied } = await requireRegenerate();
  if (denied) return denied;

  const rows = await acceptedContributions();

  // One query for every row's resolution, not one per row -- observedFrom is pure and cheap, so
  // it runs twice (once to build the keys, once below per row) rather than kept in a parallel
  // array the two loops would need to stay in lockstep with.
  const keys: { npcKind: NpcRowKind; npcId: number }[] = [];
  const idOnlyIds = new Set<number>();
  for (const row of rows) {
    // observationMeta puts back build and a moderator-chosen kind, the two things stored in
    // columns of their own rather than in `meta`.
    const observed = observedFrom(observationMeta(row));
    if (observed.npcId === null) continue;
    if (observed.npcKind !== null) keys.push({ npcKind: observed.npcKind, npcId: observed.npcId });
    else idOnlyIds.add(observed.npcId);
  }
  const resolutions = await getResolutions(keys);
  // A kind-less row is answered the way the triage page and accept answer it: by id alone, when
  // the answers on file agree. A conflict leaves the speaker null and says so.
  const idOnly = await getResolutionsById([...idOnlyIds]);

  const body = rows
    .map((row) => {
      const observed = observedFrom(observationMeta(row));
      const lookup =
        observed.npcId === null
          ? { resolution: undefined, conflict: [] }
          : observed.npcKind !== null
            ? { resolution: resolutions.get(resolutionKey(observed.npcKind, observed.npcId)), conflict: [] }
            : idOnlyResolution(idOnly.get(observed.npcId));
      const resolution = lookup.resolution;

      return JSON.stringify({
        id: row.id,
        source: row.source,
        key: row.key,
        locale: row.locale,
        build: row.build,
        text: row.text,
        meta: row.meta,
        count: row.count,
        // The pipelines decide for themselves whether an unconfirmed guess is good enough --
        // this route only says what was resolved and how sure the resolution is.
        race: resolution?.race ?? null,
        gender: resolution?.gender ?? null,
        flavor: resolution?.flavor ?? null,
        npcProvenance: resolution?.provenance ?? null,
        npcConfirmed: resolution?.confirmed ?? false,
        npcKind: resolution?.npcKind ?? observed.npcKind,
        // Two kinds sharing this id disagree, and no moderator has said which one it is yet.
        npcConflict: lookup.conflict.length > 0,
      });
    })
    .join("\n");

  return new Response(body ? body + "\n" : "", {
    headers: { "content-type": "application/x-ndjson; charset=utf-8" },
  });
}
