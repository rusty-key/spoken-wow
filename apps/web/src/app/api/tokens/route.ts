/** Never carries a token's value. */
import { requireAdminSession } from "@/lib/generation/authz";
import { listAllTokens, revokeToken } from "@/lib/tokens/store";
import { isUuid } from "@/lib/uuid";

export const dynamic = "force-dynamic";

export async function GET() {
  const { denied } = await requireAdminSession();
  if (denied) return denied;
  return Response.json({ tokens: await listAllTokens() });
}

export async function DELETE(request: Request) {
  const { denied } = await requireAdminSession();
  if (denied) return denied;

  const id = new URL(request.url).searchParams.get("id");
  if (!id || !isUuid(id) || !(await revokeToken(id, null))) {
    return Response.json({ error: "no such token" }, { status: 404 });
  }
  return Response.json({ revoked: true });
}
