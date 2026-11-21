import { describedName, NAME_RULE } from "@/lib/languages/validate";
import { renameTeam, setOfficial, setOwnStorage } from "@/lib/teams/admin";
import { startDeletion } from "@/lib/teams/delete";

import { bad, bodyOf, withAdmin } from "../guard";

export const dynamic = "force-dynamic";

/**
 * `{ name }` renames the team; `{ ownStorage }` says whether it must keep its audio in its own
 * bucket; `{ official }` whether its releases skip review. Any of them; each is checked before
 * anything changes. The slug is never changed: an installed team pack's folder carries it.
 */
export const PATCH = withAdmin(async (request, actorId, team) => {
  const { name, ownStorage, official } = await bodyOf(request);
  if (name === undefined && ownStorage === undefined && official === undefined) {
    return bad("Send a name, ownStorage or official.");
  }
  const renamed = name === undefined ? null : describedName(name);
  if (name !== undefined && !renamed) return bad(`A team needs a name of ${NAME_RULE}.`);
  if (ownStorage !== undefined && typeof ownStorage !== "boolean") return bad("ownStorage is true or false.");
  if (official !== undefined && typeof official !== "boolean") return bad("official is true or false.");
  if (renamed) await renameTeam(team, renamed, actorId);
  if (typeof ownStorage === "boolean") await setOwnStorage(team, ownStorage, actorId);
  if (typeof official === "boolean") await setOfficial(team, official, actorId);
  return Response.json({ ok: true });
}, "id");

/**
 * `{ slug }`, typed by the site owner, starts deleting the team (lib/teams/delete.ts): 200 when it
 * is gone, 202 while its packs come off the channel first.
 */
export const DELETE = withAdmin(async (request, actorId, team) => {
  const { slug } = await bodyOf(request);
  if (typeof slug !== "string") return bad("Type the team's slug to delete it.");
  const state = await startDeletion(team, actorId, slug);
  return Response.json({ state }, { status: state === "deleted" ? 200 : 202 });
}, "id");
