/** Starts moving a team's objects between buckets. `from` and `to` are bucket ids; null is Spoken's archive. */
import { StorageError } from "@/lib/storage/backends";
import { startMove } from "@/lib/storage/moves";
import { isUuid } from "@/lib/uuid";

import { jsonBody, withTeamAdmin } from "../guard";

export const dynamic = "force-dynamic";

const end = (value: unknown, name: string): string | null => {
  if (value === null) return null;
  if (typeof value === "string" && isUuid(value)) return value.toLowerCase();
  throw new StorageError(`${name} is a bucket's id, or null for Spoken's archive.`);
};

export const POST = withTeamAdmin(async (request, { team, userId }) => {
  const body = await jsonBody(request);
  if (!("from" in body) || !("to" in body)) throw new StorageError("from and to are required.");
  const move = await startMove(team, end(body.from, "from"), end(body.to, "to"), userId);
  return Response.json({ move }, { status: 202 });
});
