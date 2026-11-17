/** Stops a move. What it already moved stays moved. */
import { requireCapability } from "@/lib/generation/authz";
import { langParam } from "@/lib/lang-server";
import { cancelMove } from "@/lib/storage/moves";
import { refusal } from "@/lib/storage/view";
import { teamOf } from "@/lib/teams/store";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { lang, denied: unknown } = await langParam(request);
  if (unknown) return unknown;
  const { denied } = await requireCapability("admin", lang);
  if (denied) return denied;
  const { id } = await params;
  if (!UUID.test(id)) return Response.json({ error: "no such move" }, { status: 404 });
  try {
    await cancelMove(await teamOf(lang), id);
    return new Response(null, { status: 204 });
  } catch (error) {
    return refusal(error);
  }
}
