/** The signed-in author approves a pairing code their Manager shows. */
import { recordActivity } from "@/lib/activity/store";
import { currentSession } from "@/lib/session";
import { approvePairing, pendingPairing } from "@/lib/worker/tokens";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const session = await currentSession();
  if (!session) return Response.json({ error: "sign in first" }, { status: 401 });
  const code = new URL(request.url).searchParams.get("code") ?? "";
  const pairing = await pendingPairing(code);
  return pairing
    ? Response.json({ pairing })
    : Response.json({ error: "that code is unknown or has expired" }, { status: 404 });
}

export async function POST(request: Request) {
  const session = await currentSession();
  if (!session) return Response.json({ error: "sign in first" }, { status: 401 });
  const body = (await request.json().catch(() => ({}))) as { code?: unknown };
  if (typeof body.code !== "string" || !(await approvePairing(body.code, session.user.id))) {
    return Response.json({ error: "that code is unknown or has expired" }, { status: 404 });
  }
  // A credential was issued, so who and when is worth a row.
  await recordActivity({ kind: "worker.paired", lang: null, actorId: session.user.id, subject: session.user.id, detail: {} });
  return Response.json({ approved: true });
}
