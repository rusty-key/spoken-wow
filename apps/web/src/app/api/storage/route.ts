/** A team's own buckets, for its admins (docs/platform/STORAGE.md). */
import { backendInput, createBackend } from "@/lib/storage/backends";
import { storageView } from "@/lib/storage/view";

import { jsonBody, withTeamAdmin } from "./guard";

export const dynamic = "force-dynamic";

export const GET = withTeamAdmin(async (_request, { lang }) => Response.json(await storageView(lang)));

/** Saves a bucket unchecked; the page tests it straight after. */
export const POST = withTeamAdmin(async (request, { team, userId }) => {
  const backend = await createBackend(team, backendInput(await jsonBody(request)), userId);
  return Response.json({ backend }, { status: 201 });
});
