/**
 * Every take of one file, for whichever section owns it.
 *
 * Replaces /api/quests/lines/versions, which asked the same question of one corpus and was
 * the reason the history panel could only be shown on one of the three explorers.
 *
 * KEYED ON (source, file), not on a line id. That is what `take_current_idx` is on, and it
 * is the honest key on all three sides: 1,192 quests files are spoken by more than one NPC,
 * so "the takes of this line" is really "the takes of this file". Zones and books give
 * every line a file of its own, which is a special case of the same thing.
 *
 * Behind requireRegenerate, as the quests versions route was: a take history is the shape
 * of somebody's work, and restoring from it is the decision of whoever regenerates it.
 */
import { requireIn } from "@/lib/generation/authz";

import { isAddressableFile } from "@/lib/takes/files";
import { listTakes } from "@/lib/takes/store";
import { isSource } from "@/lib/sections";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const { lang, denied } = await requireIn(request, "regenerate");
  if (denied) return denied;

  const params = new URL(request.url).searchParams;
  const source = params.get("source");
  const file = params.get("file");

  if (!isSource(source)) {
    return Response.json({ error: "source must be quests, zones or books" }, { status: 400 });
  }
  if (!file || !(await isAddressableFile(source, file, lang))) {
    return Response.json({ error: "unknown file" }, { status: 404 });
  }


  return Response.json({ source, file, takes: await listTakes(source, file, lang) });
}
