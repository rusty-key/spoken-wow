import { requireCapability } from "@/lib/generation/authz";
import { langName } from "@/lib/lang";
import { langParam } from "@/lib/lang-server";
import { releasesClosedFor, runsOnDroplet } from "@/lib/releases/droplet";
import { begin, failureOf } from "@/lib/releases/launch";
import { isReleaseBump, isReleaseSection, RELEASE_BUMPS, RELEASE_SECTIONS, TEAM_RELEASES_CLOSED } from "@/lib/releases/sections";
import { pendingChanges } from "@/lib/releases/pending";
import { ReleaseBusyError, lastReleasedAt, startRun } from "@/lib/releases/store";
import { syncActive } from "@/lib/releases/sync";
import { releaseView } from "@/lib/releases/view";
import { actingTeamRow, NoTeamError } from "@/lib/teams/store";

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
  // The run is written under the acting team (startRun), and the job builds that team's packs.
  const team = await actingTeamRow(lang);
  if (releasesClosedFor(team)) return fail(409, TEAM_RELEASES_CLOSED);

  const body = (await request.json().catch(() => ({}))) as { section?: unknown; bump?: unknown };
  if (!isReleaseSection(body.section)) return fail(400, `section is one of ${RELEASE_SECTIONS.join(", ")}`);
  const bump = body.bump ?? "patch";
  if (!isReleaseBump(bump)) return fail(400, `bump is one of ${RELEASE_BUMPS.join(", ")}`);

  // A finished run settles first, or it would hold the lock until somebody happened to look.
  await syncActive();

  let run;
  try {
    // A run on GitHub is refused while another is active: the workflow's own concurrency group
    // queues there, and cancels what waits.
    // A team that is not official stages, for a site owner to review; decided now, so changing
    // `official` later changes nothing in flight.
    run = await startRun(body.section, lang, session.user.id, { bump, stage: team ? !team.official : false, queue: runsOnDroplet() });
  } catch (error) {
    if (error instanceof ReleaseBusyError) {
      return fail(409, `A release is already running: ${error.active.section} in ${langName(error.active.lang)}.`);
    }
    if (error instanceof NoTeamError) return fail(400, `${lang} has no team to release for.`);
    throw error;
  }

  try {
    // After startRun, which holds the lock, so a second press cannot encode the same takes.
    await begin(run);
  } catch (error) {
    return fail(502, failureOf(error));
  }
  return Response.json({ run: { id: run.id, section: run.section, lang: run.lang, state: run.state } }, { status: 202 });
}
