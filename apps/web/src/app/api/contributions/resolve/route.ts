/**
 * Changing a contribution's status.
 *
 * A sibling route, not a second verb on /api/contributions: that path's POST is open to the
 * whole internet and this one must never be. Whoever edits the language rather than an
 * admin, as on the reports side -- these are the people who already act on lines.
 */
import { mayIgnoreIn, requireCapability } from "@/lib/generation/authz";
import { contributionLocale } from "@/lib/contributions/store";
import { BASE_LANG, isLang } from "@/lib/lang";
import { isStatus } from "@/lib/contributions/contributions";
import { resolveContribution } from "@/lib/contributions/accept";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { id?: unknown; status?: unknown };

  const id = Number(body.id);
  if (!Number.isInteger(id) || id <= 0) {
    return Response.json({ error: "unknown contribution" }, { status: 404 });
  }

  if (!isStatus(body.status)) {
    return Response.json({ error: "unknown status" }, { status: 400 });
  }

  // Whoever may edit the language the player sent it in: accepting writes that language's
  // text, English like any other. The id is checked for existence only after the
  // permission, so a member learns nothing about which ids exist.
  const locale = await contributionLocale(id);
  const lang = isLang(locale) ? locale : BASE_LANG;
  const { session, denied } = await requireCapability("edit", lang);
  if (denied) return denied;
  if (locale === null) {
    return Response.json({ error: "unknown contribution" }, { status: 404 });
  }

  // Rejecting a row already written ignores its line, so it also takes what ignoring takes.
  const mayIgnore = body.status === "rejected" && (await mayIgnoreIn(session, lang));
  const outcome = await resolveContribution(id, body.status, session.user.id, undefined, mayIgnore);
  if (!outcome.ok) {
    if (outcome.reason === "not-found") {
      return Response.json({ error: "unknown contribution" }, { status: 404 });
    }
    // needs-speaker and one-way are both refusals a moderator can act on -- 409, not 400: the
    // request was well-formed, the contribution's current state is what refuses it.
    const status = outcome.reason === "malformed" ? 400 : 409;
    return Response.json({ error: outcome.message, kind: outcome.reason }, { status });
  }

  return Response.json({ contribution: outcome.contribution });
}
