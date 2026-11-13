/**
 * Which lines this project has decided never to voice.
 *
 * `admin`, not `regenerate`: an override changes one file and the person who rewrote it
 * listens to the result, but ignoring a line hides it from everyone's searches and takes it
 * out of the shipped module. That is the same reach as the generation settings, so it is
 * gated the same way.
 *
 * Keyed on the corpus's own lineId, and isKnownLine() is the whitelist: an id either names
 * lines the corpus has or it does not exist. Nothing here touches a path, so there is no
 * traversal to defend against - only a table that should not fill with ids nobody can resolve.
 */
import { query } from "@/lib/db";
import { requireConfigure, requireIn } from "@/lib/generation/authz";
import type { Lang } from "@/lib/lang";
import { lineIndex } from "@/lib/quests/catalogue";
import { clearIgnore, writeIgnore } from "@/lib/quests/ignores";

export const dynamic = "force-dynamic";

const MAX_REASON = 300;

/**
 * Which level an ignore is at, and whether the caller may act there.
 *
 * `?scope=all` is every language, the global admin's decision alone: nobody will voice
 * the line anywhere. Otherwise it is the page's language (`?lang=`, English when absent),
 * and whoever holds `ignore` in it decides. The English site has always meant "everywhere"
 * by an ignore, so its dialog sends scope=all.
 */
async function guard(
  request: Request,
): Promise<
  | { lang: Lang | null; userId: string; denied: null }
  | { lang: null; userId: null; denied: Response }
> {
  if (new URL(request.url).searchParams.get("scope") === "all") {
    const { session, denied } = await requireConfigure();
    if (denied) return { lang: null, userId: null, denied };
    return { lang: null, userId: session.user.id, denied: null };
  }
  const { session, lang, denied } = await requireIn(request, "ignore");
  if (denied) return { lang: null, userId: null, denied };
  return { lang, userId: session.user.id, denied: null };
}

/**
 * A line of the language's explorer, or at `scope=all` (no language) of any language's: an
 * ignore everywhere may be of a line only one language has, which English's index lacks.
 */
async function isKnownLine(lineId: string, lang: Lang | null): Promise<boolean> {
  if (lang) return (await lineIndex(lang)).has(lineId);
  const rows = await query(`select 1 from "quest_line" where "lineId" = $1 and "isCurrent" limit 1`, [lineId]);
  return rows.length > 0;
}

export async function PUT(request: Request) {
  const { lang, userId, denied } = await guard(request);
  if (denied) return denied;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "invalid body" }, { status: 400 });
  }

  const { lineId, reason } = (body ?? {}) as { lineId?: unknown; reason?: unknown };
  if (typeof lineId !== "string" || !(await isKnownLine(lineId, lang))) {
    return Response.json({ error: "unknown line" }, { status: 404 });
  }
  if (typeof reason !== "string" || !reason.trim()) {
    // Required, because the list is read months later by someone deciding whether the entry
    // still holds, and "it was broken" with no note is a decision nobody can revisit.
    return Response.json({ error: "a reason is required" }, { status: 400 });
  }
  if (reason.length > MAX_REASON) {
    return Response.json({ error: `reason must be ${MAX_REASON} characters or fewer` }, { status: 400 });
  }

  return Response.json({ ignore: await writeIgnore(lineId, reason, userId, lang) });
}

export async function DELETE(request: Request) {
  const { lang, userId, denied } = await guard(request);
  if (denied) return denied;

  const lineId = new URL(request.url).searchParams.get("lineId");
  if (!lineId || !(await isKnownLine(lineId, lang))) {
    return Response.json({ error: "unknown line" }, { status: 404 });
  }

  // 200 for a line that was not ignored, as the override route does: the caller asked for it
  // to be gone and it is gone, and a 404 would make a second click look like a failure.
  return Response.json({ removed: await clearIgnore(lineId, lang, userId) });
}
