import { bad, bodyOf, objectOf } from "@/lib/api-body";
import { currentSession } from "@/lib/session";
import { TeamError } from "@/lib/teams/admin";
import { approveRequest, rejectRequest, withdrawRequest } from "@/lib/teams/requests";

import { withAdmin } from "../../teams/guard";

export const dynamic = "force-dynamic";

const MAX_REASON = 500;

/** The requester withdraws their own pending request. */
export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  const session = await currentSession();
  if (!session) return Response.json({ error: "Sign in first." }, { status: 401 });
  try {
    return Response.json({ request: await withdrawRequest((await context.params).id, session.user.id) });
  } catch (error) {
    if (error instanceof TeamError) return Response.json({ error: error.message }, { status: error.status });
    throw error;
  }
}

export const PATCH = withAdmin(async (request, actorId, id) => {
  const body = objectOf(await bodyOf(request));
  if (body?.decision === "approve") return Response.json({ request: await approveRequest(id, actorId) });
  if (body?.decision === "reject") {
    const { reason } = body;
    if (reason !== undefined && reason !== null && (typeof reason !== "string" || reason.length > MAX_REASON)) {
      return bad(`A reason is at most ${MAX_REASON} characters.`);
    }
    const given = typeof reason === "string" && reason.trim() ? reason.trim() : null;
    return Response.json({ request: await rejectRequest(id, actorId, given) });
  }
  return bad('Expected { decision: "approve" } or { decision: "reject", reason? }.');
}, "id");
