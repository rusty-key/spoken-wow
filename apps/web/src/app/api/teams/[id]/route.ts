import { renameTeam } from "@/lib/teams/admin";

import { bad, bodyOf, withAdmin } from "../guard";

export const dynamic = "force-dynamic";

export const PATCH = withAdmin(async (request, actorId, team) => {
  const { name } = await bodyOf(request);
  if (typeof name !== "string" || !name.trim()) return bad("A team needs a name.");
  await renameTeam(team, name.trim(), actorId);
  return Response.json({ ok: true });
}, "id");
