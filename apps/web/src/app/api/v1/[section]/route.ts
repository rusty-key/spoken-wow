import { applyItems, MAX_ITEMS, noteError } from "@/lib/text-api/apply";
import { requireToken } from "@/lib/text-api/guard";
import { invalid, parseList, sectionOf } from "@/lib/text-api/respond";
import { BadCursor } from "@/lib/text-api/types";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ section: string }> };

export async function GET(request: Request, { params }: Params) {
  const { context, denied } = await requireToken(request);
  if (denied) return denied;

  const found = sectionOf((await params).section);
  if (found instanceof Response) return found;

  const query = parseList(found.api, new URL(request.url).searchParams);
  if (query instanceof Response) return query;

  try {
    const page = await found.api.list(context.lang, query.filter, query.cursor, query.limit);
    return Response.json({ lang: context.lang, ...page });
  } catch (error) {
    if (error instanceof BadCursor) return invalid(error.message);
    throw error;
  }
}

export async function PATCH(request: Request, { params }: Params) {
  const { context, denied } = await requireToken(request, { need: "write" });
  if (denied) return denied;

  const found = sectionOf((await params).section);
  if (found instanceof Response) return found;

  const body = (await request.json().catch(() => null)) as { items?: unknown; note?: unknown } | null;
  if (!body || !Array.isArray(body.items)) return invalid("send JSON with an items array");
  if (body.items.length === 0) return invalid("items is empty");
  if (body.items.length > MAX_ITEMS) return invalid(`at most ${MAX_ITEMS} items per update`);
  const note = noteError(body.note);
  if (note) return invalid(note);

  return Response.json(await applyItems(found.section, context, body.items, (body.note as string | null) ?? null));
}
