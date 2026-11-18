import { deleteTeam, renameTeam, setOwnStorage } from "@/lib/teams/admin";

import { bad, bodyOf, withAdmin } from "../guard";

export const dynamic = "force-dynamic";

/**
 * `{ name }` renames the team; `{ ownStorage }` says whether it must keep its audio in its own
 * bucket. Either or both; each is checked before anything changes.
 */
export const PATCH = withAdmin(async (request, actorId, team) => {
  const { name, ownStorage } = await bodyOf(request);
  if (name === undefined && ownStorage === undefined) return bad("Send a name, ownStorage or both.");
  if (name !== undefined && (typeof name !== "string" || !name.trim())) return bad("A team needs a name.");
  if (ownStorage !== undefined && typeof ownStorage !== "boolean") return bad("ownStorage is true or false.");
  if (typeof name === "string") await renameTeam(team, name.trim(), actorId);
  if (typeof ownStorage === "boolean") await setOwnStorage(team, ownStorage, actorId);
  return Response.json({ ok: true });
}, "id");

/** Refused while the team holds a language or anything made under it. */
export const DELETE = withAdmin(async (_request, actorId, team) => {
  await deleteTeam(team, actorId);
  return Response.json({ ok: true });
}, "id");
