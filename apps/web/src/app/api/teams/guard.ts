import { isAdmin } from "@/lib/permissions";
import { currentSession } from "@/lib/session";
import { TeamBusyError, TeamInputError } from "@/lib/teams/admin";

/** The signed-in site admin's id, or the 403 to send. */
export async function siteAdmin(): Promise<{ userId: string } | { denied: Response }> {
  const session = await currentSession();
  if (!session || !isAdmin(session.user.role)) {
    return { denied: Response.json({ error: "not allowed" }, { status: 403 }) };
  }
  return { userId: session.user.id };
}

/** A refusal the admin can act on as its status and message; anything else is not ours to hide. */
export function refusal(error: unknown, said = ""): Response {
  if (error instanceof TeamBusyError) return Response.json({ error: said + error.message }, { status: 409 });
  if (error instanceof TeamInputError) return Response.json({ error: said + error.message }, { status: 400 });
  throw error;
}

export const bad = (error: string) => Response.json({ error }, { status: 400 });

export async function bodyOf(request: Request): Promise<Record<string, unknown>> {
  const body: unknown = await request.json().catch(() => null);
  return body && typeof body === "object" && !Array.isArray(body) ? (body as Record<string, unknown>) : {};
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isTeamId = (value: string) => UUID.test(value);
