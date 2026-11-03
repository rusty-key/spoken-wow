/** One item of a section, by its line id. */
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
