/** One item of a section, by its line id. */
import { applyItem, statusOf } from "@/lib/text-api/apply";
import { requireToken } from "@/lib/text-api/guard";
import { decodeId, parseVariant, sectionOf } from "@/lib/text-api/respond";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ section: string; id: string }> };

export async function GET(request: Request, { params }: Params) {
  const { context, denied } = await requireToken(request);
  if (denied) return denied;

  const { section, id } = await params;
  const found = sectionOf(section);
  if (found instanceof Response) return found;

  const variant = parseVariant(found.section, new URL(request.url).searchParams);
  if (variant instanceof Response) return variant;

  const item = await found.api.one(context.lang, decodeId(id), variant);
  if (!item) return Response.json({ error: `no item ${decodeId(id)}` }, { status: 404 });
  return Response.json(item);
}

export async function PATCH(request: Request, { params }: Params) {
  const { context, denied } = await requireToken(request, { write: true });
  if (denied) return denied;

  const { section, id: raw } = await params;
  const found = sectionOf(section);
  if (found instanceof Response) return found;

  const variant = parseVariant(found.section, new URL(request.url).searchParams);
  if (variant instanceof Response) return variant;

  const body: unknown = await request.json().catch(() => null);
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return Response.json({ error: "send a JSON object" }, { status: 400 });
  }

  const id = decodeId(raw);
  const known = await found.api.known(context.lang, [{ id, variant }]);
  const result = await applyItem(
    found.section,
    context,
    { ...body, id, ...(found.section === "quests" ? { variant } : {}) },
    known,
    { tokenId: context.tokenId },
  );
  return Response.json(result, { status: statusOf(result) });
}
