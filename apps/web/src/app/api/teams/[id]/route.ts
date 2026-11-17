import { renameTeam, setOwnStorage } from "@/lib/teams/admin";

import { bad, bodyOf, withAdmin } from "../guard";

export const dynamic = "force-dynamic";

/** `{ name }` renames the team; `{ ownStorage }` says whether it must keep its audio in its own bucket. */
export const PATCH = withAdmin(async (request, actorId, team) => {
  const { name, ownStorage } = await bodyOf(request);
  if (name === undefined && typeof ownStorage === "boolean") {
    await setOwnStorage(team, ownStorage, actorId);
    return Response.json({ ok: true });
  }
  if (typeof name !== "string" || !name.trim()) return bad("A team needs a name.");
  await renameTeam(team, name.trim(), actorId);
  return Response.json({ ok: true });
}, "id");
