/**
 * Accepting a correction: the player's text taken as what the corpus line speaks
 * (lib/contributions/correction.ts). Rejecting one is resolve's plain status flip.
 *
 * Needs `text` in the language the player sent it in, English included: it changes the original,
 * unlike a team's override, which needs `regenerate`.
 *
 * `as: "wording"` keeps the corpus text and adds the player's as another wording of the
 * moment (acceptAsWording). Otherwise `lineId` and `variant`, where given, name the wording the
 * correction fixes; without them it is the closest one. `text`, where given, is the moderator's
 * edit of the player's text, saved on the row before it is accepted.
 */
import { acceptAsWording, acceptCorrection, editCorrectionText } from "@/lib/contributions/correction";
import { contributionLocale } from "@/lib/contributions/store";
import { requireCapability } from "@/lib/generation/authz";
import { BASE_LANG, isLang } from "@/lib/lang";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as {
    id?: unknown;
    as?: unknown;
    lineId?: unknown;
    variant?: unknown;
    text?: unknown;
  };

  const id = Number(body.id);
  if (!Number.isInteger(id) || id <= 0) {
    return Response.json({ error: "unknown contribution" }, { status: 404 });
  }

  // The permission before the existence check, as resolve does, so a member learns nothing
  // about which ids exist.
  const locale = await contributionLocale(id);
  const { session, denied } = await requireCapability("text", isLang(locale) ? locale : BASE_LANG);
  if (denied) return denied;
  if (locale === null) {
    return Response.json({ error: "unknown contribution" }, { status: 404 });
  }

  if (typeof body.text === "string") {
    const edited = await editCorrectionText(id, body.text, session.user.id);
    if (!edited.ok) return Response.json({ error: edited.message, kind: edited.reason }, { status: 400 });
  }

  const pick =
    typeof body.lineId === "string" && Number.isInteger(body.variant)
      ? { lineId: body.lineId, variant: body.variant as number }
      : undefined;
  const outcome =
    body.as === "wording"
      ? await acceptAsWording(id, session.user.id)
      : await acceptCorrection(id, session.user.id, pick);
  if (!outcome.ok) {
    if (outcome.reason === "not-found") {
      return Response.json({ error: "unknown contribution" }, { status: 404 });
    }
    return Response.json({ error: outcome.message, kind: outcome.reason }, { status: 409 });
  }
  return Response.json({ contribution: outcome.contribution });
}
