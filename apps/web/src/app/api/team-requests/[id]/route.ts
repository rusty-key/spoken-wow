import { bad, bodyOf, objectOf } from "@/lib/api-body";
import { currentSession } from "@/lib/session";
import { approveRequest, rejectRequest, withdrawRequest } from "@/lib/teams/requests";
import { isUuid } from "@/lib/uuid";

import { refusal, signedOut, withAdmin } from "../../teams/guard";

export const dynamic = "force-dynamic";

const MAX_REASON = 500;

/** The requester withdraws their own pending request. */
export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  const session = await currentSession();
  if (!session) return signedOut();
  try {
    return Response.json({ request: await withdrawRequest((await context.params).id, session.user.id) });
  } catch (error) {
    return refusal(error);
  }
}

/** A site admin approves or rejects. An id that is not a uuid is no such request, not no such team. */
export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  return withAdmin(async (request, actorId) => {
    const { id } = await context.params;
    if (!isUuid(id)) return Response.json({ error: "No such request." }, { status: 404 });
    return decide(request, actorId, id);
  })(request);
}

async function decide(request: Request, actorId: string, id: string): Promise<Response> {
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
}
