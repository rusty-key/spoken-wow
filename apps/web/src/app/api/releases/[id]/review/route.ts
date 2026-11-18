/**
 * POST /api/releases/<id>/review { action: "approve" | "reject", note? }: a site owner's verdict
 * on a team's staged release. Approving answers 202 with the promotion that lists it; rejecting
 * needs a reason, which the team sees. A team admin cannot approve their own version.
 */
import { requireAdminSession } from "@/lib/generation/authz";
import { approve, reject, ReviewError } from "@/lib/releases/review";

export const dynamic = "force-dynamic";

const fail = (status: number, error: string) => Response.json({ error }, { status });

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { session, denied } = await requireAdminSession();
  if (denied) return denied;
  const { id } = await context.params;
  const body = (await request.json().catch(() => ({}))) as { action?: unknown; note?: unknown };
  try {
    if (body.action === "approve") {
      const run = await approve(id, session.user.id);
      return Response.json({ run: { id: run.id, kind: run.kind, state: run.state } }, { status: 202 });
    }
    if (body.action === "reject") {
      const run = await reject(id, session.user.id, typeof body.note === "string" ? body.note : "");
      return Response.json({ run: { id: run.id, state: run.state } });
    }
    return fail(400, 'action is "approve" or "reject"');
  } catch (error) {
    if (error instanceof ReviewError) return fail(error.status, error.message);
    throw error;
  }
}
