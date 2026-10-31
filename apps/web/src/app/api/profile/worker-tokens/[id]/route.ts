/** Unpair one of the signed-in author's Managers. */
import { currentSession } from "@/lib/session";
import { revokeToken } from "@/lib/worker/tokens";

export const dynamic = "force-dynamic";

export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  const session = await currentSession();
  if (!session) return Response.json({ error: "not allowed" }, { status: 403 });
  const { id } = await context.params;
  return (await revokeToken(session.user.id, id))
    ? Response.json({ revoked: true })
    : Response.json({ error: "no such Manager" }, { status: 404 });
}
