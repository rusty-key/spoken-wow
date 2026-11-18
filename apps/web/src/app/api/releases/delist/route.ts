/**
 * POST /api/releases/delist { team, lang, section }: a site owner takes a team's pack off the
 * channel. Answers 202 with the run that does it, which waits its turn like any release.
 */
import { requireAdminSession } from "@/lib/generation/authz";
import { isLang } from "@/lib/lang";
import { delistPack, ReviewError } from "@/lib/releases/review";

export const dynamic = "force-dynamic";

const fail = (status: number, error: string) => Response.json({ error }, { status });

export async function POST(request: Request) {
  const { session, denied } = await requireAdminSession();
  if (denied) return denied;
  const body = (await request.json().catch(() => ({}))) as { team?: unknown; lang?: unknown; section?: unknown };
  if (typeof body.team !== "string" || typeof body.section !== "string" || !isLang(body.lang)) {
    return fail(400, "team, lang and section are required");
  }
  try {
    const run = await delistPack(body.team, body.lang, body.section, session.user.id);
    return Response.json({ run: { id: run.id, kind: run.kind, section: run.section, lang: run.lang, state: run.state } }, { status: 202 });
  } catch (error) {
    if (error instanceof ReviewError) return fail(error.status, error.message);
    throw error;
  }
}
