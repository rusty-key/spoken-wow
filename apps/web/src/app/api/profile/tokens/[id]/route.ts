/** Revoking one of the signed-in maintainer's own API tokens. */
import { currentSession } from "@/lib/session";
import { isUuid, revokeToken } from "@/lib/tokens/store";

export const dynamic = "force-dynamic";

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await currentSession();
  if (!session) return Response.json({ error: "not allowed" }, { status: 403 });

  const { id } = await params;
  if (!isUuid(id) || !(await revokeToken(id, session.user.id))) {
    return Response.json({ error: "no such token" }, { status: 404 });
  }
  return Response.json({ revoked: true });
}
