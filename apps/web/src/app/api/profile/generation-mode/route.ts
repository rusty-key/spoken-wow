/** Where the signed-in author's queued lines are generated, per provider. */
import { recordActivity } from "@/lib/activity/store";
import { currentSpender } from "@/lib/generation/authz";
import { isProvider } from "@/lib/generation/providers";
import { readModes, writeMode } from "@/lib/worker/mode";
import { listTokens } from "@/lib/worker/tokens";

export const dynamic = "force-dynamic";

const FORBIDDEN = () => Response.json({ error: "not allowed" }, { status: 403 });

export async function GET() {
  const session = await currentSpender();
  if (!session) return FORBIDDEN();
  return Response.json({ modes: await readModes(session.user.id), managers: await listTokens(session.user.id) });
}

export async function PUT(request: Request) {
  const session = await currentSpender();
  if (!session) return FORBIDDEN();
  const body = (await request.json().catch(() => ({}))) as { provider?: unknown; mode?: unknown };
  if (!isProvider(body.provider) || (body.mode !== "site" && body.mode !== "local")) {
    return Response.json({ error: "provider and mode (site or local) are required" }, { status: 400 });
  }
  await writeMode(session.user.id, body.provider, body.mode);
  await recordActivity({
    kind: "generation.mode",
    lang: null,
    actorId: session.user.id,
    subject: session.user.id,
    detail: { provider: body.provider, mode: body.mode },
  });
  return Response.json({ modes: await readModes(session.user.id) });
}
