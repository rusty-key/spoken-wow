/**
 * Filing a report.
 *
 * POST IS THE ONLY UNAUTHENTICATED WRITE IN THIS APP. Anyone on the internet can reach it,
 * because the person best placed to report a bad line is a player who has just heard one and
 * has no account here. Every defence below exists because of that, and any verb added to this
 * path inherits the exposure - put it in a sibling route instead, as /resolve is.
 *
 * A report never becomes a regeneration job. Regenerating spends ElevenLabs credits, so a
 * public write that could start one would be a public write that spends money. A collaborator
 * reads the report and queues the file through the existing flow.
 */
import { headers } from "next/headers";

import { audioRelPath } from "@/lib/audio";
import { auth } from "@/lib/auth";
import { clientIp } from "@/lib/reports/client-ip";
import { validateSubmission } from "@/lib/reports/reports";
import { langParam } from "@/lib/lang-server";
import { countRecent, createReport } from "@/lib/reports/store";
import { envelopeFor } from "@/lib/reports/context";
import type { Envelope } from "@/lib/contributions/envelope";
import { submissionFrom } from "@/lib/contributions/submission";
import {
  CONTRIBUTION_WINDOW_MS,
  CONTRIBUTIONS_PER_HOUR,
  type Identity,
  knownSubmissions,
  storeSubmission,
} from "@/lib/contributions/intake";
import { countRecentContributions, recordContributionHit } from "@/lib/contributions/store";
import { formatTarget, parseTarget, resolveTarget } from "@/lib/reports/target";
import { pageById } from "@/lib/readables/catalogue";
import { lineByPath } from "@/lib/places/catalogue";
import { lineByPath as bossByPath } from "@/lib/bosses/catalogue";
import { type Source, isSource } from "@/lib/sections";

export const dynamic = "force-dynamic";

/** What a report is filed against. `file` only for a quests line, which is all an override can be on. */
type Address = { lineId: string | null; target: string; file?: string | null };

/** Deliberately not configurable: a knob nobody turns is a knob set wrong. */
const PER_HOUR = 10;
const WINDOW_MS = 60 * 60 * 1000;

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;

  // A hidden field a human never fills. 200 and not 400: an error response teaches the script
  // to stop sending the field, and a bot that believes it succeeded stops adapting.
  if (typeof body.website === "string" && body.website.trim()) {
    return Response.json({ ok: true });
  }

  // Which language's line is being reported. Absent is English, which is every report an
  // addon has ever filed; the target is resolved the same way in any language, since a
  // quest, a zone and a page are the same thing whatever it is read in.
  const { lang, denied } = await langParam(request);
  if (denied) return denied;

  // Absent means quests, so a client that predates the second section keeps working.
  const source: Source = isSource(body.source) ? body.source : "quests";

  /**
   * What the address resolves to, which the three sections answer differently.
   *
   * A quests address is one the addon built out of a quest id and an event, or out of a
   * unit GUID, and it can legitimately resolve to nothing -- when the data module failed to
   * load there is no sound data at all, and that is the failure most worth reporting. So it
   * is validated for shape and the lineId is filled in only if it resolves.
   *
   * A places address is the line's own audio path, because that is what the report link is,
   * and it either names a line or it does not. Accepting one that names nothing would put a
   * row in triage that nobody can act on -- there is no equivalent of a data module having
   * failed to load, since the address came from a page this site rendered.
   *
   * A readables address is the page id the addon built its link from, and is resolved as strictly
   * as a places one for the same reason: the reporter got here from a page this site rendered,
   * so an id naming nothing is a typo in the URL bar rather than a corpus that failed to load.
   *
   * A bosses address is the boss's audio path, resolved as strictly as a places one.
   */
  const raw = typeof body.target === "string" ? body.target : null;
  const addressed =
    source === "places"
      ? await placesTarget(raw)
      : source === "readables"
        ? await readablesTarget(raw)
        : source === "bosses"
          ? await bossesTarget(raw)
          : await questsTarget(raw, body.lineId);

  if (!addressed) {
    return Response.json({ error: "unknown target" }, { status: 400 });
  }

  const validated = validateSubmission(body);
  if (!validated.ok) {
    return Response.json({ error: validated.error }, { status: 400 });
  }

  const ip = clientIp(request);
  if ((await countRecent(ip, WINDOW_MS)) >= PER_HOUR) {
    return Response.json({ error: "too many reports" }, { status: 429 });
  }

  // A signed-in reporter's identity comes from the session, and any name or email in the body
  // is dropped rather than merged: letting someone sign in and then type a different name is a
  // way to put words in another person's mouth.
  const session = await auth.api.getSession({ headers: await headers() });

  const identity = {
    userId: session?.user.id ?? null,
    name: session ? null : validated.value.name,
    email: session ? null : validated.value.email,
    ip,
  };

  // parseEnvelope refuses anything past its own MAX_BYTES before reading it.
  const envelope = envelopeFor(body.context, source);
  const context = envelope && { fields: envelope.fields, text: envelope.text };

  await createReport({
    source,
    lang,
    lineId: addressed.lineId,
    target: addressed.target,
    file: addressed.file,
    category: validated.value.category,
    body: validated.value.body,
    ...identity,
    context,
  });

  // The report is filed by now: a failure here must not answer 500 and invite a second one.
  if (envelope && validated.value.category === "missing") {
    await contributeMissing(envelope, body.context as string, validated.value.body, identity).catch((error) =>
      console.error("filing a missing report as a contribution failed", error),
    );
  }

  return Response.json({ ok: true });
}

/**
 * "Nothing played" with the text attached is also a contribution: the player's client holds a
 * line the corpus may not. Filed through the contribute route's own checks and allowance, and
 * dropped as that route drops it when the corpus already has the line -- then the audio, not
 * the text, is what is missing, and the report says so. Places never: a places report is about
 * lore that exists, and a places contribution is a description someone wrote. Readables never
 * in practice: a readables report names a corpus page by `id`, so submissionFrom finds no `page`.
 */
async function contributeMissing(
  envelope: Envelope,
  raw: string,
  complaint: string,
  identity: Omit<Identity, "body"> & { ip: string },
): Promise<void> {
  if (envelope.source === "places") return;
  const submission = submissionFrom(envelope, raw);
  if (!submission) return;
  const [recent, [known]] = await Promise.all([
    countRecentContributions(identity.ip, CONTRIBUTION_WINDOW_MS),
    knownSubmissions([submission]),
  ]);
  if (recent >= CONTRIBUTIONS_PER_HOUR) return;
  if (!known) {
    await storeSubmission(submission, { ...identity, body: complaint });
  }
  await recordContributionHit(identity.ip);
}

/**
 * A quests address: validated for shape, resolved where it can be.
 *
 * Only a lineId the address actually resolves to is stored, so the browser cannot attach a
 * report to a line the reporter never saw.
 */
async function questsTarget(
  raw: string | null,
  claimed: unknown,
): Promise<Address | null> {
  const target = raw ? parseTarget(raw.split("/")) : null;
  if (!target) return null;

  const wanted = typeof claimed === "string" ? claimed : null;
  const lines = await resolveTarget(target);
  const line = lines.find((each) => each.lineId === wanted);
  return { lineId: line?.lineId ?? null, target: formatTarget(target), file: line ? audioRelPath(line) : null };
}

/**
 * A readables address: the page id, '261'.
 *
 * The lineId is taken from the page the id resolves to rather than from the body, as the
 * places branch does. Nothing the reporter can edit decides which row triage sees.
 */
async function readablesTarget(
  raw: string | null,
): Promise<Address | null> {
  if (!raw) return null;

  const page = await pageById(raw);
  if (!page) return null;

  return { lineId: page.id, target: page.file };
}

/** A places address: the line's own audio path, '1411/razor-hill'. */
async function placesTarget(
  raw: string | null,
): Promise<Address | null> {
  if (!raw) return null;

  const [mapID, slug] = raw.split("/");
  const entry = await lineByPath(Number(mapID), slug ?? "");
  if (!entry) return null;

  return { lineId: entry.id, target: entry.file };
}

/** A bosses address: the boss's own audio path, '36/edwin-vancleef'. */
async function bossesTarget(
  raw: string | null,
): Promise<Address | null> {
  if (!raw) return null;

  // Exactly '<map>/<slug>', as targetExplorerHref reads it: a trailing segment is no address.
  const segments = raw.split("/");
  if (segments.length !== 2) return null;
  const [map, slug] = segments;
  const entry = await bossByPath(Number(map), slug);
  if (!entry) return null;

  return { lineId: entry.id, target: entry.file };
}
