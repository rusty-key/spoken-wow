import { requireAdminSession } from "@/lib/generation/authz";
import { TeamError } from "@/lib/teams/admin";
import type { TeamId } from "@/lib/teams/store";
import { isUuid } from "@/lib/uuid";

export const bad = (error: string) => Response.json({ error }, { status: 400 });

type Handler = (request: Request, actorId: string) => Promise<Response>;
type TeamHandler = (request: Request, actorId: string, team: TeamId) => Promise<Response>;
type TeamContext = { params: Promise<{ id: string }> };

/** Anything but a TeamError rethrows, so a real failure is not hidden as a refusal. */
function refusal(error: unknown): Response {
  if (error instanceof TeamError) return Response.json({ error: error.message }, { status: error.status });
  throw error;
}

/**
 * For the signed-in site admin only; anybody else gets a 403. With "id", an [id] that is not a
 * uuid is no such team.
 */
export function withAdmin(handle: Handler): (request: Request) => Promise<Response>;
export function withAdmin(handle: TeamHandler, by: "id"): (request: Request, context: TeamContext) => Promise<Response>;
export function withAdmin(handle: TeamHandler, by?: "id") {
  return async (request: Request, context?: TeamContext): Promise<Response> => {
    const { session, denied } = await requireAdminSession();
    if (denied) return denied;
    let team = "";
    if (by === "id" && context) {
      team = (await context.params).id;
      if (!isUuid(team)) return bad("No such team.");
    }
    try {
      return await handle(request, session.user.id, team);
    } catch (error) {
      return refusal(error);
    }
  };
}

export async function bodyOf(request: Request): Promise<Record<string, unknown>> {
  const body: unknown = await request.json().catch(() => null);
  return body && typeof body === "object" && !Array.isArray(body) ? (body as Record<string, unknown>) : {};
}
