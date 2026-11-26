/** A player's vote on /listen. Open to everyone; one vote per voter per showing. */
import { langParam } from "@/lib/lang-server";
import { currentSession } from "@/lib/session";
import { VERDICTS, type Verdict } from "@/lib/voice-design/types";
import { castVote, VoteError } from "@/lib/voice-feedback/public";
import { voterFor } from "@/lib/voice-feedback/voter";

export const dynamic = "force-dynamic";

const NOTE_MAX = 2000;

export async function POST(request: Request) {
  const { lang, denied } = await langParam(request);
  if (denied) return denied;
  const body = (await request.json().catch(() => null)) as { showingId?: unknown; verdict?: unknown; note?: unknown } | null;
  const showingId = body?.showingId;
  const verdict = body?.verdict;
  const note = typeof body?.note === "string" ? body.note.trim() : "";
  if (typeof showingId !== "number" || !Number.isSafeInteger(showingId) || !VERDICTS.includes(verdict as Verdict)) {
    return Response.json({ error: "showingId and a verdict are required" }, { status: 400 });
  }
  if (note.length > NOTE_MAX) return Response.json({ error: `Keep the note under ${NOTE_MAX} characters.` }, { status: 400 });
  const userId = (await currentSession())?.user.id ?? null;
  try {
    await castVote(lang, { showingId, voter: await voterFor(userId), userId, verdict: verdict as Verdict, note });
    return Response.json({ ok: true });
  } catch (error) {
    if (error instanceof VoteError) return Response.json({ error: error.message }, { status: error.status });
    throw error;
  }
}
