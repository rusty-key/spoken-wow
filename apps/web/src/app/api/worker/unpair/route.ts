/** A Manager unpairing itself revokes its own token, as unpairing it on /profile does. */
import { revokeCallingToken } from "@/lib/worker/tokens";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  return (await revokeCallingToken(request))
    ? Response.json({ unpaired: true })
    : Response.json({ error: "not paired" }, { status: 401 });
}
