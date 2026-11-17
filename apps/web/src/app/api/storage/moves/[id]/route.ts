/** Stops a move. What it already moved stays moved. */
import { cancelMove } from "@/lib/storage/moves";

import { withTeamAdmin } from "../../guard";

export const dynamic = "force-dynamic";

export const DELETE = withTeamAdmin(async (_request, { team, id }) => {
  await cancelMove(team, id);
  return new Response(null, { status: 204 });
}, "id");
