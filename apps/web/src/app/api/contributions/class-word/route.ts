/**
 * Marking the quest a contribution names as one whose class word is its own
 * (lib/contributions/class-words.ts), or unmarking it. Whoever may edit the contribution's
 * language, as accepting it takes.
 */
import { markClassWord } from "@/lib/contributions/class-words";
import { contributionLocale } from "@/lib/contributions/store";
import { requireCapability } from "@/lib/generation/authz";
import { BASE_LANG, isLang } from "@/lib/lang";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { id?: unknown; kept?: unknown };

  const id = Number(body.id);
  if (!Number.isInteger(id) || id <= 0) {
    return Response.json({ error: "unknown contribution" }, { status: 404 });
  }
  if (typeof body.kept !== "boolean") {
    return Response.json({ error: "kept must be true or false" }, { status: 400 });
  }

  // The permission before the existence check, so a member learns nothing about which ids exist.
  const locale = await contributionLocale(id);
  const { session, denied } = await requireCapability("text", isLang(locale) ? locale : BASE_LANG);
  if (denied) return denied;
  if (locale === null) {
    return Response.json({ error: "unknown contribution" }, { status: 404 });
  }

  const outcome = await markClassWord(id, body.kept, session.user.id);
  if (!outcome.ok) {
    return Response.json({ error: "This contribution names no quest." }, { status: 409 });
  }
  return Response.json({ questId: outcome.questId, texts: outcome.texts });
}
