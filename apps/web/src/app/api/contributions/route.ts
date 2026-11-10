/**
 * Sending text this corpus does not have.
 *
 * THIS IS THE SECOND UNAUTHENTICATED WRITE IN THIS APP, and it exists for the reason the first
 * one does: the person best placed to send a missing quest is the player standing in front of
 * the NPC, and they have no account here. Every defence below is because of that, and any verb
 * added to this path inherits the exposure -- put it in a sibling route, as /resolve is for
 * reports.
 *
 * A contribution never becomes a regeneration job, for the reason api/reports/route.ts gives:
 * a public write that could start one would be a public write that spends money. A
 * collaborator reads the row and the pipeline picks it up from the export.
 */
import { headers } from "next/headers";

import { auth } from "@/lib/auth";
import { clientIp } from "@/lib/reports/client-ip";
import { COMPLAINT_MAX, descriptionFrom } from "@/lib/contributions/contributions";
import { MAX_BYTES, parseEnvelope } from "@/lib/contributions/envelope";
import { keepClassWords } from "@/lib/contributions/class-words";
import { submissionFrom } from "@/lib/contributions/submission";
import {
  CONTRIBUTION_WINDOW_MS,
  CONTRIBUTIONS_PER_HOUR,
  knownSubmissions,
  storeSubmission,
  stringOrNull,
} from "@/lib/contributions/intake";
import { countRecentContributions, recordContributionHit } from "@/lib/contributions/store";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;

  // 200 and not 400, as on the reports route: a bot that believes it succeeded stops adapting.
  if (typeof body.website === "string" && body.website.trim()) {
    return Response.json({ ok: true });
  }

  // Distinct from parseEnvelope's own "truncated": that means a real paste got cut short, and
  // this means there was never a string to parse at all -- coercing it to "" and letting it
  // fall into parseEnvelope used to report the wrong one of those two.
  if (typeof body.envelope !== "string") {
    return Response.json({ error: "missing" }, { status: 400 });
  }
  const raw = body.envelope;
  // Checked before parsing, not inside it: the cap exists so a pasted log is refused rather
  // than walked.
  if (new TextEncoder().encode(raw).length > MAX_BYTES) {
    return Response.json({ error: "oversize" }, { status: 413 });
  }

  const parsed = parseEnvelope(raw);
  if (!parsed.ok) {
    return Response.json({ error: parsed.error }, { status: 400 });
  }

  // A place with no lore is only worth filing with something said about it: the addon names
  // the place, and the description is the contribution.
  const description = parsed.value.source === "places" ? descriptionFrom(body.description) : null;
  if (parsed.value.source === "places" && !description) {
    return Response.json({ error: "describe" }, { status: 400 });
  }

  const sent = submissionFrom(parsed.value, raw, description);
  if (!sent) {
    return Response.json({ error: "incomplete" }, { status: 400 });
  }
  const [submission] = await keepClassWords([sent]);

  const complaint = typeof body.body === "string" ? body.body.trim().slice(0, COMPLAINT_MAX) : "";

  const ip = clientIp(request);
  if ((await countRecentContributions(ip, CONTRIBUTION_WINDOW_MS)) >= CONTRIBUTIONS_PER_HOUR) {
    return Response.json({ error: "too many contributions" }, { status: 429 });
  }

  // Identity from the session when there is one, and the typed fields dropped rather than
  // merged -- the reports route's reasoning: signing in and typing someone else's name is a
  // way to put words in their mouth.
  const session = await auth.api.getSession({ headers: await headers() });

  // A line the corpus already has is thanked for and dropped, the same answer as a stored one:
  // the player did nothing wrong, there is just nothing to triage. A complaint about it is
  // still kept -- that is a report about the line, not a copy of it.
  const [known] = await knownSubmissions([submission]);
  if (!known || complaint) {
    await storeSubmission(submission, {
      body: complaint || null,
      userId: session?.user.id ?? null,
      name: session ? null : stringOrNull(body.name, 200),
      email: session ? null : stringOrNull(body.email, 320),
      ip,
    });
  }

  // After the write, and unconditionally: the hit is what the limiter counts, and an identical
  // paste that only bumped a count is still a paste.
  await recordContributionHit(ip);

  return Response.json({ ok: true });
}
