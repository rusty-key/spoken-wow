import { pageLang } from "@/lib/lang-server";
import { viewerOf } from "@/lib/grants/store";
import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";

import ContributionTable, { type ContributionRow } from "@/components/ContributionTable";
import ContributionsTabs from "@/components/ContributionsTabs";
import { auth } from "@/lib/auth";
import { bookFacets, catalogue, pageById } from "@/lib/books/catalogue";
import { clientOf, isClientFamily } from "@/lib/contributions/client";
import { corpusLookup } from "@/lib/contributions/existing";
import { lineStates, tabOf } from "@/lib/contributions/known";
import { isStatus, type ContributionStatus } from "@/lib/contributions/contributions";
import { linesInExplorer, momentHasSpeaker } from "@/lib/contributions/accept";
import {
  isSearchIn,
  bucketOf,
  isBucket,
  isSection,
  namesSpeaker,
  sectionOf,
  sourceOfSection,
  matchesSearch,
  isStageFilter,
  matchesStage,
  pageOf,
  PAGE_SIZE,
  sortOf,
  type ClientFilter,
  type ContributionSort,
  type Bucket,
  type StageFilter,
} from "@/lib/contributions/query";
import { listContributions, observationMeta, type Contribution } from "@/lib/contributions/store";
import {
  bookFor,
  npcSummaryFrom,
  questFor,
  resolveMissing,
  idOnlyResolution,
  type BookMatch,
  type NpcSummary,
} from "@/lib/contributions/triage";
import { facets } from "@/lib/facets";
import { observedFrom, resolveNpc } from "@/lib/npc/resolve";
import { getResolutions, getResolutionsById, resolutionKey, type NpcKind } from "@/lib/npc/store";
import { BASE_LANG, isClientLang, isLang, langName, type Lang } from "@/lib/lang";
import { loadRoster } from "@/lib/voices/roster-store";
import { can } from "@/lib/permissions";
import { lineByPath } from "@/lib/zones/catalogue";
import { Contained, Wide } from "@/components/Width";

export const metadata: Metadata = { title: "Contributions · Spoken" };

// A triage queue read against a database that other people are also resolving rows in.
export const dynamic = "force-dynamic";

/**
 * The corpus text a contribution's key already resolves to, or undefined where it does not.
 *
 * Only books and zones have a key corpusLookup can resolve (see existing.ts); a quests row is
 * left out of the map entirely rather than looked up and always missing, so the table can
 * tell "not checked" apart from "checked and the corpus has nothing".
 */
async function existingTextFor(contributions: Contribution[]): Promise<Record<number, string>> {
  const found: Record<number, string> = {};

  await Promise.all(
    contributions.map(async (row) => {
      const lookup = corpusLookup(row.source, row.key);
      if (!lookup) return;

      if (lookup.source === "books") {
        const page = await pageById(lookup.pageId);
        if (page) found[row.id] = page.text;
      } else {
        const line = await lineByPath(lookup.mapID, lookup.slug);
        if (line) found[row.id] = line.full;
      }
    }),
  );

  return found;
}

/** The English page each matched books row names, keyed on the page id. */
async function bookMatchesFor(contributions: Contribution[]): Promise<Map<number, BookMatch>> {
  const ids = new Set(contributions.flatMap((row) => (row.pageId === null ? [] : [row.pageId])));
  if (ids.size === 0) return new Map();
  const matches = new Map<number, BookMatch>();
  for (const page of await catalogue(BASE_LANG)) {
    if (!ids.has(page.pageId)) continue;
    const { pageId, bookId, title, pageNumber, pageCount } = page;
    matches.set(pageId, { pageId, bookId, title, pageNumber, pageCount });
  }
  return matches;
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
 * entirely means the envelope never named an NPC at all -- zones and books never do, and a
 * quests envelope keyed on quest+event rather than npc doesn't either.
 */
async function npcFor(contributions: Contribution[]): Promise<Record<number, NpcSummary>> {
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
  const keys: { npcKind: NpcKind; npcId: number }[] = [];
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
    // No npc named at all -- zones, books, or a quest keyed on quest+event -- is the one case
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
    found[row.id] = await npcSummaryFrom(
      { npcKind: o.npcKind, npcId: o.npcId, npcName: o.npcName },
      lookup.resolution,
      lookup.conflict,
    );
  }

  return found;
}

/** Where a zones or books row was read, in the client's own words. */
function placeOf(row: Contribution): string | null {
  if (row.source === "zones") return [row.meta.zone, row.meta.subzone].filter(Boolean).join(" · ") || null;
  if (row.source === "books") return row.meta.book ? `${row.meta.book}${row.meta.number ? ` p.${row.meta.number}` : ""}` : null;
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
    stage?: string;
    sort?: string;
    dir?: string;
    page?: string;
    q?: string;
    filter?: string;
  }>;
}) {
  const lang = await pageLang(params);
  const { source } = await params;
  if (!isSection(source)) notFound();
  const session = await auth.api.getSession({ headers: await headers() });

  // 404, matching /reports: a member has no business learning the page exists, and these
  // rows hold text and identifying details a stranger pasted in. Per language, because
  // accepting a contribution writes that language's text.
  const viewer = await viewerOf(session);
  if (!session || !can(viewer, "edit", lang)) notFound();

  // Every envelope is in the language of the client that wrote it, and no client runs in this
  // one: the queue is empty by construction, not because nobody has sent anything yet.
  if (!isClientLang(lang)) {
    return (
      <main className="pt-6 pb-24">
        <Contained>
          <h1 className="text-xl font-semibold">Contributions</h1>
          <p className="text-muted-foreground mt-1 mb-5 text-sm">
            Contributions come from the game client, and no client runs in {langName(lang)}. Its
            text is written here, on each line&apos;s page.
          </p>
          <ContributionsTabs
            lang={lang}
            section={source}
            view="contributions"
          />
        </Contained>
      </main>
    );
  }

  const {
    status: rawStatus,
    bucket: rawBucket,
    client: rawClient,
    stage: rawStage,
    sort: rawSort,
    dir: rawDir,
    page: rawPage,
    q: rawQ,
    filter: rawFilter,
  } = await searchParams;
  const status: ContributionStatus = isStatus(rawStatus) ? rawStatus : "new";
  // Only quests' New tab is split: books and zones name no speaker, an accepted row was ready
  // by definition, and a rejected one's speaker no longer matters.
  const bucket: Bucket = namesSpeaker(source) && isBucket(rawBucket) ? rawBucket : "ready";

  // Which game the text came from, read off `build` (lib/contributions/client.ts). Defaults to
  // the Forever beta, the client nearly all of this queue comes from; "all" has to be asked for.
  const client: ClientFilter = isClientFamily(rawClient) ? rawClient : rawClient === "all" ? "all" : "forever";

  // Which quest panel the text was read off -- accept, progress or complete -- or gossip.
  const stage: StageFilter = source === "quests" && isStageFilter(rawStage) ? rawStage : "all";

  // Books and zones name no NPC or quest, so their search is always over the text.
  const q = typeof rawQ === "string" ? rawQ.trim() : "";
  const searchIn = namesSpeaker(source) && isSearchIn(rawFilter) ? rawFilter : "any";

  // Whichever column header was last clicked; most sent first until one is.
  const sort: ContributionSort = sortOf(rawSort, rawDir);

  // Lines the corpus already has are not this queue's: a different text is a correction, on
  // its own tab, and the same text is nothing to triage at all (known.ts's tabOf).
  // Gossip is the quests rows tied to no quest, so the two sections read one source and split it.
  const listed = (await listContributions(status, lang, sort, sourceOfSection(source))).filter(
    (row) => sectionOf(row, questFor(row)) === source,
  );
  const states = await lineStates(listed);
  const contributions = listed.filter((row, index) => tabOf(row.status, states[index]) === "contributions");
  // Every row's NPC, not just this page's: the buckets read it, and it is one query for the lot.
  const npcs = await npcFor(contributions);

  const filtered = contributions
    .filter((row) => client === "all" || clientOf(row.build).family === client)
    .filter((row) => matchesStage(questFor(row), stage))
    .filter((row) => matchesSearch({ text: row.text, npc: npcs[row.id], quest: questFor(row) }, q, searchIn));

  // Counted after the other filters, so each tab's count matches what it shows.
  const hasSpeaker = await momentHasSpeaker(filtered);
  const roster = await loadRoster();
  const bucketCounts: Record<Bucket, number> = { ready: 0, blocked: 0 };
  const matching = filtered.filter((row) => {
    const own = bucketOf({ ...row, quest: questFor(row), hasSpeaker: hasSpeaker.has(row.id) }, npcs[row.id] ?? null, roster);
    bucketCounts[own]++;
    return status !== "new" || own === bucket;
  });

  // A page of rows, not the whole queue: every row rendered is a row the browser has to build
  // and React has to diff, and a queue of hundreds made both the load and every click slow.
  // Only this page's rows are looked up further -- existing text and whether their line is in
  // the explorer are the per-row reads here.
  const pages = Math.max(1, Math.ceil(matching.length / PAGE_SIZE));
  const page = Math.min(pageOf(rawPage), pages);
  const shown = matching.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const [existing, linedIds, bookMatches] = await Promise.all([
    existingTextFor(shown),
    linesInExplorer(shown),
    bookMatchesFor(shown),
  ]);
  // The English books, for matching a translated page to one -- only when this page shows a
  // row that can be matched.
  const books = shown.some((row) => bookFor(row, null))
    ? (await bookFacets(BASE_LANG)).map(({ bookId, title, pages }) => ({ bookId, title, pages }))
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
    client: clientOf(row.build),
    count: row.count,
    text: row.text,
    status: row.status,
    createdAt: row.createdAt,
    body: row.body,
    npc: npcs[row.id] ?? null,
    quest: questFor(row),
    book: bookFor(row, row.pageId === null ? null : (bookMatches.get(row.pageId) ?? null)),
    hasLine: linedIds.has(row.id),
    hasSpeaker: hasSpeaker.has(row.id),
    place: placeOf(row),
  }));

  const facetValues = await facets();

  return (
    <main className="pt-6 pb-24">
      <Contained>
        <h1 className="text-xl font-semibold">Contributions</h1>
        <p className="text-muted-foreground mt-1 mb-5 text-sm">
          Envelopes players pasted in for text this corpus has no audio for. Accepting a row does
          not queue anything -- it only marks the row for the next export, which the pipelines
          pull on their own schedule.
        </p>
      </Contained>
      <Wide>
        <ContributionsTabs
          lang={lang}
          section={source}
          view="contributions"
        />
        <ContributionTable
          initial={rows}
          // Every row the filters match, on any page, as just its id and status: what "Accept all"
          // acts on.
          matching={matching.map((row) => ({ id: row.id, status: row.status }))}
          page={page}
          pages={pages}
          status={status}
          bucket={bucket}
          bucketCounts={bucketCounts}
          client={client}
          source={source}
          stage={stage}
          sort={sort}
          q={q}
          searchIn={searchIn}
          existing={existing}
          books={books}
          roster={facetValues.roster}
          // What api/contributions/npc asks, so the speaker controls are offered only to
          // somebody it will answer. An NPC's race and gender decide its voice in every
          // language, so that stays narrower than triaging this language's text.
          canAnswerNpc={can(viewer, "regenerate", lang)}
        />
      </Wide>
    </main>
  );
}
