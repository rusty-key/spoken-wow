/**
 * GET /api/releases/<id>/take?file=<file>&version=<n>: one take of the team whose release `id` is,
 * for a site owner reviewing it: the version its pack was built with. The take routes serve
 * another team only its live takes, and a version only to its own team (/api/takes/audio).
 *
 * The file is not checked against the section's addressable set, as /api/takes/audio checks it:
 * only a take row of the run's team, matched exactly, names the bytes, so no string here reaches
 * another directory.
 */
import { requireAdminSession } from "@/lib/generation/authz";
import { runById } from "@/lib/releases/store";
import { serveTake } from "@/lib/takes/serve";
import { takePath } from "@/lib/takes/store";
import { asTeam } from "@/lib/teams/acting";

export const dynamic = "force-dynamic";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const { denied } = await requireAdminSession();
  if (denied) return denied;
  const run = await runById((await context.params).id);
  if (!run || run.kind !== "release") return new Response("no such release", { status: 404 });

  const params = new URL(request.url).searchParams;
  const file = params.get("file");
  const version = Number(params.get("version"));
  if (!file || !Number.isInteger(version) || version < 1) return new Response("bad take", { status: 400 });

  const bytes = await asTeam(run.lang, run.teamId, () => takePath(run.section, file, version, run.lang));
  return serveTake(request, bytes, { immutable: true, lang: run.lang });
}
