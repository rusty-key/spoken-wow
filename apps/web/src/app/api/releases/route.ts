/**
 * Release a section in a language: record the press, start the GitHub workflow, and let the
 * page follow it. Gated on `admin` in that language.
 */
import { requireCapability } from "@/lib/generation/authz";
import { langParam } from "@/lib/lang-server";
import { dispatchRelease } from "@/lib/releases/github";
import { isReleaseSection, RELEASE_SECTIONS } from "@/lib/releases/sections";
import { ReleaseBusyError, startRun, updateRun } from "@/lib/releases/store";
import { syncActive } from "@/lib/releases/sync";
import { releaseView } from "@/lib/releases/view";
import { NoTeamError } from "@/lib/teams/store";

export const dynamic = "force-dynamic";

const fail = (status: number, error: string) => Response.json({ error }, { status });

export async function GET(request: Request) {
  const { lang, denied: unknown } = await langParam(request);
  if (unknown) return unknown;
  const { denied } = await requireCapability("admin", lang);
  if (denied) return denied;

  return Response.json(await releaseView(lang));
}

export async function POST(request: Request) {
  const { lang, denied: unknown } = await langParam(request);
  if (unknown) return unknown;
  const { session, denied } = await requireCapability("admin", lang);
  if (denied) return denied;

  const body = (await request.json().catch(() => ({}))) as { section?: unknown };
  if (!isReleaseSection(body.section)) return fail(400, `section is one of ${RELEASE_SECTIONS.join(", ")}`);

  // A finished run settles first, or it would hold the lock until somebody happened to look.
  await syncActive();

  let run;
  try {
    run = await startRun(body.section, lang, session.user.id);
  } catch (error) {
    if (error instanceof ReleaseBusyError) {
      return fail(409, `A release is already running: ${error.active.section} in ${error.active.lang}.`);
    }
    if (error instanceof NoTeamError) return fail(400, `${lang} has no team to release for.`);
    throw error;
  }

  try {
    await dispatchRelease(run);
  } catch (error) {
    const reason = error instanceof Error ? error.message : "the release could not be started";
    await updateRun(run.id, { state: "failed", error: reason });
    return fail(502, reason);
  }
  return Response.json({ run: { id: run.id, section: run.section, lang: run.lang, state: run.state } }, { status: 202 });
}
