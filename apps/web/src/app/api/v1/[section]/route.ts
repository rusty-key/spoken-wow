/** A section's items in the token's language, a page at a time. */
import { applyItems, MAX_ITEMS } from "@/lib/text-api/apply";
import { requireToken } from "@/lib/text-api/guard";
import { badCursor, parseList, sectionOf } from "@/lib/text-api/respond";

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
    const response = badCursor(error);
    if (response) return response;
    throw error;
  }
}

/** A mass update. Every item is answered for in order; see applyItems. */
export async function PATCH(request: Request, { params }: Params) {
  const { context, denied } = await requireToken(request, { write: true });
  if (denied) return denied;

  const found = sectionOf((await params).section);
  if (found instanceof Response) return found;

  const invalid = (error: string) => Response.json({ error }, { status: 400 });
  const body = (await request.json().catch(() => null)) as { items?: unknown; note?: unknown } | null;
  if (!body || !Array.isArray(body.items)) return invalid("send JSON with an items array");
  if (body.items.length === 0) return invalid("items is empty");
  if (body.items.length > MAX_ITEMS) return invalid(`at most ${MAX_ITEMS} items per update`);
  if (body.note !== undefined && body.note !== null && typeof body.note !== "string") {
    return invalid("note must be a string or null");
  }

  return Response.json(await applyItems(found.section, context, body.items, (body.note as string | null) ?? null));
}
