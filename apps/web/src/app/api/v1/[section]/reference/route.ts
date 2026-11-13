/** The English text of a section, for a token to translate from or to know what it is generating. */
import { BASE_LANG } from "@/lib/lang";
import { requireToken } from "@/lib/text-api/guard";
import { invalid, parseList, sectionOf, toReference } from "@/lib/text-api/respond";
import { BadCursor } from "@/lib/text-api/types";

export const dynamic = "force-dynamic";

export async function GET(request: Request, { params }: { params: Promise<{ section: string }> }) {
  const { denied } = await requireToken(request, { need: "any" });
  if (denied) return denied;

  const found = sectionOf((await params).section);
  if (found instanceof Response) return found;

  const query = parseList(found.api, new URL(request.url).searchParams);
  if (query instanceof Response) return query;

  try {
    const page = await found.api.list(BASE_LANG, query.filter, query.cursor, query.limit);
    return Response.json({ lang: BASE_LANG, items: page.items.map(toReference), nextCursor: page.nextCursor });
  } catch (error) {
    if (error instanceof BadCursor) return invalid(error.message);
    throw error;
  }
}
