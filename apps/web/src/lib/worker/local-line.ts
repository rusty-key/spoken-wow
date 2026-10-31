/**
 * Single-line routes answer with a take, which cannot happen when the key is on another
 * machine, so the line is queued for the Manager as a batch of one and the queue panel adopts
 * its take.
 */
import "server-only";

import { catalogue as bossesCatalogue } from "@/lib/bosses/catalogue";
import { catalogue as readablesCatalogue } from "@/lib/readables/catalogue";
import { readPreference } from "@/lib/generation/preference";
import { queueBatch, type QueueEntry } from "@/lib/generation/queue";
import { bossesEntry, placesEntry, questsEntry, readablesEntry } from "@/lib/generation/queue-entries";
import type { Provider } from "@/lib/generation/speakers/speaker";
import type { Lang } from "@/lib/lang";
import { lineIndex } from "@/lib/quests/catalogue";
import { readOverrides } from "@/lib/quests/overrides";
import { batchJobs } from "@/lib/search";
import type { Source } from "@/lib/sections";
import { catalogue as placesCatalogue } from "@/lib/places/catalogue";

import { modeOf } from "./mode";

async function entryFor(source: Source, lineId: string, lang: Lang): Promise<QueueEntry | null> {
  if (source === "quests") {
    const group = (await lineIndex(lang)).get(lineId);
    if (!group) return null;
    const [job] = batchJobs(group, await readOverrides(lang));
    return job ? questsEntry(job) : null;
  }
  if (source === "places") {
    const entry = (await placesCatalogue(lang)).find((candidate) => candidate.id === lineId);
    return entry ? placesEntry(entry) : null;
  }
  if (source === "bosses") {
    const entry = (await bossesCatalogue(lang)).find((candidate) => candidate.id === lineId);
    return entry ? bossesEntry(entry) : null;
  }
  const page = (await readablesCatalogue(lang)).find((candidate) => candidate.id === lineId);
  return page ? readablesEntry(page) : null;
}

/** Null when the author generates with `provider` on the site. */
export async function queuedForManager(
  source: Source,
  lineId: string,
  userId: string,
  lang: Lang,
  pinned?: Provider,
): Promise<Response | null> {
  const provider = pinned ?? (await readPreference(userId, lang)).provider;
  if ((await modeOf(userId, provider)) !== "local") return null;

  const entry = await entryFor(source, lineId, lang);
  if (!entry) return Response.json({ error: `no line ${lineId}`, kind: "bad-request", fatal: false }, { status: 404 });
  const { batchId, queued } = await queueBatch("one line", userId, source, lang, [entry], provider);
  return Response.json(
    {
      error: queued
        ? "Queued for your Spoken Manager, which generates your lines with your own key."
        : "Already queued.",
      kind: "upstream",
      fatal: false,
      queued: queued > 0,
      ...(batchId ? { batchId } : {}),
    },
    { status: 409 },
  );
}
