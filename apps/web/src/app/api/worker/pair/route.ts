/**
 * A Spoken Manager asks to be paired: the code it shows its owner, the secret it polls with,
 * and where the owner approves it. No session: the Manager has none yet.
 */
import { startPairing } from "@/lib/worker/tokens";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { label?: unknown };
  const label = typeof body.label === "string" ? body.label.replace(/[\u0000-\u001f]/g, "").trim() : "";
  const { code, poll, expiresAt } = await startPairing(label);
  const origin = process.env.BETTER_AUTH_URL ?? new URL(request.url).origin;
  return Response.json({
    code,
    poll,
    expiresAt: expiresAt.toISOString(),
    verifyUrl: `${origin}/profile?pair=${encodeURIComponent(code)}`,
  });
}
