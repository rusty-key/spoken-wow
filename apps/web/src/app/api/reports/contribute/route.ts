/**
 * A report's text as a contribution (lib/reports/contribute.ts): GET says what the corpus makes
 * of it, POST accepts it. A correction's accept takes what the corrections tab's does:
 * `as: "wording"`, or the `lineId` and `variant` of the wording it fixes.
 *
 * Gated on the report's queue, then on the language the text is written into: the reporter's
 * client may be in another one. Accepting writes original text, so it takes `text` there even for
 * the team a report waits with.
 */
import { requireCapability } from "@/lib/generation/authz";
import { BASE_LANG, isLang, type Lang } from "@/lib/lang";
import type { Submission } from "@/lib/contributions/contributions";
import { contributeReport, reportContribution, reportSubmission } from "@/lib/reports/contribute";
import { requireReportQueue } from "@/lib/reports/access";
import type { Report } from "@/lib/reports/reports";
import { reportById } from "@/lib/reports/store";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const found = await guarded(new URL(request.url).searchParams.get("id"), false);
  if ("denied" in found) return found.denied;
  return Response.json(await reportContribution(found.submission));
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as {
    id?: unknown;
    as?: unknown;
    lineId?: unknown;
    variant?: unknown;
  };
  const found = await guarded(body.id, true);
  if ("denied" in found) return found.denied;

  const pick =
    typeof body.lineId === "string" && Number.isInteger(body.variant)
      ? { lineId: body.lineId, variant: body.variant as number }
      : undefined;
  const outcome = await contributeReport(
    found.report,
    found.lang,
    found.submission,
    found.userId,
    body.as === "wording" ? { as: "wording" } : { pick },
  );
  if (!outcome.ok) {
    if (outcome.reason === "not-found") {
      return Response.json({ error: "unknown report" }, { status: 404 });
    }
    return Response.json({ error: outcome.message }, { status: 409 });
  }
  return Response.json({ report: outcome.report, contribution: outcome.contribution });
}

/** The report, its submission and who is asking, or the response that refuses them. */
async function guarded(
  raw: unknown,
  writes: boolean,
): Promise<{ report: Report; lang: Lang; submission: Submission; userId: string } | { denied: Response }> {
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) {
    return { denied: Response.json({ error: "unknown report" }, { status: 404 }) };
  }

  const guard = await requireReportQueue(id);
  if (guard.denied) return { denied: guard.denied };
  const lang = guard.place?.lang ?? null;
  const report = lang === null ? null : await reportById(id, lang);
  if (!lang || !report) {
    return { denied: Response.json({ error: "unknown report" }, { status: 404 }) };
  }

  const submission = reportSubmission(report);
  if (typeof submission === "string") {
    return { denied: Response.json({ error: submission }, { status: 409 }) };
  }
  if (writes || submission.locale !== lang) {
    const { denied } = await requireCapability("text", isLang(submission.locale) ? submission.locale : BASE_LANG);
    if (denied) return { denied };
  }
  return { report, lang, submission, userId: guard.session.user.id };
}
