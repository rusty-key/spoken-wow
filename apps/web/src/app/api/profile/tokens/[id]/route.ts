import { currentSession } from "@/lib/session";
import { revokeToken } from "@/lib/tokens/store";
import { isUuid } from "@/lib/uuid";

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
