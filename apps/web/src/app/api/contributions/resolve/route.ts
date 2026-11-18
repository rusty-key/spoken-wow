/**
 * Changing a contribution's status.
 *
 * A sibling route, not a second verb on /api/contributions: that path's POST is open to the
 * whole internet and this one must never be. Whoever edits the language rather than an
 * admin, as on the reports side -- these are the people who already act on lines.
 *
 * Accepting may carry `text`: the reviewer's edit of what the player sent ("keep with fix"),
 * saved on the row first and put back if the accept is refused, as the correction route does.
 * Rejecting may carry `reason`, which the Rejected tab shows; any other status clears it.
 */
import { mayIgnoreIn, requireCapability } from "@/lib/generation/authz";
import { editCorrectionText } from "@/lib/contributions/correction";
import { contributionLocale, rewriteWaitingTexts, setRejectReasons } from "@/lib/contributions/store";
import { BASE_LANG } from "@/lib/lang";
import { knownLang } from "@/lib/languages/catalogue";
import { isStatus } from "@/lib/contributions/contributions";
import { resolveContribution } from "@/lib/contributions/accept";
import { bookMatchOf } from "@/lib/contributions/book-match";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as {
    id?: unknown;
    status?: unknown;
    bookMatch?: unknown;
    text?: unknown;
    reason?: unknown;
  };

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
  const lang = (await knownLang(locale)) ?? BASE_LANG;
  const { session, denied } = await requireCapability("text", lang);
  if (denied) return denied;
  if (locale === null) {
    return Response.json({ error: "unknown contribution" }, { status: 404 });
  }

  // Rejecting a row already written ignores its line, so it also takes what ignoring takes.
  const mayIgnore = body.status === "rejected" && (await mayIgnoreIn(session, lang));
  // A readables row's match as the moderator saw it: accepting refuses a row that now matches
  // otherwise, as the bulk route does.
  const bookMatch = bookMatchOf(body.bookMatch);

  let previous: string | null = null;
  if (body.status === "accepted" && typeof body.text === "string") {
    const edited = await editCorrectionText(id, body.text, session.user.id);
    if (!edited.ok) return Response.json({ error: edited.message, kind: edited.reason }, { status: 400 });
    previous = edited.previous;
  }

  const outcome = await resolveContribution(id, body.status, session.user.id, undefined, mayIgnore, bookMatch);
  if (!outcome.ok) {
    // A refused accept leaves the row as it was, the edit with it.
    if (previous !== null) await rewriteWaitingTexts([{ id, text: previous }]);
    if (outcome.reason === "not-found") {
      return Response.json({ error: "unknown contribution" }, { status: 404 });
    }
    // needs-speaker and one-way are both refusals a moderator can act on -- 409, not 400: the
    // request was well-formed, the contribution's current state is what refuses it.
    const status = outcome.reason === "malformed" ? 400 : 409;
    return Response.json({ error: outcome.message, kind: outcome.reason }, { status });
  }

  await setRejectReasons([id], body.status === "rejected" && typeof body.reason === "string" ? body.reason : null);
  return Response.json({ contribution: outcome.contribution });
}
