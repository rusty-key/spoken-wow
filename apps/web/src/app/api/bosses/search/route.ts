/**
 * The bosses explorer's only read: /api/places/search over the boss catalogue.
 *
 * Every live boss is listed in every language. One with no story in the language comes back
 * with null text and `written: false`, never another language's story.
 */
import type { Lang } from "@/lib/lang";
import { langParam, worksHere } from "@/lib/lang-server";
import { recordingsFor } from "@/lib/recordings/store";
import { baseCatalogue, catalogue, loadContext, publicContext } from "@/lib/bosses/catalogue";
import { PAGE_SIZE } from "@/lib/page-size";
import { filtersFromParams, type LineFilters } from "@/lib/bosses/filters";
import { search } from "@/lib/bosses/search";
import type { TeamId } from "@/lib/teams/store";
import { asHeard, asPublished, teamLiveOverrides, viewedOther, viewOnly } from "@/lib/teams/viewing";

export const dynamic = "force-dynamic";

/**
 * 503, not an empty page, while the boss tables are unseeded: a deployment state rather than
 * a defect, and one a monitor should tell apart from "no bosses match".
 */
function corpusEmpty(): Response {
  return Response.json(
    {
      error:
        "the boss tables hold no bosses -- seed them with: make bosses-extract " +
        "(and check DATABASE_URL points at the database you mean)",
      code: "corpus_empty",
    },
    { status: 503 },
  );
}

/** The bosses and context as the acting team works on them. */
async function own(lang: Lang, filters: LineFilters) {
  // Who made each take is for the people working in the language; see /api/places/search.
  const seesMadeBy = await worksHere(lang);
  if (!seesMadeBy) {
    filters.model = undefined;
    filters.author = undefined;
  }
  const [entries, context, recordings] = await Promise.all([
    catalogue(lang),
    loadContext(lang, seesMadeBy),
    recordingsFor("bosses", lang),
  ]);
  if (!recordings) filters.recorded = undefined;
  return {
    entries: seesMadeBy ? entries : await asPublished(entries, () => baseCatalogue(lang), "bosses", lang),
    context: { ...context, recordings },
    filters,
  };
}

/** The bosses as another team is heard: the original stories, its live takes and the overrides they speak. */
async function heard(lang: Lang, team: TeamId, filters: LineFilters) {
  const [base, context, overrides] = await Promise.all([
    baseCatalogue(lang),
    publicContext("bosses", lang, team),
    teamLiveOverrides(team, "bosses", lang),
  ]);
  return { ...asHeard(base, context, overrides), filters: viewOnly(filters) };
}

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const { lang, denied } = await langParam(request);
  if (denied) return denied;
  const page = Math.max(1, Number(params.get("page")) || 1);
  // Whose takes play: the acting team's unless `team` names another of the language.
  const other = await viewedOther(params, lang);
  if (other instanceof Response) return other;

  const { entries, context: withRecordings, filters } = await (other
    ? heard(lang, other, filtersFromParams(params))
    : own(lang, filtersFromParams(params)));
  if (entries.length === 0) return corpusEmpty();

  // Every matching id, for "regenerate everything this filter matches". Only written bosses:
  // the queue refuses one with no story, so a quote that counted it would promise a take
  // nobody gets.
  if (params.get("ids") === "1") {
    const written = search(entries, withRecordings, filters, 0, Number.MAX_SAFE_INTEGER).lines.filter(
      (line) => line.written,
    );
    return Response.json({
      ids: written.map((line) => line.id),
      dirtyFiles: written.filter((line) => line.dirty).map((line) => line.file),
      total: written.length,
      totalChars: written.reduce((sum, line) => sum + line.chars, 0),
    });
  }

  return Response.json(search(entries, withRecordings, filters, (page - 1) * PAGE_SIZE, PAGE_SIZE));
}
