/**
 * The API describing itself, so a maintainer can hand an agent one URL and a token.
 */
import { MAX_ITEMS, MAX_NAME, MAX_TEXT } from "@/lib/text-api/apply";
import { requireToken } from "@/lib/text-api/guard";
import { sections } from "@/lib/text-api/index";
import { PAGE_SIZE } from "@/lib/text-api/respond";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const { context, denied } = await requireToken(request, { need: "any" });
  if (denied) return denied;

  return Response.json({
    token: { lang: context.lang, access: context.access, generate: context.generate },
    sections: Object.fromEntries(
      Object.entries(sections).map(([name, api]) => [name, { filters: Object.keys(api.filters) }]),
    ),
    limits: {
      pageSize: PAGE_SIZE,
      itemsPerUpdate: MAX_ITEMS,
      textLength: MAX_TEXT,
      nameLength: MAX_NAME,
      itemsPerGeneration: MAX_ITEMS,
      // nginx enforces this one (nginx-spoken-api.conf), so it cannot be imported.
      requestBytes: 8 * 1024 * 1024,
    },
    endpoints: {
      "GET /api/v1/{section}": "List items, optionally by a filter. Follow nextCursor with ?cursor=.",
      "GET /api/v1/{section}/{id}": "One item. Quest lines take ?variant=, default 0.",
      "PATCH /api/v1/{section}/{id}": "Change one item: {text?, name?, short?, note?, expectedVersion?, expectedNameVersion?}. Quest lines take ?variant=, not a body field.",
      "PATCH /api/v1/{section}": "Change many: {items: [{id, variant?, text?, name?, short?, ...}], note?}. Returns batchId and one result per item, in order.",
      "GET /api/v1/{section}/reference": "The English text of a section, to translate from. Same filters and cursor as the list; no versions. Any valid token.",
      "POST /api/v1/{section}/generate": "Queue audio on the token owner's own key: {items: [{id, variant?}]} or, for quests, {filters: \"<Explorer query string>\"}; optional label and dryRun. A dry run prices it and queues nothing. Needs a generate token.",
      "GET /api/v1/batches": "This owner's recent mass updates in this language.",
      "POST /api/v1/batches/{batchId}/restore": "Undo a mass update, except lines edited since and gender splits.",
      "GET /api/v1/lexicon": "The language's pronunciation lexicon: entries, version, sync.",
      "GET /api/v1/lexicon/{grapheme}": "One entry, matched ignoring case.",
      "PATCH /api/v1/lexicon/{grapheme}": "Replace or add one entry: {ipa | alias, confidence, note?, expectedVersion?}. Needs configure.",
      "PATCH /api/v1/lexicon": "Replace or add many: {items: [{grapheme, ipa | alias, confidence, note?}], expectedVersion?}. All or nothing. Needs configure.",
    },
    notes: [
      "The language always comes from the token.",
      "Writes go live at once. Edited lines read as stale until someone regenerates them. Text routes make no audio: only generate does, on the token owner's key, and a line that is already done and asked for again is paid for again.",
      "A null text is an item with no translation yet. englishText is what to translate from.",
      "A quest line's override, when not null, is what gets spoken instead of its text. Writing text does not change it, and this API cannot write it.",
      "Text containing $G splits a quest line into :m and :f. Plain text to either side of an untranslated split is refused: send one text with a $G branch.",
      "A readable page's name is its owner's, shared by every page and item with that owner. A quest's name is shared by all its lines. Gossip lines and pages with no owner have no name to write.",
      "Places: sending text without short regenerates short.",
      "expectedVersion and expectedNameVersion guard an existing version only. A line with no text has nothing to compare, so they do not protect a first translation someone saved since you read it.",
      "A request over limits.requestBytes gets a 413 from the proxy, with no results: split it.",
      "Lexicon writes replace an entry whole, so a note left out is dropped. They upload to ElevenLabs with the token owner's key; without one the save lands and sync reads pending, or never if the language was never uploaded. Each write uploads the whole dictionary, so send several fixes in one PATCH /api/v1/lexicon.",
    ],
    docs: "https://github.com/rusty-key/spoken-wow/blob/master/docs/contributors/TEXT-API.md",
  });
}
