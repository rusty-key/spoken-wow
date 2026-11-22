/**
 * DELETE /api/releases/<id>: cancels a run still waiting its turn. Whoever pressed it may, and a
 * site owner; another team's run is not there to cancel.
 */
import { isAdmin } from "@/lib/permissions";
import { cancelQueued, runById } from "@/lib/releases/store";
import { currentSession } from "@/lib/session";
import { teamIn } from "@/lib/teams/acting";

export const dynamic = "force-dynamic";

const fail = (status: number, error: string) => Response.json({ error }, { status });

export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  const session = await currentSession();
  if (!session) return fail(403, "Sign in to cancel a release.");
  const { id } = await context.params;
  const run = await runById(id);
  const owner = isAdmin(session.user.role);
  if (!run || (!owner && (await teamIn(session.user.id, run.lang)) !== run.teamId)) return fail(404, "No such release.");
  if (!owner && run.requestedBy !== session.user.id) return fail(403, "Only whoever pressed it, or a site owner, can cancel it.");
  if (run.state !== "queued") return fail(409, "It is not waiting any more, so it cannot be cancelled.");
  const cancelled = await cancelQueued(run.id);
  if (!cancelled) return fail(409, "It started before it could be cancelled.");
  return Response.json({ run: { id: cancelled.id, state: cancelled.state } });
}
