import { applyItem, statusOf } from "@/lib/text-api/apply";
import { withToken, writeLayer } from "@/lib/text-api/guard";
import { decodeId, invalid, parseVariant, sectionOf } from "@/lib/text-api/respond";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ section: string; id: string }> };

export async function GET(request: Request, { params }: Params) {
  return withToken(request, {}, async (context) => {
    const { section, id: raw } = await params;
    const found = sectionOf(section);
    if (found instanceof Response) return found;

    const variant = parseVariant(found.section, new URL(request.url).searchParams);
    if (variant instanceof Response) return variant;

    const id = decodeId(raw);
    const item = await found.api.one(context.lang, id, variant);
    if (!item) return Response.json({ error: `no item ${id}` }, { status: 404 });
    return Response.json(item);
  });
}

export async function PATCH(request: Request, { params }: Params) {
  return withToken(request, { need: "write" }, async (context) => {
    const { section, id: raw } = await params;
    const found = sectionOf(section);
    if (found instanceof Response) return found;

    const variant = parseVariant(found.section, new URL(request.url).searchParams);
    if (variant instanceof Response) return variant;

    const body: unknown = await request.json().catch(() => null);
    if (typeof body !== "object" || body === null || Array.isArray(body)) {
      return invalid("send a JSON object");
    }
    const { layer: requested, ...fields } = body as Record<string, unknown>;
    const layer = writeLayer(context, requested);
    if (layer instanceof Response) return layer;
    // The mass update reads it from the item, so an agent may send it here too, and the URL's would
    // otherwise replace it and write to the other line.
    if (found.section === "quests" && "variant" in fields) return invalid("a variant goes in the URL here, as ?variant=");

    const id = decodeId(raw);
    const known = await found.api.known(context.lang, [{ id, variant }]);
    const result = await applyItem(
      found.section,
      context,
      { ...fields, id, ...(found.section === "quests" ? { variant } : {}) },
      known,
      { tokenId: context.tokenId },
      layer,
    );
    return Response.json(result, { status: statusOf(result) });
  });
}
