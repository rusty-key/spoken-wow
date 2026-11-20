import { deletionPreview, retryDeletion } from "@/lib/teams/delete";

import { withAdmin } from "../../guard";

export const dynamic = "force-dynamic";

/** What deleting the team would take with it, for the dialog that confirms it. */
export const GET = withAdmin(async (_request, _actorId, team) => Response.json(await deletionPreview(team)), "id");

/** Retry: a deletion that stopped on a failure starts again from its delistings. */
export const POST = withAdmin(async (_request, actorId, team) => {
  const state = await retryDeletion(team, actorId);
  return Response.json({ state }, { status: state === "deleted" ? 200 : 202 });
}, "id");
