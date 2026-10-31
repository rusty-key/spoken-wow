/** The Manager's poll for its token. The token is handed over once. */
import { pollPairing } from "@/lib/worker/tokens";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { poll?: unknown };
  if (typeof body.poll !== "string" || !body.poll) {
    return Response.json({ error: "poll is required" }, { status: 400 });
  }
  return Response.json(await pollPairing(body.poll));
}
