/**
 * One of a team's buckets: PATCH its name, public address or key, POST an action, DELETE an empty
 * one. Each answers with the bucket as it now is, and a test's steps when one ran.
 */
import { requireCapability } from "@/lib/generation/authz";
import { langParam } from "@/lib/lang-server";
import {
  backendChange,
  backendView,
  changeBackend,
  removeBackend,
  retireBackend,
  setWriting,
  StorageError,
  testBackend,
} from "@/lib/storage/backends";
import { refusal } from "@/lib/storage/view";
import { teamOf } from "@/lib/teams/store";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

async function guard(request: Request, params: Params["params"]) {
  const { lang, denied: unknown } = await langParam(request);
  if (unknown) return { denied: unknown } as const;
  const { denied } = await requireCapability("admin", lang);
  if (denied) return { denied } as const;
  const { id } = await params;
  if (!UUID.test(id)) return { denied: Response.json({ error: "no such bucket" }, { status: 404 }) } as const;
  return { denied: null, id, team: await teamOf(lang) } as const;
}

const body = async (request: Request) => {
  const parsed = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!parsed || typeof parsed !== "object") throw new StorageError("A JSON body is required.");
  return parsed;
};

export async function PATCH(request: Request, { params }: Params) {
  try {
    const at = await guard(request, params);
    if (at.denied) return at.denied;
    const test = await changeBackend(at.team, at.id, backendChange(await body(request)));
    return Response.json({ backend: await backendView(at.team, at.id), test });
  } catch (error) {
    return refusal(error);
  }
}

const ACTIONS = ["test", "write", "stop", "retire"] as const;

/** `test` runs the probe; `write` sends the team's new objects here; `stop` sends them to our bucket; `retire` is for good. */
export async function POST(request: Request, { params }: Params) {
  try {
    const at = await guard(request, params);
    if (at.denied) return at.denied;
    const { action } = await body(request);
    if (!ACTIONS.includes(action as (typeof ACTIONS)[number])) {
      throw new StorageError(`The action is one of ${ACTIONS.join(", ")}.`);
    }
    let test = null;
    if (action === "test") test = await testBackend(at.team, at.id);
    if (action === "write") await setWriting(at.team, at.id);
    if (action === "stop") {
      const current = await backendView(at.team, at.id);
      if (current.writing) await setWriting(at.team, null);
    }
    if (action === "retire") await retireBackend(at.team, at.id);
    return Response.json({ backend: await backendView(at.team, at.id), test });
  } catch (error) {
    return refusal(error);
  }
}

export async function DELETE(request: Request, { params }: Params) {
  try {
    const at = await guard(request, params);
    if (at.denied) return at.denied;
    await removeBackend(at.team, at.id);
    return new Response(null, { status: 204 });
  } catch (error) {
    return refusal(error);
  }
}
