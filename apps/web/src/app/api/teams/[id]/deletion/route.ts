import { deletionPreview } from "@/lib/teams/delete";

import { withAdmin } from "../../guard";

export const dynamic = "force-dynamic";

/** What deleting the team would take with it, for the dialog that confirms it. */
export const GET = withAdmin(async (_request, _actorId, team) => Response.json(await deletionPreview(team)), "id");
