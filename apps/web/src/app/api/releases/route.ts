import { requireCapability } from "@/lib/generation/authz";
import { langName } from "@/lib/lang";
import { langParam } from "@/lib/lang-server";
import { runsOnDroplet, startDropletRun } from "@/lib/releases/droplet";
import { dispatchRelease } from "@/lib/releases/github";
import { isReleaseBump, isReleaseSection, RELEASE_BUMPS, RELEASE_SECTIONS } from "@/lib/releases/sections";
import { pendingChanges } from "@/lib/releases/pending";
import { ReleaseBusyError, lastReleasedAt, startRun, updateRun } from "@/lib/releases/store";
import { syncActive } from "@/lib/releases/sync";
import { releaseView } from "@/lib/releases/view";
import { encodeMissingForPack } from "@/lib/takes/encode";
import { NoTeamError } from "@/lib/teams/store";

export const dynamic = "force-dynamic";

const fail = (status: number, error: string) => Response.json({ error }, { status });

export async function GET(request: Request) {
  const { lang, denied: unknown } = await langParam(request);
  if (unknown) return unknown;
  const { denied } = await requireCapability("admin", lang);
  if (denied) return denied;

  // ?section= is one section's review: every line it would send, which the page's checks leave out.
  const section = new URL(request.url).searchParams.get("section");
  if (section !== null) {
    if (!isReleaseSection(section)) return fail(400, `section is one of ${RELEASE_SECTIONS.join(", ")}`);
    const since = (await lastReleasedAt(lang)).get(section) ?? null;
    return Response.json({ pending: await pendingChanges(section, lang, since) });
  }

  return Response.json(await releaseView(lang));
}

export async function POST(request: Request) {
  const { lang, denied: unknown } = await langParam(request);
  if (unknown) return unknown;
  const { session, denied } = await requireCapability("admin", lang);
  if (denied) return denied;

  const body = (await request.json().catch(() => ({}))) as { section?: unknown; bump?: unknown };
  if (!isReleaseSection(body.section)) return fail(400, `section is one of ${RELEASE_SECTIONS.join(", ")}`);
  const bump = body.bump ?? "patch";
  if (!isReleaseBump(bump)) return fail(400, `bump is one of ${RELEASE_BUMPS.join(", ")}`);

  // A finished run settles first, or it would hold the lock until somebody happened to look.
  await syncActive();

  let run;
  try {
    run = await startRun(body.section, lang, session.user.id);
  } catch (error) {
    if (error instanceof ReleaseBusyError) {
      return fail(409, `A release is already running: ${error.active.section} in ${langName(error.active.lang)}.`);
    }
    if (error instanceof NoTeamError) return fail(400, `${lang} has no team to release for.`);
    throw error;
  }

  try {
    // After startRun, which holds the lock, so a second press cannot encode the same takes.
    await encodeMissingForPack(run.section, run.lang);
    await (runsOnDroplet() ? startDropletRun(run, bump) : dispatchRelease(run));
  } catch (error) {
    const reason = error instanceof Error ? error.message : "the release could not be started";
    await updateRun(run.id, { state: "failed", error: reason });
    return fail(502, reason);
  }
  return Response.json({ run: { id: run.id, section: run.section, lang: run.lang, state: run.state } }, { status: 202 });
}
