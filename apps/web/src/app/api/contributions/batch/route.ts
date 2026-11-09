/**
 * Many contributions at once: what a player's background gathering collected, uploaded as
 * the saved variables file the game wrote (the page pulls the envelopes out of it first --
 * lib/contributions/saved-variables.ts -- so only they are sent).
 *
 * A sibling of ../route.ts rather than a mode of it, as that file asks of any new verb on this
 * unauthenticated path. Every envelope is checked exactly as a single one is -- parseEnvelope,
 * then submissionFrom -- and one that fails is counted and skipped rather than failing the
 * rest: a file gathered over an evening should not be refused whole for one bad line.
 *
 * A file the Spoken Manager sends carries the install id it made when its player turned
 * Sharing on. Then a line the corpus already knows is counted as a missing-audio hit
 * (lib/contributions/missing-audio.ts) rather than dropped, and the install has an allowance of
 * its own beside the IP's. Without one, as from /contribute, known lines are dropped as before.
 *
 * Places are refused here. A places contribution is the description the player writes on the
 * page, and a file has none; the addon never gathers them, so one arriving is a hand-built file.
 */
import { headers } from "next/headers";
import { after } from "next/server";

import { auth } from "@/lib/auth";
import { clientIp } from "@/lib/reports/client-ip";
import { parseEnvelope } from "@/lib/contributions/envelope";
import {
  CONTRIBUTION_WINDOW_MS,
  CONTRIBUTIONS_PER_HOUR,
  resolveSpeakers,
  speakersOf,
  stringOrNull,
} from "@/lib/contributions/intake";
import { lineStates } from "@/lib/contributions/known";
import {
  INSTALL_UPLOADS_PER_HOUR,
  hitFrom,
  installIdFrom,
  recordMissingAudio,
  type MissingAudioHit,
} from "@/lib/contributions/missing-audio";
import { MAX_ENVELOPES } from "@/lib/contributions/saved-variables";
import {
  countRecentContributions,
  countRecentInstallUploads,
  createContributions,
  recordContributionHit,
} from "@/lib/contributions/store";
import { submissionFrom } from "@/lib/contributions/submission";
import type { Submission } from "@/lib/contributions/contributions";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;

  // 200 and not 400, as on the single route: a bot that believes it succeeded stops adapting.
  if (typeof body.website === "string" && body.website.trim()) {
    return Response.json({ ok: true, accepted: 0, known: 0, counted: 0, refused: {} });
  }

  const envelopes = body.envelopes;
  if (!Array.isArray(envelopes) || envelopes.length === 0) {
    return Response.json({ error: "missing" }, { status: 400 });
  }
  if (envelopes.length > MAX_ENVELOPES) {
    return Response.json({ error: "too many" }, { status: 413 });
  }

  const ip = clientIp(request);
  const installId = installIdFrom(body.installId);
  // One hit per upload against the single route's allowance -- see intake.ts.
  const [recent, installRecent, session] = await Promise.all([
    countRecentContributions(ip, CONTRIBUTION_WINDOW_MS),
    installId ? countRecentInstallUploads(installId, CONTRIBUTION_WINDOW_MS) : 0,
    auth.api.getSession({ headers: await headers() }),
  ]);
  if (recent >= CONTRIBUTIONS_PER_HOUR || installRecent >= INSTALL_UPLOADS_PER_HOUR) {
    return Response.json({ error: "too many contributions" }, { status: 429 });
  }

  const identity = {
    body: null,
    userId: session?.user.id ?? null,
    name: session ? null : stringOrNull(body.name, 200),
    email: session ? null : stringOrNull(body.email, 320),
    ip,
  };

  const submissions: Submission[] = [];
  const refused: Record<string, number> = {};
  const refuse = (reason: string) => {
    refused[reason] = (refused[reason] ?? 0) + 1;
  };

  for (const raw of envelopes) {
    if (typeof raw !== "string") {
      refuse("malformed");
      continue;
    }
    // parseEnvelope refuses an oversized one itself; the single route measures first only
    // because it answers that case with its own status code.
    const parsed = parseEnvelope(raw);
    if (!parsed.ok) {
      refuse(parsed.error);
      continue;
    }
    if (parsed.value.source === "places") {
      refuse("describe");
      continue;
    }
    const submission = submissionFrom(parsed.value, raw, null);
    if (!submission) {
      refuse("incomplete");
      continue;
    }
    submissions.push(submission);
  }

  // Lines the corpus already has are counted as accepted -- the player sent nothing wrong --
  // and not stored as contributions: known.ts's lineStates, asked once for the file. With an
  // install id each is a line that player heard in silence, and is counted as one.
  const states = await lineStates(submissions);
  const hits: MissingAudioHit[] = [];
  const unknown: Submission[] = [];
  let known = 0;
  for (const [index, submission] of submissions.entries()) {
    const state = states[index];
    if (state?.kind !== "known") {
      unknown.push(submission);
      continue;
    }
    known++;
    const hit = installId ? hitFrom(submission, state.lineId) : null;
    if (hit) hits.push(hit);
  }
  await createContributions(unknown, identity);
  if (installId) await recordMissingAudio(installId, hits);

  await recordContributionHit(ip, installId);

  // After the response: Cloudflare gives up on an origin at 100 seconds, and the lines are stored
  // by now. Worked out first so the file's text is not held in memory for the whole run.
  const speakers = speakersOf(unknown);
  after(() => resolveSpeakers(speakers));

  return Response.json({
    ok: true,
    accepted: submissions.length,
    known,
    counted: hits.length,
    refused,
  });
}
