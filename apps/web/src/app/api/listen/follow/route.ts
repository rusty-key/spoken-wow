/**
 * Whether this visitor hears when voices they voted on change. An account follows at its own
 * address and can switch that off; an anonymous voter gives an address and confirms it.
 */
import { sendFollowConfirmEmail } from "@/lib/email";
import { currentSession } from "@/lib/session";
import { followState, requestFollow, setAccountFollow, stopFollow } from "@/lib/voice-feedback/follow";
import { currentVoter, voterFor } from "@/lib/voice-feedback/voter";

export const dynamic = "force-dynamic";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

async function account() {
  const user = (await currentSession())?.user;
  return user ? { id: user.id, email: user.email } : null;
}

export async function GET() {
  const user = await account();
  return Response.json(await followState(await currentVoter(user?.id ?? null), user));
}

export async function POST(request: Request) {
  const user = await account();
  const body = (await request.json().catch(() => null)) as { email?: unknown; on?: unknown } | null;
  if (user) {
    if (typeof body?.on !== "boolean") return Response.json({ error: "on is required" }, { status: 400 });
    await setAccountFollow(user.email, body.on);
    return Response.json(await followState(`u:${user.id}`, user));
  }
  const email = typeof body?.email === "string" ? body.email.trim() : "";
  if (!EMAIL.test(email) || email.length > 254) return Response.json({ error: "Enter an email address." }, { status: 400 });
  const voter = await voterFor(null);
  const outcome = await requestFollow(voter, email, new Date(), sendFollowConfirmEmail);
  return Response.json({ ...(await followState(voter, null)), outcome });
}

export async function DELETE() {
  const user = await account();
  const voter = await currentVoter(user?.id ?? null);
  if (user || !voter) return Response.json({ error: "nothing to stop" }, { status: 400 });
  await stopFollow(voter);
  return Response.json(await followState(voter, null));
}
