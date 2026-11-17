/** The English text of a section, for a token to translate from or to know what it is generating. */
import { BASE_LANG } from "@/lib/lang";
import { withToken } from "@/lib/text-api/guard";
import { invalid, parseList, sectionOf } from "@/lib/text-api/respond";
import { BadCursor, type ReferenceItem } from "@/lib/text-api/types";

export const dynamic = "force-dynamic";

export async function GET(request: Request, { params }: { params: Promise<{ section: string }> }) {
  return withToken(request, { need: "any" }, async () => {
    const found = sectionOf((await params).section);
    if (found instanceof Response) return found;

    const query = parseList(found.api, new URL(request.url).searchParams);
    if (query instanceof Response) return query;

    try {
      const page = await found.api.list(BASE_LANG, query.filter, query.cursor, query.limit);
      const items = page.items.map(
        ({ version: _v, nameVersion: _n, englishText: _t, englishName: _e, ...reference }): ReferenceItem => reference,
      );
      return Response.json({ lang: BASE_LANG, items, nextCursor: page.nextCursor });
    } catch (error) {
      if (error instanceof BadCursor) return invalid(error.message);
      throw error;
    }
  });
}
