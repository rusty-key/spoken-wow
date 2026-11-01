import { renameTeam } from "@/lib/teams/admin";

import { bad, bodyOf, isTeamId, refusal, siteAdmin } from "../guard";

export const dynamic = "force-dynamic";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const who = await siteAdmin();
  if ("denied" in who) return who.denied;

  const { id } = await params;
  const { name } = await bodyOf(request);
  if (!isTeamId(id)) return bad("No such team.");
  if (typeof name !== "string" || !name.trim()) return bad("A team needs a name.");
  try {
    await renameTeam(id, name.trim(), who.userId);
    return Response.json({ ok: true });
  } catch (error) {
    return refusal(error);
  }
}
