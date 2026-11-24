import { pageLang } from "@/lib/lang-server";
import { viewerOf } from "@/lib/grants/store";
import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";

import ContributionTable, { type ContributionRow } from "@/components/ContributionTable";
import ContributionsTabs from "@/components/ContributionsTabs";
import CorrectionTable from "@/components/CorrectionTable";
import BackstagePage from "@/components/backstage/BackstagePage";
import Panel from "@/components/backstage/Panel";
import { correctionRowsFor } from "@/lib/contributions/correction-rows";
import { checkLine, type LineCheck, type Verdict } from "@/lib/contributions/checks";
import { englishFor } from "@/lib/contributions/english";
import { WAITING_KINDS, waitingReason, type WaitingKind, type WaitingReason } from "@/lib/contributions/query";
import { auth } from "@/lib/auth";
import { baseCatalogue, bookFacets } from "@/lib/readables/catalogue";
import { pageKeyOf } from "@/lib/readables/tools";
import {
  bookCandidates,
  bulkAcceptable,
  loadBookCorpus,
  matchBook,
  titleIn,
  type BookCandidate,
  type BookCorpusPage,
  type BookMatchResult,
} from "@/lib/contributions/book-match";
import { buildFilterOf, buildOptions, clientFilterOf, clientOf, matchesBuild, matchesClient } from "@/lib/contributions/client";
import { corpusLookup } from "@/lib/contributions/existing";
import { tabOf } from "@/lib/contributions/known";
import { isStatus, type ContributionStatus } from "@/lib/contributions/contributions";
import { linesInExplorer, momentHasSpeaker } from "@/lib/contributions/accept";
import {
  isSearchIn,
  bucketOf,
  isBucket,
  isSection,
  namesSpeaker,
  matchesSearch,
  matchesStage,
  pageOf,
  queryOf,
  stagesOf,
  PAGE_SIZE,
  sortOf,
  type ClientFilter,
  type ContributionSort,
  type Bucket,
  type StageFilter,
  isShow,
  type Show,
} from "@/lib/contributions/query";
import { listedWithPending } from "@/lib/contributions/pending";
import { observationMeta, type Contribution } from "@/lib/contributions/store";
import {
  bookFor,
  npcSummaryFrom,
  packHeard,
  questFor,
  resolveMissing,
  idOnlyResolution,
  type NpcSummary,
} from "@/lib/contributions/triage";
import { observedFrom, resolveNpc } from "@/lib/npc/resolve";
import { getResolutions, getResolutionsById, resolutionKey, type NpcRowKind } from "@/lib/npc/store";
import { BASE_LANG, isClientLang, isLang, langName, localeHref, type Lang } from "@/lib/lang";
import type { Roster } from "@/lib/voices/roster";
import { loadRoster } from "@/lib/voices/roster-store";
import { can, isAdmin } from "@/lib/permissions";
import { linesByPath } from "@/lib/places/catalogue";
import { countObservedNames, hasObservedNames } from "@/lib/names/observed";

export const metadata: Metadata = { title: "Contributions · Spoken" };

// A triage queue read against a database that other people are also resolving rows in.
export const dynamic = "force-dynamic";

/**
 * The corpus text a contribution already resolves to, or undefined where it does not.
 *
 * A places row is looked up by its key; a readables row by the page the matcher found, in the
 * row's language only. A quests row is left out of the map entirely rather than looked up and always
 * missing, so the table can tell "not checked" apart from "checked and the corpus has nothing".
 */
async function existingTextFor(
  contributions: Contribution[],
  bookMatches: Map<number, BookMatchResult>,
): Promise<Record<number, string>> {
  const found: Record<number, string> = {};
  // One catalogue read for every places row, not one per row.
  const places = contributions.some((row) => row.source === "places") ? await linesByPath() : null;

  await Promise.all(
    contributions.map(async (row) => {
      if (row.source === "readables") {
        const match = bookMatches.get(row.id);
        const lineId = match && "lineId" in match ? match.lineId : null;
        const page = lineId
          ? (await baseCatalogue(isLang(row.locale) ? row.locale : BASE_LANG)).find((p) => p.id === lineId)
          : undefined;
        if (page && !page.missing?.text && page.text) found[row.id] = page.text;
        return;
      }
      const lookup = corpusLookup(row.source, row.key);
      if (lookup?.source === "places" && places && Number.isInteger(lookup.mapID)) {
        const line = places.get(`${lookup.mapID}/${lookup.slug}`);
        if (line) found[row.id] = line.full;
      }
    }),
  );

  return found;
}

/** What each readables row is by its words, owner or title, and a way to name a page or book in the row's language. */
async function bookMatchesFor(contributions: Contribution[]) {
  const readables = contributions.filter((row) => row.source === "readables");
  if (readables.length === 0) {
    return {
      matches: new Map<number, BookMatchResult>(),
      describe: (_lang: string) => (id: string) => id,
      candidatesOf: (_row: Contribution, _match: BookMatchResult): BookCandidate[] => [],
      englishOf: (_match: BookMatchResult | undefined): string | null => null,
    };
  }
  const corpus = await loadBookCorpus();
  const matches = new Map(readables.map((row) => [row.id, matchBook(row, corpus)]));
  const byLine = new Map(corpus.pages.map((p) => [p.lineId, p]));
  const firstOf = new Map<string, BookCorpusPage>();
  for (const p of corpus.pages) {
    const first = firstOf.get(p.bookId);
    if (!first || p.pageNumber < first.pageNumber) firstOf.set(p.bookId, p);
  }
  const describe = (lang: string) => (id: string) => {
    if (id.startsWith("book:")) return titleIn(firstOf.get(id.slice(5)), lang);
    const page = byLine.get(id);
    return page ? `${titleIn(page, lang)} p.${page.pageNumber}` : id;
  };
  // The English page a row was matched to, for the review page's side-by-side and checks.
  const englishOf = (match: BookMatchResult | undefined): string | null => {
    const lineId = match && "lineId" in match ? match.lineId : null;
    return (lineId && byLine.get(lineId)?.texts.get(BASE_LANG)) || null;
  };
  return { matches, describe, candidatesOf: (row: Contribution, match: BookMatchResult) => bookCandidates(match, corpus, row), englishOf };
}

/**
 * Who the corpus, the client or a moderator believes each row's NPC to be.
 *
 * Keyed on the contribution id, not the (kind, id) pair, because that is what the table already
 * indexes rows by; the underlying resolution is still shared across every contribution that
 * names the same NPC, which is the whole point of resolveNpc writing through to it.
 *
 * A row present with `npc` set but every field null is meaningful, not absent: it says a
 * moderator or the resolver looked and found no race to assign (a narrator, say). Absent
 * entirely means the envelope never named an NPC at all -- places and readables never do, and a
 * quests envelope keyed on quest+event rather than npc doesn't either.
 *
 * `roster` must be the language of every row: a row of another team's would be offered this
 * team's flavors.
 */
async function npcFor(contributions: Contribution[], roster: Roster): Promise<Record<number, NpcSummary>> {
  const found: Record<number, NpcSummary> = {};

  // build and a moderator-chosen kind are columns of their own on a stored contribution, not
  // part of `meta` -- observationMeta puts both back, the same way accept and the export do.
  const observed = contributions.map((row) => ({
    row,
    observed: observedFrom(observationMeta(row)),
  }));

  // One query for every row's NPC, not one per row -- getResolutions is exactly what the
  // export already uses to do this, and a per-row getResolution here used to mean the whole
  // moderator queue issued one round trip per contribution (and, worse, that any single
  // poisoned npcId -- see resolve.ts's digits() -- would throw inside this Promise.all and
  // 500 the entire page).
  const keys: { npcKind: NpcRowKind; npcId: number }[] = [];
  for (const { observed: o } of observed) {
    if (o.npcKind !== null && o.npcId !== null) keys.push({ npcKind: o.npcKind, npcId: o.npcId });
  }
  const resolutions = await getResolutions(keys);

  // A kind-less envelope (no `kind`, only ever true of the addon's oldest submissions -- see
  // observedFrom) still names an id, and that id may resolve unambiguously even without a kind:
  // getResolutionsById below is one query for every such id, not one per row, matching the
  // discipline getResolutions already keeps for keyed rows.
  const idOnlyIds = [...new Set(
    observed
      .filter(({ observed: o }) => o.npcKind === null && o.npcId !== null)
      .map(({ observed: o }) => o.npcId as number),
  )];
  const idOnly = await getResolutionsById(idOnlyIds);

  // An NPC the batch read found nothing for is still resolvable, not merely displayable: an
  // envelope this old predates resolveNpc being called at intake at all (the three real rows
  // this table was designed against are exactly this -- filed before the addon reported `kind`
  // or `model`). Resolving them now, once, is what lets a corpus hit surface instead of a blank
  // "none" forever, and it persists a row a moderator's override can then rank against. Kept off
  // the path entirely for a key already in `resolutions` -- resolveNpc would just re-read that
  // same row back, and a row already answered (not least a moderator's own) must never be
  // touched here. Deduplicated by key first: two of the three real rows name the same NPC, and
  // without this, resolving them in the same Promise.all would race two upserts for one row.
  const toResolve = new Map<string, { observed: (typeof observed)[number]["observed"]; lang: Lang | null }>();
  for (const { row, observed: o } of observed) {
    if (o.npcKind === null || o.npcId === null) continue;
    const key = resolutionKey(o.npcKind, o.npcId);
    if (!resolutions.has(key) && !toResolve.has(key)) toResolve.set(key, { observed: o, lang: isLang(row.locale) ? row.locale : null });
  }
  // resolveMissing tolerates a single resolveNpc call throwing (a DB blip, pool exhaustion)
  // rather than letting it reject this whole render -- one unresolved row must never 500 the
  // entire queue for every collaborator, the same principle the intake route already follows
  // for the same call.
  const newlyResolved = await resolveMissing(toResolve, (entry) => resolveNpc(entry.observed, entry.lang));
  for (const [key, resolution] of newlyResolved) {
    resolutions.set(key, resolution);
  }

  for (const { row, observed: o } of observed) {
    // No npc named at all -- places, readables, or a quest keyed on quest+event -- is the one case
    // with nothing to show; a kind-less envelope (o.npcKind === null) still has an id and a
    // name and gets a summary too, npcSummaryFrom's own reason for allowing a null npcKind.
    if (o.npcId === null) continue;

    // A kind-less observation can never be a key into `resolutions` (getResolutions and the
    // resolve loop above both require a kind), but it may still land on exactly one row of
    // `idOnly` -- idOnlyResolution uses the answer the rows agree on, or reports a conflict for
    // the moderator to settle rather than guessing between two kinds.
    const lookup =
      o.npcKind !== null
        ? { resolution: resolutions.get(resolutionKey(o.npcKind, o.npcId)), conflict: [] }
        : idOnlyResolution(idOnly.get(o.npcId));
    found[row.id] = npcSummaryFrom(
      roster,
      { npcKind: o.npcKind, npcId: o.npcId, npcName: o.npcName },
      lookup.resolution,
      lookup.conflict,
    );
  }

  return found;
}

/** Where a places or readables row was read, in the client's own words. */
function placeOf(row: Contribution): string | null {
  if (row.source === "places") return [row.meta.zone, row.meta.subzone].filter(Boolean).join(" · ") || null;
  if (row.source === "readables") return row.meta.book ? `${row.meta.book}${row.meta.number ? ` p.${row.meta.number}` : ""}` : null;
  return null;
}

export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ lang: string; source: string }>;
  searchParams: Promise<{
    status?: string;
    bucket?: string;
    client?: string;
    build?: string;
    stage?: string;
    sort?: string;
    dir?: string;
    page?: string;
    q?: string;
    filter?: string;
    show?: string;
  }>;
}) {
  const lang = await pageLang(params);
  const { source } = await params;
  // Gossip was a section of its own; an old link opens quests narrowed to it.
  if (source === "gossip") {
    const query = queryOf(await searchParams);
    query.set("stage", "gossip");
    redirect(localeHref(lang, `/contributions/quests?${query}`));
  }
  if (!isSection(source)) notFound();
  const session = await auth.api.getSession({ headers: await headers() });

  // 404, matching /reports: a member has no business learning the page exists, and these
  // rows hold text and identifying details a stranger pasted in. Per language, because
  // accepting a contribution writes that language's text.
  const viewer = await viewerOf(session);
  if (!session || !can(viewer, "text", lang)) notFound();

  // Every envelope is in the language of the client that wrote it, and no client runs in this
  // one: the queue is empty by construction, not because nobody has sent anything yet.
  if (!isClientLang(lang)) {
    return (
      <BackstagePage
        title="Review"
        description={
          <>
            Lines come from players&apos; game clients, and no client runs in {langName(lang)}. Its text is
            written on each line&apos;s own page.
          </>
        }
      >
        <ContributionsTabs lang={lang} section={source} showNames={hasObservedNames(lang)} />
      </BackstagePage>
    );
  }

  const {
    status: rawStatus,
    bucket: rawBucket,
    client: rawClient,
    build: rawBuild,
    stage: rawStage,
    sort: rawSort,
    dir: rawDir,
    page: rawPage,
    q: rawQ,
    filter: rawFilter,
    show: rawShow,
  } = await searchParams;
  const status: ContributionStatus = isStatus(rawStatus) ? rawStatus : "new";
  // New lines, corrections, or both: only quests and readables have corrections to tell apart.
  const show: Show = (source === "quests" || source === "readables") && isShow(rawShow) ? rawShow : "all";
  // Only quests' New tab is split: readables and places name no speaker, an accepted row was ready
  // by definition, and a rejected one's speaker no longer matters.
  // Corrections never wait on an admin, so showing only them shows the ready half.
  const bucket: Bucket = namesSpeaker(source) && show !== "corrections" && isBucket(rawBucket) ? rawBucket : "ready";

  // Which game the text came from, read off `build` (lib/contributions/client.ts). Defaults to
  // Era and Forever: every other client is the low-effort bin, shown only on request.
  const client: ClientFilter = clientFilterOf(rawClient);

  // Which quest panel the text was read off -- accept, progress or complete -- or gossip.
  const stage: StageFilter = source === "quests" ? stagesOf(rawStage) : [];

  // Readables and places name no NPC or quest, so their search is always over the text.
  const q = typeof rawQ === "string" ? rawQ.trim() : "";
  const searchIn = namesSpeaker(source) && isSearchIn(rawFilter) ? rawFilter : "any";

  // Whichever column header was last clicked; most sent first until one is.
  const sort: ContributionSort = sortOf(rawSort, rawDir);

  // Lines the corpus already has are not this queue's: a different text is a correction, on
  // its own group, and the same text is nothing to triage at all (known.ts's tabOf).
  const [{ listed, states, pending }, roster, names] = await Promise.all([
    listedWithPending(status, lang, sort, source),
    loadRoster(lang),
    hasObservedNames(lang) ? countObservedNames(lang) : undefined,
  ]);
  const contributions = listed.filter((row, index) => tabOf(row.status, states[index]) === "contributions");
  // Every row's NPC, not just this page's: the buckets read it, and it is one query for the lot.
  const npcs = await npcFor(contributions, roster);

  const build = buildFilterOf(rawBuild);
  // Lines the corpus has, sent back with other words: a group of their own on the same page.
  const anyBuildCorrections =
    source === "quests" || source === "readables" ? await correctionRowsFor({ listed, states, source, client, stage, q, searchIn }) : [];
  const corrections = anyBuildCorrections.filter((row) => matchesBuild(row.client, build));
  const anyBuild = contributions
    .filter((row) => matchesClient(clientOf(row.build).family, client))
    .filter((row) => matchesStage(questFor(row), stage))
    .filter((row) => matchesSearch({ text: row.text, npc: npcs[row.id], quest: questFor(row) }, q, searchIn));
  // Read before the build narrows the rows, or picking one would empty the dropdown of the others.
  // From whatever the switch shows, so a build only corrections came from can still be picked.
  const builds = buildOptions([
    ...(show === "corrections" ? [] : anyBuild.map((row) => clientOf(row.build))),
    ...(show === "lines" ? [] : anyBuildCorrections.map((row) => row.client)),
  ]);
  const filtered = anyBuild.filter((row) => matchesBuild(clientOf(row.build), build));

  // Counted after the other filters, so each tab's count matches what it shows.
  const hasSpeaker = await momentHasSpeaker(filtered);
  const bucketCounts: Record<Bucket, number> = { ready: 0, blocked: 0 };
  const matching = filtered.filter((row) => {
    const own = bucketOf({ ...row, quest: questFor(row), hasSpeaker: hasSpeaker.has(row.id) }, npcs[row.id] ?? null, roster);
    bucketCounts[own]++;
    return status !== "new" || own === bucket;
  });

  // Every matching row's, not just this page's: "Keep all" leaves out the ones the matcher can't place.
  const { matches: bookMatches, describe, candidatesOf, englishOf: bookEnglish } = await bookMatchesFor(matching);

  /** The English line each row translates, and what the review checks find against it. */
  async function checksFor(rows: Contribution[], places?: Record<number, string>): Promise<Map<number, Checked>> {
    const [questEnglish, placeEnglish] = await Promise.all([
      englishFor(rows),
      places ?? (source === "places" ? existingTextFor(rows, bookMatches) : Promise.resolve({} as Record<number, string>)),
    ]);
    const englishOf = (row: Contribution): string | null =>
      row.source === "quests"
        ? (questEnglish.get(row.id) ?? null)
        : row.source === "readables"
          ? bookEnglish(bookMatches.get(row.id))
          : (placeEnglish[row.id] ?? null);
    return new Map(rows.map((row) => [row.id, { ...checkLine({ text: row.text, english: englishOf(row), locale: row.locale }), english: englishOf(row) }]));
  }

  // To review groups and sorts the whole queue, so its first page is what keeps in one click and
  // "Keep all" reaches every page. Every other tab checks only the rows it shows.
  const reviewing = status === "new" && bucket === "ready";
  let checks = reviewing ? await checksFor(matching) : new Map<number, Checked>();
  if (reviewing) {
    matching.sort((a, b) => VERDICT_ORDER[checks.get(a.id)!.verdict] - VERDICT_ORDER[checks.get(b.id)!.verdict]);
  }
  // Why each waiting row waits, in words the editors who cannot fix it can read.
  const waiting = new Map<number, WaitingReason>();
  if (status === "new" && bucket === "blocked") {
    for (const row of matching) {
      const reason = waitingReason({ ...row, quest: questFor(row), hasSpeaker: hasSpeaker.has(row.id) }, npcs[row.id] ?? null, roster, langName(lang));
      if (reason) waiting.set(row.id, reason);
    }
  }
  const waitingSummary = summariseWaiting(matching, waiting, npcs);

  // A page of rows, not the whole queue: every row rendered is a row the browser has to build
  // and React has to diff, and a queue of hundreds made both the load and every click slow.
  // Only this page's rows are looked up further -- existing text and whether their line is in
  // the explorer are the per-row reads here.
  const pages = Math.max(1, Math.ceil(matching.length / PAGE_SIZE));
  const page = Math.min(pageOf(rawPage), pages);
  const shown = matching.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const [existing, linedIds] = await Promise.all([existingTextFor(shown, bookMatches), linesInExplorer(shown)]);
  if (!reviewing) checks = await checksFor(shown, source === "places" ? existing : undefined);
  // Every language's books, for placing a row in one -- only when this page shows a readables row.
  const books = shown.some((row) => row.source === "readables")
    ? (await bookFacets(lang)).map(({ bookId, title, pages }) => ({ bookId, title, pages }))
    : [];

  // ContributionTable is a client component: whatever shape crosses in `initial` lands in the
  // RSC flight payload and is readable in devtools, so the full row -- name, email, raw, the
  // ip listContributions doesn't even select -- never leaves this server function. `body` is
  // the one identifying-adjacent field that does cross, deliberately: see finding 4/the
  // table's own docstring for why a player's complaint belongs where triage can read it.
  const rows: ContributionRow[] = shown.map((row) => ({
    id: row.id,
    source: row.source,
    key: row.key,
    locale: row.locale,
    pack: packHeard(row),
    client: clientOf(row.build),
    count: row.count,
    text: row.text,
    status: row.status,
    createdAt: row.createdAt,
    body: row.body,
    npc: npcs[row.id] ?? null,
    quest: questFor(row),
    book:
      row.source === "readables"
        ? bookFor(
            row,
            bookMatches.get(row.id)!,
            describe(row.locale),
            (lineId) => localeHref(lang, `/readables/r/${pageKeyOf(lineId)}`),
            candidatesOf(row, bookMatches.get(row.id)!),
          )
        : null,
    hasLine: linedIds.has(row.id),
    hasSpeaker: hasSpeaker.has(row.id),
    place: placeOf(row),
    english: checks.get(row.id)!.english,
    check: (({ english: _english, ...check }) => check)(checks.get(row.id)!),
    waiting: waiting.get(row.id) ?? null,
    rejectReason: row.rejectReason,
  }));


  return (
    <BackstagePage
      width="wide"
      title="Review"
      description="Lines players' game clients sent. Compare each with the original, then keep it or drop it. Kept lines are voiced in a later voicing run."
    >
      <div className="mb-6">
        <ContributionsTabs lang={lang} section={source} pending={pending} names={names} showNames={hasObservedNames(lang)} />
      </div>
        <ContributionTable
          // Showing only corrections leaves the lines out; their count stays on the switch.
          initial={show === "corrections" ? [] : rows}
          // Every row the filters match, on any page, as just its id, status and whether a bulk
          // accept may take it, and its group: what "Keep all" and "Drop all" act on.
          matching={(show === "corrections" ? [] : matching).map((row) => {
            const match = bookMatches.get(row.id);
            return { id: row.id, status: row.status, bulk: !match || bulkAcceptable(match), verdict: checks.get(row.id)?.verdict ?? "look" };
          })}
          page={page}
          pages={show === "corrections" ? 1 : pages}
          status={status}
          show={show}
          shownCounts={
            source === "quests" || source === "readables" ? { lines: matching.length, corrections: corrections.length } : null
          }
          bucket={bucket}
          // To review counts what it shows.
          bucketCounts={show === "corrections" ? { ready: corrections.length, blocked: 0 } : bucketCounts}
          waitingSummary={waitingSummary}
          client={client}
          build={build}
          builds={builds}
          source={source}
          stage={stage}
          sort={sort}
          q={q}
          searchIn={searchIn}
          existing={existing}
          books={books}
          roster={roster.data}
          // What api/contributions/npc asks, so the speaker controls are offered only to
          // somebody it will answer. Who an NPC is decides its voice in every language, so it
          // is the global admin's alone; everyone else sees where it stands.
          canAnswerNpc={isAdmin(session.user.role)}
          corrections={
            show !== "lines" && (source === "quests" || source === "readables") && corrections.length > 0 ? (
              <Panel
                id="changes"
                tone="info"
                icon={<ChangesIcon />}
                title="Changes to lines we already have"
                count={corrections.length}
                description={
                  source === "readables"
                    ? "A player's client showed different words than ours. Replace ours if theirs fixes a mistake; drop it if ours is right."
                    : "A player's client showed different words than ours. Replace ours if theirs fixes a mistake; keep both if it is just another way to say it."
                }
              >
                <div>
                  <CorrectionTable source={source} initial={corrections} />
                </div>
              </Panel>
            ) : null
          }
        />
    </BackstagePage>
  );
}

function ChangesIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 7h11M4 12h7M4 17h9" />
      <path d="M17 14l3 3-3 3" />
    </svg>
  );
}

/** To review's order: what keeps in one click, then what needs a fix, a look, and what to drop. */
const VERDICT_ORDER: Record<Verdict, number> = { clean: 0, fix: 1, look: 2, drop: 3 };

/** The waiting tab's breakdown: how many rows wait for each reason, the oldest, and an example NPC. */
function summariseWaiting(
  rows: Contribution[],
  reasons: Map<number, WaitingReason>,
  npcs: Record<number, NpcSummary>,
): { kind: WaitingKind; title: string; fix: string; count: number; oldest: string; example: string | null }[] {
  const byKind = new Map<WaitingKind, { count: number; oldest: string; example: string | null }>();
  for (const row of rows) {
    const reason = reasons.get(row.id);
    if (!reason) continue;
    const seen = byKind.get(reason.kind);
    const name = npcs[row.id]?.npcName ?? null;
    if (!seen) byKind.set(reason.kind, { count: 1, oldest: row.createdAt, example: name });
    else {
      seen.count++;
      if (row.createdAt < seen.oldest) seen.oldest = row.createdAt;
      seen.example ??= name;
    }
  }
  return (Object.keys(WAITING_KINDS) as WaitingKind[]).flatMap((kind) => {
    const seen = byKind.get(kind);
    return seen ? [{ kind, ...WAITING_KINDS[kind], ...seen }] : [];
  });
}

/** A row's checks, with the English line they were read against. */
type Checked = LineCheck & { english: string | null };
