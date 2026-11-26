import { recordActivity } from "@/lib/activity/store";
import { BASE_LANG } from "@/lib/lang";
import { directionRequest } from "@/lib/npc/direction-request";
import { getResolution, listLanguageDirections, resolutionKey, setLanguageDirection } from "@/lib/npc/store";
import { withToken } from "@/lib/text-api/guard";
import { NO_LANGUAGE_DIRECTION, npcItem, parseNpcId } from "@/lib/text-api/npcs";
import { decodeId, invalid } from "@/lib/text-api/respond";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

const unknownNpc = (id: string) => Response.json({ error: `no npc ${id}` }, { status: 404 });

export async function GET(request: Request, { params }: Params) {
  return withToken(request, { also: "configure", noQuery: true }, async (context) => {
    const id = decodeId((await params).id);
    const key = parseNpcId(id);
    const npc = key && (await getResolution(key.npcKind, key.npcId));
    if (!npc) return unknownNpc(id);
    const own = context.lang === BASE_LANG ? new Map<string, string>() : await listLanguageDirections(context.lang);
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
    const key = parseNpcId(id);
    if (!key) return unknownNpc(id);

    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body || !("direction" in body)) return invalid("send JSON with a direction");
    const read = await directionRequest({ ...key, direction: body.direction ?? "" });
    if (read instanceof Response) return read.status === 404 ? unknownNpc(id) : read;
    const { npc, direction } = read;

    await setLanguageDirection(key.npcKind, key.npcId, context.lang, direction, context.userId);
    await recordActivity({
      kind: "npc.direction", lang: context.lang, actorId: context.userId, subject: resolutionKey(key.npcKind, key.npcId),
      detail: { npcName: npc.npcName, direction, inLanguage: true },
    });
    const own = await listLanguageDirections(context.lang);
    return Response.json({ lang: context.lang, npc: npcItem(npc, own) });
  });
}
