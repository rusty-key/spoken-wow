/**
 * One of a team's buckets. PATCH (its name, public address or key) and POST (an action) answer with
 * the bucket as it now is, and a test's steps when one ran; DELETE removes an empty one, with 204.
 */
import {
  backendChange,
  backendView,
  changeBackend,
  removeBackend,
  retireBackend,
  setWriting,
  StorageError,
  stopWriting,
  testBackend,
} from "@/lib/storage/backends";

import { jsonBody, withTeamAdmin } from "../guard";

export const dynamic = "force-dynamic";

export const PATCH = withTeamAdmin(async (request, { team, id }) => {
  const test = await changeBackend(team, id, backendChange(await jsonBody(request)));
  return Response.json({ backend: await backendView(team, id), test });
}, "id");

const ACTIONS = ["test", "write", "stop", "retire"] as const;

/** `test` runs the probe; `write` sends the team's new objects here; `stop` sends them to our bucket; `retire` is for good. */
export const POST = withTeamAdmin(async (request, { team, id }) => {
  const { action } = await jsonBody(request);
  if (!ACTIONS.includes(action as (typeof ACTIONS)[number])) {
    throw new StorageError(`The action is one of ${ACTIONS.join(", ")}.`);
  }
  let test = null;
  if (action === "test") test = await testBackend(team, id);
  if (action === "write") await setWriting(team, id);
  if (action === "stop") await stopWriting(team, id);
  if (action === "retire") await retireBackend(team, id);
  return Response.json({ backend: await backendView(team, id), test });
}, "id");

export const DELETE = withTeamAdmin(async (_request, { team, id }) => {
  await removeBackend(team, id);
  return new Response(null, { status: 204 });
}, "id");
