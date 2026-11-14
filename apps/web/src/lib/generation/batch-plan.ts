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
import { batchPlan, matchingLines, type LineFilters } from "@/lib/search";
import { AUDIO_STATES } from "@/lib/audio-state";
import { CLIENT_FILTERS } from "@/lib/contributions/client";
import { SOURCES as LINE_SOURCES } from "@/lib/line-fields";
import { filtersFromParams, needsLevels, needsStale } from "@/lib/search-request";
import type { Source } from "@/lib/sections";
import { pinnedVoices } from "@/lib/voices/references";

import { requireApiKey } from "./authz";
import { observedFishRate, observedRate } from "./calibration";
import { estimate, type Estimate } from "./billing";
import { queueWorker } from "./boot";
import type { Preference } from "./preference";
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

function questPlan(lines: CorpusLine[], overrides: Parameters<typeof batchPlan>[1], pinned: Set<string>): Plan {
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
    matched: lines.length,
    dropped: skipped,
    unknown: [],
  };
}

/** Every key `filtersFromParams` reads. */
const FILTER_KEYS = new Set([
  "q", "filter", "state", "missing", "outdated", "race", "gender", "flavor", "voice", "source", "type",
  "narration", "progress", "client", "line", "overridden", "ignored", "dirty", "fb", "before", "after",
  "model", "author", "rec", "bt", "minLevel", "maxLevel", "playerGender",
]);
/** Keys an Explorer URL carries that mean nothing to a batch. */
const EXPLORER_ONLY = new Set(["page"]);
const FLAGS = ["narration", "progress", "overridden", "ignored", "dirty", "missing", "outdated"];
const DAY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * For the API only: the button's derivation drops what it does not understand, which for a typed
 * query would quietly widen the batch to the whole language. Here a key nobody reads, or a value
 * that matches nothing, is named instead. A null error comes with the parsed filters, for
 * planQuestsByFilters to reuse.
 */
export async function filterError(
  query: string,
  lang: Lang,
): Promise<{ error: string } | { error: null; filters: LineFilters }> {
  const params = new URLSearchParams(query.startsWith("?") ? query.slice(1) : query);
  for (const key of params.keys()) {
    if (EXPLORER_ONLY.has(key)) continue;
    if (!FILTER_KEYS.has(key)) {
      return {
        error: `unknown filter ${key}: filters is an Explorer query string, and ${
          key === "lang" ? "the language comes from the token" : "this one is not read"
        }`,
      };
    }
  }
  // Every element of the one list filter: parsing drops the unknown ones and keeps the rest.
  const badSource = (params.get("source") ?? "")
    .split(",")
    .find((value) => value !== "" && !(LINE_SOURCES as readonly string[]).includes(value));
  if (badSource !== undefined) return { error: `source=${badSource} is not a valid value` };
  const parsed = await filtersFromParams(params, lang);
  const parsedTo: Record<string, unknown> = {
    filter: parsed.filter === "any" && params.get("filter") !== "any" ? undefined : parsed.filter,
    // `state` itself, which parsing would let the legacy missing and outdated flags stand in for.
    state: (AUDIO_STATES as readonly string[]).includes(params.get("state") ?? "") ? true : undefined,
    race: parsed.race,
    gender: parsed.gender,
    flavor: parsed.flavor,
    voice: parsed.voice,
    source: parsed.source,
    type: parsed.npcType,
    client: (CLIENT_FILTERS as readonly string[]).includes(params.get("client") ?? "") ? parsed.client : undefined,
    fb: parsed.reports,
    rec: parsed.recorded,
    bt: parsed.broadcast,
    minLevel: parsed.minLevel,
    maxLevel: parsed.maxLevel,
    playerGender: parsed.playerGender,
    before: params.get("before") && DAY.test(params.get("before")!) ? true : undefined,
    after: params.get("after") && DAY.test(params.get("after")!) ? true : undefined,
  };
  for (const [key, value] of Object.entries(parsedTo)) {
    const given = params.get(key);
    if (given !== null && given !== "" && value === undefined) return { error: `${key}=${given} is not a valid value` };
  }
  for (const key of FLAGS) {
    const given = params.get(key);
    if (given !== null && given !== "1" && given !== "0") return { error: `${key}=${given} is not a valid value: use 1` };
  }
  return { error: null, filters: parsed };
}

/** `parsed` is `filters` already parsed, by filterError. */
export async function planQuestsByFilters(
  filters: string,
  lang: Lang,
  provider: Provider,
  parsed?: LineFilters,
): Promise<Plan> {
  parsed ??= await filtersFromParams(new URLSearchParams(filters), lang);
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
  const [catalogue, defaults, pinned, { voiced, context }] = await Promise.all([
    corpus(lang),
    filtersFromParams(new URLSearchParams(), lang),
    pinnedFor(lang, provider),
    // A bare query string sets neither a state nor a level, so the default view needs neither
    // staleness nor levels, and the context need not wait for the defaults.
    searchContext(false, false, lang, true, false),
  ]);
  const { lines: narrowed, unknown } = linesForItems(catalogue.lines, items);
  // The default view, but for every client and with progress lines in: an item is one the caller
  // named, so only a line nobody voices (an ignore) is hidden, and batchPlan says why the rest drops.
  const filters = { ...defaults, client: "all" as const, includeProgress: true };
  const lines = matchingLines({ lines: narrowed }, voiced, filters, context);
  const hidden = narrowed.length - lines.length;
  const plan = questPlan(lines, context.overrides, pinned);
  return {
    ...plan,
    matched: narrowed.length,
    dropped: { ...plan.dropped, ...(hidden > 0 ? { hidden } : {}) },
    unknown,
  };
}

type Planned = { job: QueueEntry } | { drop: string };

/**
 * The entries are looked up rather than trusted from the body: what is queued is what exists, and
 * an id nobody recognises is dropped rather than becoming a job that can only fail.
 */
function planEntries<T extends { id: string }>(entries: readonly T[], ids: string[], plan: (entry: T) => Planned): Plan {
  const wanted = new Set(ids);
  const dropped: Record<string, number> = {};
  const jobs: QueueEntry[] = [];
  const seen = new Set<string>();
  for (const entry of entries) {
    if (!wanted.has(entry.id)) continue;
    seen.add(entry.id);
    const planned = plan(entry);
    if ("drop" in planned) dropped[planned.drop] = (dropped[planned.drop] ?? 0) + 1;
    else jobs.push(planned.job);
  }
  return { jobs, matched: seen.size, dropped, unknown: [...new Set(ids.filter((id) => !seen.has(id)))] };
}

export async function planCatalogue(
  section: "places" | "readables" | "bosses",
  ids: string[],
  lang: Lang,
): Promise<Plan> {
  switch (section) {
    case "places":
      return planEntries(await zoneCatalogue(lang), ids, (entry) =>
        entry.spoken.trim() === ""
          ? { drop: "no-text" }
          : {
              job: {
                lineId: entry.id,
                file: entry.file,
                // There is no NPC here; the zone's name labels the progress readout.
                npcName: entry.zoneName,
                preview: entry.short || entry.full.slice(0, 120),
                characters: entry.spoken.length,
              },
            },
      );
    case "readables":
      return planEntries(await bookCatalogue(lang), ids, (page) => {
        if (!page.generatable) return { drop: "not-generatable" };
        if (page.spoken.trim() === "") return { drop: "no-text" };
        return {
          job: {
            lineId: page.id,
            file: page.file,
            npcName: page.pageCount > 1 ? `${page.title} (${page.pageNumber}/${page.pageCount})` : page.title,
            preview: page.spoken.slice(0, 120),
            characters: page.spoken.length,
          },
        };
      });
    default:
      return planEntries(await bossCatalogue(lang), ids, (entry) => {
        if (entry.text === null || entry.spoken === null || entry.spoken.trim() === "") return { drop: "no-text" };
        return {
          job: {
            lineId: entry.id,
            file: entry.file,
            npcName: entry.name,
            preview: entry.text.slice(0, 120),
            characters: entry.spoken.length,
          },
        };
      });
  }
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
  preference: Preference,
  lang: Lang,
  provider: Provider,
): Promise<Partial<Record<Provider, Estimate>>> {
  const byProvider = new Map<Provider, QueueEntry[]>();
  for (const job of plan.jobs) {
    const key = job.provider ?? provider;
    const group = byProvider.get(key);
    if (group) group.push(job);
    else byProvider.set(key, [job]);
  }
  if (byProvider.size === 0) return {};

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
