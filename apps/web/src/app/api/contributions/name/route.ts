/**
 * Needs `text` in the name's language, since keeping one writes that language's name. The
 * permission comes before the existence check, so a member learns nothing about which ids exist.
 */
import { isStatus } from "@/lib/contributions/contributions";
import { requireCapability } from "@/lib/generation/authz";
import { BASE_LANG } from "@/lib/lang";
import { knownLang } from "@/lib/languages/catalogue";
import { acceptObservedName, observedNameLang, rejectObservedName, reopenObservedName } from "@/lib/names/observed";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { id?: unknown; status?: unknown };

  const id = Number(body.id);
  if (!Number.isInteger(id) || id <= 0) {
    return Response.json({ error: "unknown name" }, { status: 404 });
  }
  if (!isStatus(body.status)) {
    return Response.json({ error: "unknown status" }, { status: 400 });
  }

  const stored = await observedNameLang(id);
  const lang = (await knownLang(stored)) ?? BASE_LANG;
  const { session, denied } = await requireCapability("text", lang);
  if (denied) return denied;
  if (stored === null) {
    return Response.json({ error: "unknown name" }, { status: 404 });
  }

  const outcome =
    body.status === "accepted"
      ? await acceptObservedName(id, lang, session.user.id)
      : body.status === "rejected"
        ? await rejectObservedName(id, lang, session.user.id)
        : await reopenObservedName(id, lang);
  if (!outcome.ok) return Response.json({ error: "unknown name" }, { status: 404 });
  return Response.json({ ok: true });
}
