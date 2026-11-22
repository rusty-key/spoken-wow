/**
 * POST `{ lang }` saves the reader's interface language; `{ lang: null }` clears it. Open to any
 * signed-in person: it changes only the words, never what they may see or do.
 */
import { bad, bodyOf, objectOf } from "@/lib/api-body";
import { isLang, type Lang } from "@/lib/lang";
import { currentSession } from "@/lib/session";
import { setUiLang } from "@/lib/users/ui-language";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const session = await currentSession();
  if (!session) return Response.json({ error: "not signed in" }, { status: 401 });
  const body = objectOf(await bodyOf(request));
  if (!body || !("lang" in body)) return bad("expected { lang: code or null }");

  const asked = body.lang;
  if (asked !== null && !isLang(asked)) return bad(`unknown language ${String(asked)}`);

  await setUiLang(session.user.id, asked as Lang | null);
  return Response.json({ lang: asked });
}
