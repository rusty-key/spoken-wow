"use client";

/**
 * The triage list.
 *
 * A table rather than a stack of cards: triage is a scan down a column - what is this
 * about, how old is it, what did they say - and a card makes that scan a scroll. Each line
 * sits beside its reports, so a triager listens and answers without opening anything. The
 * where, date and action cells never wrap; a gossip id is a 32-character hash, and left to
 * wrap it makes its row three times the height of its neighbours.
 *
 * Never renders `ip`: it is the rate limiter's key and nothing else, and a triager reading a
 * stranger's address serves no purpose that reading their report does not.
 */
import { useLang } from "@/components/LangProvider";
import { localeHref } from "@/lib/lang";
import Link from "@/components/LocaleLink";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

import FilterChip from "@/components/FilterChip";
import { LiteButton } from "@/components/LiteControls";
import { Refreshing } from "@/components/Loading";
import Pagination from "@/components/Pagination";
import QuestsPlayer from "@/components/Player";
import ReportDetail from "@/components/ReportDetail";
import LineHeading from "@/components/reports/LineHeading";
import ReportContribution from "@/components/reports/ReportContribution";
import SortHeader from "@/components/SortHeader";
import { ReportContextNote } from "@/components/reports/ReportContextFacts";
import { LinkTabs } from "@/components/StatusTabs";
import { usePendingPush } from "@/components/usePendingPush";
import { useSearchBox } from "@/components/useSearchBox";
import { Player as ReadablesPlayer } from "@/components/readables/Player";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Player as PlacesPlayer } from "@/components/places/Player";
import { explorerHref, reportHref, targetExplorerHref } from "@/lib/links";
import type { ResultLine as BookLine } from "@/lib/readables/search";
import { searchPath, type Heading, type SourceLine } from "@/lib/reports/detail";
import {
  reportsHref,
  SECTIONS,
  STATUS_VIEWS,
  type ReportFilters,
  type Section,
  type StatusView,
} from "@/lib/reports/query";
import {
  CATEGORIES,
  CATEGORY_COLUMN,
  STATUS_LABELS,
  type Category,
  type Queue,
  type Report,
  type Status,
} from "@/lib/reports/reports";
import { passReport, resolveReport } from "@/lib/reports/client";
import { applyResolutions, type ReportGroup } from "@/lib/reports/rows";
import type { ResultLine as QuestLine } from "@/lib/search";
import { cn } from "@/lib/utils";
import type { ResultLine as ZoneLine } from "@/lib/places/search";
import type { ResultLine as BossLine } from "@/lib/bosses/search";
import { placesSection } from "@/components/places/sections";
import { bossesSection } from "@/components/bosses/sections";
import type { Source } from "@/lib/sections";

// No facets: the table plays lines, it does not narrow to them.
const PLACES = placesSection();
const BOSSES = bossesSection();

const SECTION_LABELS: Record<Section, string> = {
  quests: "Quests",
  readables: "Readables",
  places: "Places",
  bosses: "Bosses",
};

const VIEW_LABELS: Record<StatusView, string> = { ...STATUS_LABELS, all: "All" };

/** The complaint dropdown's options, in the order the report form offers them. */
const CATEGORY_OPTIONS = CATEGORIES.map((category) => ({
  value: category,
  label: CATEGORY_COLUMN[category],
}));

/** The day and the clock time, short enough to sit in a column. */
function when(at: string): string {
  return new Date(at).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** One line of one corpus. Reports from all three share this table and its player. */
function lineKey(source: Source, lineId: string): string {
  return `${source}:${lineId}`;
}

export default function ReportTable({
  groups: initial,
  total,
  page,
  pages,
  sectionCounts,
  statusCounts,
  filters,
  npcs,
  canRegenerate,
  canContribute,
  labelled,
  passTo,
  showNpcPage,
}: {
  /** This page's lines, each with its reports, in the order the server sorted them. */
  groups: ReportGroup[];
  /** Reports matching every filter, on any page. */
  total: number;
  page: number;
  pages: number;
  /** Each section's reports under the status, complaint and search in force. */
  sectionCounts: Record<Section, number>;
  /** This section's reports in each status, under the complaint and search in force. */
  statusCounts: Record<StatusView, number>;
  filters: ReportFilters;
  /** Who this page's reports with no line are about, by address, where that is an NPC. */
  npcs: Record<string, Heading>;
  /** Whether this visitor may spend credits from the line's panel. */
  canRegenerate: boolean;
  /** Accepting a report's text writes the language's original. */
  canContribute: boolean;
  labelled: boolean;
  passTo: Queue[];
  /** The NPC page is the admins'; see LineHeading. */
  showNpcPage: boolean;
}) {
  /**
   * What this session resolved, overlaid on the server's rows.
   *
   * NOT a copy of `groups`: the filters above are links, so switching one is a navigation
   * that re-renders this component with new rows. Seeding state from props ignored them,
   * and the table sat unchanged until somebody reloaded the page - which is the bug this
   * shape exists to make impossible. See lib/reports/rows.ts.
   */
  const { pending, push } = usePendingPush();
  const { refresh } = useRouter();
  const lang = useLang();
  const [resolved, setResolved] = useState<Record<number, Report>>({});
  /** Reports with a resolution in flight. A set, because a group resolves all of its at once. */
  const [busy, setBusy] = useState<ReadonlySet<number>>(new Set());

  /**
   * Lines looked up so far, by source and id. Undefined means "not asked yet", null means
   * the lookup came back with nothing - a report about a line the corpus has since dropped.
   *
   * Here rather than inside each panel, because the transport bar needs the same line, and a
   * second fetch for the same id would be a second corpus lookup for the same answer.
   */
  const [lines, setLines] = useState<Record<string, SourceLine | null>>({});
  /** The line the transport bar is pointed at, or null before anything has been played. */
  const [playing, setPlaying] = useState<{ source: Source; lineId: string } | null>(null);
  /**
   * Bumped by every press of a play button, including a second press of the same one.
   *
   * The start cannot happen in the handler: before the first press there is no transport
   * bar on the page at all, so the <audio> the ref would point at does not exist yet and
   * the click did nothing until a second one arrived to find it mounted. An effect runs
   * after the commit that mounts it, and the counter is what makes replaying the line
   * already loaded a change the effect can see.
   */
  const [pressed, setPressed] = useState(0);
  /** Takes written in this session, so the player plays the new one rather than the cache. */
  const [versions, setVersions] = useState<Record<string, number>>({});

  // ONE <audio> for the page, handed to whichever section's adapter is showing. Starting a
  // line therefore stops the previous one with no bookkeeping - see AudioPlayer.
  const audio = useRef<HTMLAudioElement>(null);

  /**
   * One request per line, kept as the promise so a play press that lands while the row's
   * lookup is still in flight waits for it rather than asking again. `fresh` asks again after
   * a regeneration or a rewrite: the search knows what changed, where a patch would guess.
   */
  const requests = useRef(new Map<string, Promise<SourceLine | null>>());

  const load = useCallback(
    (reportSource: Source, lineId: string, fresh = false): Promise<SourceLine | null> => {
      const key = lineKey(reportSource, lineId);
      const known = requests.current.get(key);
      if (known && !fresh) return known;

      const request = (async () => {
        const response = await fetch(searchPath(reportSource, lineId, lang)).catch(() => null);
        const body = response?.ok
          ? ((await response.json().catch(() => null)) as { lines?: SourceLine[] } | null)
          : null;
        const line = body?.lines?.[0] ?? null;

        setLines((current) => ({ ...current, [key]: line }));
        return line;
      })();
      requests.current.set(key, request);
      return request;
    },
    [lang],
  );

  // Every line on the page is shown beside its reports, so every one is looked up. `load`
  // asks once per line, so a re-render or a resolution asks nothing again.
  useEffect(() => {
    for (const { reports: [first] } of initial) {
      if (first.lineId) void load(first.source, first.lineId);
    }
  }, [initial, load]);

  async function play(report: Report) {
    if (!report.lineId) return;
    const line = await load(report.source, report.lineId);
    if (!line) return;

    setPlaying({ source: report.source, lineId: report.lineId });
    setPressed((count) => count + 1);
  }

  useEffect(() => {
    if (pressed === 0) return;
    void audio.current?.play().catch(() => {});
  }, [pressed]);

  async function act(ids: number[], request: (id: number) => Promise<Report | null>) {
    setBusy((current) => new Set([...current, ...ids]));
    await Promise.all(
      ids.map(async (id) => {
        const report = await request(id);
        if (report) setResolved((current) => ({ ...current, [report.id]: report }));

        setBusy((current) => {
          const next = new Set(current);
          next.delete(id);
          return next;
        });
      }),
    );
  }

  const resolve = (ids: number[], status: Status) => act(ids, (id) => resolveReport(id, status));

  // Refreshed because the row may no longer belong on this viewer's list.
  const pass = (id: number, to: Queue) => act([id], (each) => passReport(each, to)).then(refresh);

  /** Move one filter and keep the rest, through the URL so a narrowed queue can be shared. */
  const hrefFor = (next: Partial<ReportFilters>, toPage = 1) => localeHref(lang, reportsHref(filters, next, toPage));
  const go = (next: Partial<ReportFilters>, toPage = 1) => push(hrefFor(next, toPage));
  const [query, setQuery] = useSearchBox(filters.q, (next) => go({ q: next }));

  // Grouped by the server, so a page never splits a line; only the statuses are overlaid.
  const groups = initial.map((group) => ({ ...group, reports: applyResolutions(group.reports, resolved) }));
  const playingKey = playing ? lineKey(playing.source, playing.lineId) : null;
  const playingLine = playingKey === null ? null : (lines[playingKey] ?? null);
  const playingVersion = playingKey === null ? undefined : versions[playingKey];

  /** The line: a link into the explorer narrowed to it. The tab already says the section. */
  function whereCell(report: Report, rowSpan: number) {
    return (
      <td rowSpan={rowSpan} className="w-0 pr-3 text-xs whitespace-nowrap">
        {/* The explorer, narrowed to this line: where a triager works. A report with no
            line id - a gossip NPC whose reporter never picked one of the takes - narrows
            the explorer by its address instead. The `/r/` page the reporter saw is the
            last fallback, for an address no filter addresses. */}
        {report.lineId ? (
          <Link
            href={explorerHref(report.source, report.lineId)}
            title={report.lineId}
            className="font-mono underline-offset-2 hover:underline"
          >
            {report.lineId}
          </Link>
        ) : report.target ? (
          <Link
            href={
              targetExplorerHref(report.source, report.target) ??
              reportHref(report.source, report.target)
            }
            title={report.target}
            className="text-muted-foreground font-mono underline-offset-2 hover:underline"
          >
            {report.target}
          </Link>
        ) : (
          <span className="text-muted-foreground">about the project</span>
        )}
      </td>
    );
  }

  /**
   * Fixed and Not a problem while any of these reports is open or set aside as minor, with
   * Minor beside them for open ones and Reopen for minor ones. Reopen alone once all are answered.
   *
   * Given a whole group, it answers every open report in it - or, with none open, every minor
   * one: one regenerated line fixes every complaint about it, and answering them one by one
   * was the chore grouping removes.
   */
  function resolveActions(rows: Report[]) {
    const withStatus = (status: Status) => rows.filter((row) => row.status === status).map((row) => row.id);
    const open = withStatus("open");
    const pending = open.length ? open : withStatus("minor");
    const ids = pending.length ? pending : rows.map((row) => row.id);
    const disabled = ids.some((id) => busy.has(id));
    const all = rows.length > 1;

    const reopen = (
      <LiteButton variant="ghost" disabled={disabled} onClick={() => resolve(ids, "open")}>
        {all ? "Reopen all" : "Reopen"}
      </LiteButton>
    );
    if (!pending.length) return reopen;

    return (
      <>
        <LiteButton variant="accept" disabled={disabled} onClick={() => resolve(ids, "fixed")}>
          {all ? "All fixed" : "Fixed"}
        </LiteButton>
        <LiteButton variant="reject" disabled={disabled} onClick={() => resolve(ids, "not_an_issue")}>
          {all ? "All not problems" : "Not a problem"}
        </LiteButton>
        {open.length ? (
          <LiteButton variant="ghost" disabled={disabled} onClick={() => resolve(ids, "minor")}>
            {all ? "All minor" : "Minor"}
          </LiteButton>
        ) : (
          reopen
        )}
      </>
    );
  }

  /**
   * The line a group is about, beside its rows, so the reports stay next to the take they
   * complain about. Spans the group's row and its reports' rows.
   */
  function detailCell(group: ReportGroup, rowSpan: number) {
    const [first] = group.reports;
    const { source, lineId } = first;
    const key = lineId ? lineKey(source, lineId) : null;
    // No line, so no take to show: a report about an NPC as a whole shows who that NPC is.
    const npc = first.target ? npcs[first.target] : undefined;

    return (
      <td rowSpan={rowSpan} className={cn("align-top", (key || npc) && "w-[28rem] min-w-[28rem]")}>
        {lineId && key ? (
          <ReportDetail
            source={source}
            lineId={lineId}
            line={lines[key]}
            canRegenerate={canRegenerate}
            showNpcPage={showNpcPage}
            onRegenerated={(version) => {
              setVersions((current) => ({ ...current, [key]: version }));
              void load(source, lineId, true);
            }}
            onRewritten={() => void load(source, lineId, true)}
            onPlay={() => void play(first)}
          />
        ) : npc ? (
          <div className="px-3 py-3">
            <LineHeading detail={npc} showNpcPage={showNpcPage} asideClassName="ml-2" />
          </div>
        ) : null}
      </td>
    );
  }

  function passAction(report: Report) {
    const to: Queue = report.queue === "text" ? "audio" : "text";
    if (!passTo.includes(to)) return null;
    return (
      <LiteButton disabled={busy.has(report.id)} onClick={() => void pass(report.id, to)}>
        {to === "text" ? "Pass to text" : "Pass to team"}
      </LiteButton>
    );
  }

  /**
   * One report. On its own it carries the line; under a group it carries only what that
   * reporter said, with the line and its details spanning down from the group's row.
   */
  function reportRow(report: Report, lead?: ReactNode) {
    return (
      <tr key={report.id} className="align-top [&>td]:border-b [&>td]:py-2 [&>td]:leading-5">
        {lead}

        <td className="text-muted-foreground w-0 pr-3 text-xs whitespace-nowrap">
          {when(report.createdAt)}
        </td>

        <td className="pr-3">
          <p className="whitespace-pre-wrap">
            {labelled ? (
              <Badge variant="outline" className="mr-2 py-0 leading-5">
                {report.queue === "text" ? "Text" : "Team"}
              </Badge>
            ) : null}
            <span className="text-muted-foreground mr-2 text-xs">{CATEGORY_COLUMN[report.category]}</span>
            {report.body}
          </p>
          <ReportContextNote context={report.context}>
            {/* The text the reporter's addon saw, as the contributions page would take it. */}
            {canContribute && report.source !== "places" && report.source !== "bosses" && report.context?.text?.trim() ? (
              <ReportContribution
                report={report}
                onFixed={(fixed) => setResolved((current) => ({ ...current, [fixed.id]: fixed }))}
              />
            ) : null}
          </ReportContextNote>
          {report.name || report.email ? (
            <p className="text-muted-foreground mt-1 text-xs">
              {[report.name, report.email].filter(Boolean).join(" · ")}
            </p>
          ) : null}
        </td>

        <td className="w-0">
          <div className="flex items-center justify-end gap-1">
            {passAction(report)}
            {resolveActions([report])}
          </div>
        </td>
      </tr>
    );
  }

  /**
   * The line several reports are about: how many there are, every complaint
   * made about it, and the actions that answer all of them. The reports follow it.
   */
  function groupRow(group: ReportGroup) {
    const [first] = group.reports;
    const complaints = [...new Set(group.reports.map((row) => CATEGORY_COLUMN[row.category]))];
    /** The group's row and its reports' rows: what its line's cells span. */
    const rows = 1 + group.reports.length;

    return (
      <tr key={group.key} className="bg-muted/20 align-top [&>td]:border-b [&>td]:py-2 [&>td]:leading-5">
        {whereCell(first, rows)}
        {detailCell(group, rows)}
        {/* No date: each report under it has its own, and the empty cell sets this row apart. */}
        <td className="w-0" />
        <td className="pr-3 text-xs">
          <Badge variant="secondary" className="mr-2 py-0 leading-5">
            {group.reports.length} reports
          </Badge>
          {complaints.join(", ")}
        </td>
        <td className="w-0">
          <div className="flex items-center justify-end gap-1">
            {resolveActions(group.reports)}
          </div>
        </td>
      </tr>
    );
  }

  return (
    <>
      <LinkTabs
        label="Section"
        onGo={push}
        active={filters.section}
        tabs={SECTIONS.map((section) => ({
          value: section,
          label: `${SECTION_LABELS[section]} (${sectionCounts[section]})`,
          href: hrefFor({ section }),
        }))}
      />
      <LinkTabs
        label="Status"
        onGo={push}
        active={filters.view}
        tabs={STATUS_VIEWS.map((view) => ({
          value: view,
          label: `${VIEW_LABELS[view]} (${statusCounts[view]})`,
          href: hrefFor({ view }),
        }))}
      />
      <nav className="mb-4 flex flex-wrap items-center gap-2">
        <Input
          type="search"
          value={query}
          placeholder="What they said, the line or who sent it…"
          aria-label="Search"
          className="h-8 min-w-0 basis-64"
          onChange={(event) => setQuery(event.target.value)}
        />
        <FilterChip
          label="complaint"
          value={filters.category === "all" ? undefined : filters.category}
          options={CATEGORY_OPTIONS}
          onChange={(next) => go({ category: (next as Category | undefined) ?? "all" })}
        />
        {pending && <Refreshing />}
        <span className="text-muted-foreground ml-auto text-xs tabular-nums">
          {total === 1 ? "1 report" : `${total.toLocaleString()} reports`}
          {pages > 1 ? ` · page ${page} of ${pages}` : ""}
        </span>
      </nav>

      {groups.length === 0 ? (
        <p className="text-muted-foreground text-sm">Nothing here.</p>
      ) : (
        <table
          aria-busy={pending}
          className={cn("w-full border-separate border-spacing-0 text-sm transition-opacity", pending && "opacity-60")}
        >
          <thead className="text-muted-foreground text-left text-xs">
            <tr>
              <th className="border-b py-2 pr-3 font-normal">Where</th>
              <th className="border-b py-2 font-normal" />
              <SortHeader
                column="filed"
                sort={{ column: "filed", direction: filters.dir }}
                onSort={() => go({ dir: filters.dir === "desc" ? "asc" : "desc" })}
              >
                Filed
              </SortHeader>
              <th className="border-b py-2 pr-3 font-normal">What</th>
              <th className="border-b py-2 font-normal" />
            </tr>
          </thead>

          <tbody>
            {groups.map((group) => {
              const [first] = group.reports;
              return group.reports.length === 1
                ? reportRow(
                    first,
                    <>
                      {whereCell(first, 1)}
                      {detailCell(group, 1)}
                    </>,
                  )
                : [groupRow(group), ...group.reports.map((report) => reportRow(report))];
            })}
          </tbody>
        </table>
      )}
      <Pagination page={page} pageCount={pages} onPage={(to) => go({}, to)} />

      {/* The transport bar the explorers use, with the adapter of whichever section the
          playing line belongs to. Drawn only once something has been played: a bar saying
          "nothing playing" over a triage list is a line of chrome that answers nothing. */}
      {playing && playingLine ? (
        <div className="fixed inset-x-0 bottom-0 z-40">
          {playing.source === "quests" ? (
            <QuestsPlayer
              ref={audio}
              line={playingLine as QuestLine}
              version={playingVersion}
            />
          ) : playing.source === "places" ? (
            <PlacesPlayer
              section={PLACES}
              audioRef={audio}
              line={playingLine as ZoneLine}
              version={playingVersion}
            />
          ) : playing.source === "bosses" ? (
            <PlacesPlayer
              section={BOSSES}
              audioRef={audio}
              line={playingLine as BossLine}
              version={playingVersion}
            />
          ) : playing.source === "readables" ? (
            <ReadablesPlayer
              audioRef={audio}
              line={playingLine as BookLine}
              version={playingVersion}
            />
          ) : null}
        </div>
      ) : null}
    </>
  );
}
