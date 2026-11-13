/**
 * What a batch holds, and how it is queued. The site's Regenerate button and the API's
 * generate endpoint both come through here, so the API cannot queue what the button could not.
 *
 * A plan is only the derivation: nothing here writes until `queuePlan`.
 */
import { NextResponse } from "next/server";

import { recordActivity } from "@/lib/activity/store";
import { broadcastStatuses } from "@/lib/broadcast/store";
import { baseLineId } from "@/lib/contributions/naming";
import type { CorpusLine } from "@/lib/corpus";
import type { Lang } from "@/lib/lang";
import { catalogue as bossCatalogue } from "@/lib/bosses/catalogue";
import { catalogue as zoneCatalogue } from "@/lib/places/catalogue";
import { catalogue as bookCatalogue } from "@/lib/readables/catalogue";
import { corpus } from "@/lib/quests/catalogue";
import { searchContext } from "@/lib/quests/context";
import { recordingsFor } from "@/lib/recordings/store";
import { batchPlan, matchingLines } from "@/lib/search";
import { filtersFromParams, needsLevels, needsStale } from "@/lib/search-request";
import type { Source } from "@/lib/sections";
import { pinnedVoices } from "@/lib/voices/references";

import { requireApiKey } from "./authz";
import { observedFishRate, observedRate } from "./calibration";
import { estimate, type Estimate } from "./billing";
import { queueWorker } from "./boot";
import { readPreference } from "./preference";
import { createBatch, enqueue, type QueueEntry } from "./queue";
import type { Provider } from "./speakers/speaker";

export type Plan = {
  jobs: QueueEntry[];
  /** Lines (or ids) that matched, before any was dropped. */
  matched: number;
  /** Matched lines that did not become jobs, by reason. */
  dropped: Record<string, number>;
  /** Ids found nowhere. Quests as `id`, or `id#variant` when the variant is above 0. */
  unknown: string[];
};

export function linesForItems(
  lines: readonly CorpusLine[],
  items: readonly { id: string; variant: number }[],
): { lines: CorpusLine[]; unknown: string[] } {
  const wanted = new Map<string, Set<number>>();
  for (const { id, variant } of items) {
    const set = wanted.get(id) ?? new Set<number>();
    set.add(variant);
    wanted.set(id, set);
  }
  const found = new Set<string>();
  const matched = lines.filter((line) => {
    const id = baseLineId(line.lineId);
    const variant = line.variant ?? 0;
    if (!wanted.get(id)?.has(variant)) return false;
    found.add(`${id}\u0000${variant}`);
    return true;
  });
  const unknown = items
    .filter(({ id, variant }) => !found.has(`${id}\u0000${variant}`))
    .map(({ id, variant }) => (variant > 0 ? `${id}#${variant}` : id));
  return { lines: matched, unknown: [...new Set(unknown)] };
}

/** A pinned voice's line is a fish.audio job in whatever batch it falls in. */
async function pinnedFor(lang: Lang, provider: Provider): Promise<Set<string>> {
  return provider === "fish" ? new Set<string>() : pinnedVoices(lang);
}

function questPlan(
  lines: CorpusLine[],
  overrides: Parameters<typeof batchPlan>[1],
  pinned: Set<string>,
  extraDropped: Record<string, number> = {},
  unknown: string[] = [],
  matched = lines.length,
): Plan {
  const { jobs, skipped } = batchPlan(lines, overrides);
  return {
    // BatchLine calls it audioPath and the queue calls it file: a job is one mp3 on either side.
    jobs: jobs.map((job) => ({
      lineId: job.lineId,
      file: job.audioPath,
      npcName: job.npcName,
      preview: job.preview,
      characters: job.characters,
      provider: pinned.has(job.voice) ? "fish" : undefined,
    })),
    matched,
    dropped: { ...skipped, ...extraDropped },
    unknown,
  };
}

export async function planQuestsByFilters(filters: string, lang: Lang, provider: Provider): Promise<Plan> {
  let parsed = await filtersFromParams(new URLSearchParams(filters), lang);
  const [catalogue, { voiced, context }, recordings, broadcast, pinned] = await Promise.all([
    corpus(lang),
    // Behind `regenerate`, which is working in the language, so the model and author
    // filters narrow the batch exactly as they narrowed the page it was quoted from.
    searchContext(needsStale(parsed), false, lang, true, needsLevels(parsed)),
    // The recorded filter, as /api/quests/search/lines narrowed the quote.
    parsed.recorded ? recordingsFor("quests", lang) : undefined,
    parsed.broadcast ? broadcastStatuses() : undefined,
    pinnedFor(lang, provider),
  ]);
  if (!recordings) parsed = { ...parsed, recorded: undefined };
  const lines = matchingLines(catalogue, voiced, parsed, { ...context, recordings, broadcast });
  // The same overrides the estimate was built from, so what is queued is what was quoted.
  return questPlan(lines, context.overrides, pinned);
}

export async function planQuestsByItems(
  items: readonly { id: string; variant: number }[],
  lang: Lang,
  provider: Provider,
): Promise<Plan> {
  const catalogue = await corpus(lang);
  const { lines: narrowed, unknown } = linesForItems(catalogue.lines, items);
  const [filters, { voiced, context }, pinned] = await Promise.all([
    filtersFromParams(new URLSearchParams(), lang),
    searchContext(false, false, lang, true, false),
    pinnedFor(lang, provider),
  ]);
  const lines = matchingLines({ lines: narrowed }, voiced, filters, context);
  const hidden = narrowed.length - lines.length;
  return questPlan(lines, context.overrides, pinned, hidden > 0 ? { hidden } : {}, unknown, narrowed.length);
}

export async function planCatalogue(
  section: "places" | "readables" | "bosses",
  ids: string[],
  lang: Lang,
): Promise<Plan> {
  const wanted = new Set(ids);
  const dropped: Record<string, number> = {};
  const drop = (why: string) => (dropped[why] = (dropped[why] ?? 0) + 1);
  const jobs: QueueEntry[] = [];
  const seen = new Set<string>();

  // The entries are looked up rather than trusted from the body: what is queued is what
  // exists, and an id nobody recognises is dropped rather than becoming a job that can only fail.
  if (section === "places") {
    for (const entry of await zoneCatalogue(lang)) {
      if (!wanted.has(entry.id)) continue;
      seen.add(entry.id);
      if (entry.spoken.trim() === "") {
        drop("no-text");
        continue;
      }
      jobs.push({
        lineId: entry.id,
        file: entry.file,
        // There is no NPC here; the zone's name labels the progress readout.
        npcName: entry.zoneName,
        preview: entry.short || entry.full.slice(0, 120),
        characters: entry.spoken.length,
      });
    }
  } else if (section === "readables") {
    for (const page of await bookCatalogue(lang)) {
      if (!wanted.has(page.id)) continue;
      seen.add(page.id);
      if (!page.generatable) {
        drop("not-generatable");
        continue;
      }
      if (page.spoken.trim() === "") {
        drop("no-text");
        continue;
      }
      jobs.push({
        lineId: page.id,
        file: page.file,
        npcName: page.pageCount > 1 ? `${page.title} (${page.pageNumber}/${page.pageCount})` : page.title,
        preview: page.spoken.slice(0, 120),
        characters: page.spoken.length,
      });
    }
  } else {
    for (const entry of await bossCatalogue(lang)) {
      if (!wanted.has(entry.id)) continue;
      seen.add(entry.id);
      if (entry.text === null || entry.spoken === null || entry.spoken.trim() === "") {
        drop("no-text");
        continue;
      }
      jobs.push({
        lineId: entry.id,
        file: entry.file,
        npcName: entry.name,
        preview: entry.text.slice(0, 120),
        characters: entry.spoken.length,
      });
    }
  }

  return { jobs, matched: seen.size, dropped, unknown: ids.filter((id) => !seen.has(id)) };
}

/**
 * Queue a plan as one batch, on the provider fixed here. A job pinned to fish.audio needs that
 * key too, checked before any row exists.
 */
export async function queuePlan(args: {
  plan: Plan;
  section: Source;
  lang: Lang;
  userId: string;
  provider: Provider;
  label: string;
  tokenId?: string;
}): Promise<{ batchId: string; queued: number; alreadyQueued: number } | Response> {
  const { plan, section, lang, userId, provider, label, tokenId } = args;
  if (plan.jobs.length === 0) {
    return NextResponse.json(
      { error: "nothing to regenerate", kind: "bad-request", unknown: plan.unknown },
      { status: 400 },
    );
  }

  if (provider !== "fish" && plan.jobs.some((job) => job.provider === "fish")) {
    const { denied } = await requireApiKey(userId, "fish");
    if (denied) return denied;
  }

  const batchId = await createBatch(label, userId, section, lang);
  const { queued, skipped } = await enqueue(batchId, plan.jobs, section, lang, provider);
  // One row for the whole batch, however many lines it holds.
  await recordActivity({
    kind: "batch.queued",
    lang,
    source: section,
    subject: batchId,
    actorId: userId,
    detail: { batchId, label, count: queued, ...(tokenId ? { apiTokenId: tokenId } : {}) },
  });
  // The loop is on a two-second idle tick; waiting that out would be the most visible part.
  queueWorker()?.nudge();
  return { batchId, queued, alreadyQueued: skipped };
}

/** The quote for a plan, priced like the Regenerate dialog, one entry per provider it uses. */
export async function estimatePlan(
  plan: Plan,
  userId: string,
  lang: Lang,
  provider: Provider,
): Promise<Partial<Record<Provider, Estimate>>> {
  const byProvider = new Map<Provider, QueueEntry[]>();
  for (const job of plan.jobs) {
    const key = job.provider ?? provider;
    byProvider.set(key, [...(byProvider.get(key) ?? []), job]);
  }
  if (byProvider.size === 0) return {};

  const preference = await readPreference(userId, lang);
  const out: Partial<Record<Provider, Estimate>> = {};
  for (const [key, jobs] of byProvider) {
    const rate =
      key === "fish"
        ? await observedFishRate(preference.fish.model, lang)
        : await observedRate(preference.elevenlabs.modelId);
    out[key] = estimate(jobs, rate);
  }
  return out;
}
