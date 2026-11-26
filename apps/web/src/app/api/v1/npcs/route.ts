import { listResolutions, parseResolutionKey, resolutionKey } from "@/lib/npc/store";
import { withToken } from "@/lib/text-api/guard";
import { languageDirectionsOf, npcItem } from "@/lib/text-api/npcs";
import { invalid, PAGE_SIZE } from "@/lib/text-api/respond";

export const dynamic = "force-dynamic";

/** `directed` keeps only NPCs with a direction, global or the language's. */
export async function GET(request: Request) {
  return withToken(request, { also: "configure" }, async (context) => {
    let cursor: { npcKind: string; npcId: number } | null = null;
    let limit = PAGE_SIZE;
    let directed = false;
    for (const [name, value] of new URL(request.url).searchParams) {
      if (name === "cursor") {
        cursor = parseResolutionKey(value);
        if (!cursor) return invalid(`${value} is not a valid cursor`);
      } else if (name === "limit") {
        limit = Number(value);
        if (!Number.isInteger(limit) || limit < 1 || limit > PAGE_SIZE) {
          return invalid(`limit must be between 1 and ${PAGE_SIZE}`);
        }
      } else if (name === "directed") {
        if (value !== "true" && value !== "false") return invalid("directed must be true or false");
        directed = value === "true";
      } else {
        return invalid(`unknown parameter ${name}: this takes cursor, limit, directed`);
      }
    }

    const [all, own] = await Promise.all([
      listResolutions(),
      languageDirectionsOf(context.lang),
    ]);
    // listResolutions' own order, by id then kind, so a cursor is a position in it.
    const after = cursor;
    const rows = all.filter(
      (npc) =>
        (!after || npc.npcId > after.npcId || (npc.npcId === after.npcId && npc.npcKind > after.npcKind)) &&
        (!directed || npc.direction != null || own.has(resolutionKey(npc.npcKind, npc.npcId))),
    );
    const page = rows.slice(0, limit).map((npc) => npcItem(npc, own));
    const nextCursor = rows.length > limit ? page[page.length - 1].id : null;
    return Response.json({ lang: context.lang, items: page, nextCursor });
  });
}
