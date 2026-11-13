/**
 * Queue regeneration through a token: the same derivation and limits as the site's Regenerate
 * button (lib/generation/batch-plan.ts), on the token owner's own key.
 */
import { bodyOf, objectOf } from "@/lib/api-body";
import { readApiKey } from "@/lib/api-key";
import { requireSpeaker } from "@/lib/generation/authz";
import {
  estimatePlan,
  filterError,
  planCatalogue,
  planQuestsByFilters,
  planQuestsByItems,
  queuePlan,
  type Plan,
} from "@/lib/generation/batch-plan";
import { ensureQueueRunning } from "@/lib/generation/boot";
import { readPreference } from "@/lib/generation/preference";
import type { Provider } from "@/lib/generation/speakers/speaker";
import type { LineFilters } from "@/lib/search";
import { MAX_ITEMS } from "@/lib/text-api/apply";
import { requireToken } from "@/lib/text-api/guard";
import { invalid, noQuery, sectionOf } from "@/lib/text-api/respond";
import { BAD_VARIANT, isVariant } from "@/lib/text-api/types";

export const dynamic = "force-dynamic";

const MAX_LABEL = 100;
const KEYS = new Set(["items", "filters", "label", "dryRun"]);

export async function POST(request: Request, { params }: { params: Promise<{ section: string }> }) {
  const { context, denied } = await requireToken(request, { need: "generate" });
  if (denied) return denied;

  // The language comes from the token, and nothing else here is read from the URL.
  const refused = noQuery(request, "this takes a JSON body and no query string");
  if (refused) return refused;

  const found = sectionOf((await params).section);
  if (found instanceof Response) return found;
  const { section } = found;

  const body = objectOf(await bodyOf(request));
  if (!body) return invalid("send a JSON object");
  for (const key of Object.keys(body)) {
    if (!KEYS.has(key)) return invalid(`unknown key ${key}: this takes items, filters, label and dryRun`);
  }
  const hasItems = body.items !== undefined;
  const hasFilters = body.filters !== undefined;
  if (hasItems === hasFilters) return invalid("send either items or filters, not both and not neither");
  if (hasFilters && (section !== "quests" || typeof body.filters !== "string")) {
    return invalid("filters is an Explorer query string, and only quests take it");
  }
  let parsed: LineFilters | undefined;
  if (hasFilters) {
    const checked = await filterError(body.filters as string, context.lang);
    if (checked.error !== null) return invalid(checked.error);
    parsed = checked.filters;
  }
  if (body.dryRun !== undefined && typeof body.dryRun !== "boolean") return invalid("dryRun must be true or false");
  if (
    body.label !== undefined &&
    (typeof body.label !== "string" || body.label.length < 1 || body.label.length > MAX_LABEL)
  ) {
    return invalid(`label must be 1 to ${MAX_LABEL} characters`);
  }
  const label = (body.label as string | undefined) ?? "API request";

  const items: { id: string; variant: number }[] = [];
  if (hasItems) {
    if (!Array.isArray(body.items)) return invalid("items must be an array");
    if (body.items.length === 0) return invalid("items is empty");
    if (body.items.length > MAX_ITEMS) return invalid(`at most ${MAX_ITEMS} items per request`);
    for (const raw of body.items as Record<string, unknown>[]) {
      if (!raw || typeof raw !== "object" || typeof raw.id !== "string" || raw.id === "") {
        return invalid("every item needs a string id");
      }
      const extra = Object.keys(raw).find((key) => key !== "id" && key !== "variant");
      if (extra) return invalid(`unknown item key ${extra}: an item takes id and variant`);
      if (raw.variant !== undefined && (section !== "quests" || !isVariant(raw.variant))) {
        return invalid(section === "quests" ? BAD_VARIANT : "only quests take a variant");
      }
      items.push({ id: raw.id, variant: (raw.variant as number | undefined) ?? 0 });
    }
  }

  ensureQueueRunning();
  const { lang, userId, tokenId } = context;

  const derive = (provider: Provider): Promise<Plan> => {
    if (section !== "quests") return planCatalogue(section, items.map((item) => item.id), lang);
    return hasFilters
      ? planQuestsByFilters(body.filters as string, lang, provider, parsed)
      : planQuestsByItems(items, lang, provider);
  };

  if (body.dryRun === true) {
    const preference = await readPreference(userId, lang);
    const provider = preference.provider;
    const plan = await derive(provider);
    const estimate = await estimatePlan(plan, preference, lang, provider);
    const missingKeys: Provider[] = [];
    for (const key of Object.keys(estimate) as Provider[]) {
      const stored = await readApiKey(userId, key).catch(() => null);
      if (!stored) missingKeys.push(key);
    }
    return Response.json({
      dryRun: true,
      provider,
      files: new Set(plan.jobs.map((job) => job.file)).size,
      characters: plan.jobs.reduce((sum, job) => sum + job.characters, 0),
      matched: plan.matched,
      dropped: plan.dropped,
      unknown: plan.unknown,
      estimate,
      missingKeys,
    });
  }

  // The provider is fixed here, as the button fixes it, and the owner's own key is required.
  const { provider, denied: noKey } = await requireSpeaker(userId, lang);
  if (noKey) return noKey;

  const plan = await derive(provider);
  const result = await queuePlan({ plan, section, lang, userId, provider, label, tokenId });
  if (result instanceof Response) return result;
  return Response.json({ ...result, matched: plan.matched, dropped: plan.dropped, unknown: plan.unknown });
}
