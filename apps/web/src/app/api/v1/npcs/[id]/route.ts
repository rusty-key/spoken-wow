import { bodyOf, objectOf } from "@/lib/api-body";
import { BASE_LANG } from "@/lib/lang";
import { applyLanguageDirection, directionRequest, NO_LANGUAGE_DIRECTION } from "@/lib/npc/direction-request";
import { getResolution, parseResolutionKey, resolutionKey } from "@/lib/npc/store";
import { withToken } from "@/lib/text-api/guard";
import { languageDirectionsOf, npcItem } from "@/lib/text-api/npcs";
import { decodeId, invalid } from "@/lib/text-api/respond";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

const unknownNpc = (id: string) => Response.json({ error: `unknown npc ${id}` }, { status: 404 });

export async function GET(request: Request, { params }: Params) {
  return withToken(request, { also: "configure", noQuery: true }, async (context) => {
    const id = decodeId((await params).id);
    const key = parseResolutionKey(id);
    if (!key) return unknownNpc(id);
    const [npc, own] = await Promise.all([
      getResolution(key.npcKind, key.npcId),
      languageDirectionsOf(context.lang),
    ]);
    if (!npc) return unknownNpc(id);
    return Response.json({ lang: context.lang, npc: npcItem(npc, own) });
  });
}

/**
 * Sets only the token's language's direction: the global one changes every language, so it stays
 * the admin's. An empty or null direction clears back to the global one.
 */
export async function PATCH(request: Request, { params }: Params) {
  return withToken(request, { need: "write", also: "configure", noQuery: true }, async (context) => {
    if (context.lang === BASE_LANG) return invalid(NO_LANGUAGE_DIRECTION);
    const id = decodeId((await params).id);
    const key = parseResolutionKey(id);
    if (!key) return unknownNpc(id);

    const body = objectOf(await bodyOf(request));
    if (!body || !("direction" in body)) return invalid("send JSON with a direction");
    const read = await directionRequest({ ...key, direction: body.direction ?? "" });
    if (read instanceof Response) return read;
    await applyLanguageDirection(read, context.lang, context.userId);
    const own = new Map(read.direction === null ? [] : [[resolutionKey(key.npcKind, key.npcId), read.direction]]);
    return Response.json({ lang: context.lang, npc: npcItem(read.npc, own) });
  });
}
