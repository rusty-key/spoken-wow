/** A section's items in the token's language, a page at a time. */
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
