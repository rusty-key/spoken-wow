"use client";

/**
 * The triage list.
 *
 * A table rather than a stack of cards: triage is a scan down a column - what is this
 * about, how old is it, has anybody answered it - and a card makes that scan a scroll. Every
 * cell is one line high for the same reason; a gossip id is a 32-character hash, and left to
 * wrap it makes its row three times the height of its neighbours.
 *
 * Never renders `ip`: it is the rate limiter's key and nothing else, and a triager reading a
 * stranger's address serves no purpose that reading their report does not.
 */
import { useLang } from "@/components/LangProvider";
import { localeHref } from "@/lib/lang";
import { Play } from "lucide-react";
import Link from "@/components/LocaleLink";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

import FilterChip from "@/components/FilterChip";
import { LiteButton } from "@/components/LiteControls";
import { Refreshing } from "@/components/Loading";
import Pagination from "@/components/Pagination";
import QuestsPlayer from "@/components/Player";
import ReportDetail from "@/components/ReportDetail";
import SortHeader from "@/components/SortHeader";
import { LinkTabs } from "@/components/StatusTabs";
import { usePendingPush } from "@/components/usePendingPush";
import { useSearchBox } from "@/components/useSearchBox";
import { Player as BooksPlayer } from "@/components/books/Player";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Player as ZonesPlayer } from "@/components/zones/Player";
import { explorerHref, reportHref, targetExplorerHref } from "@/lib/links";
import type { ResultLine as BookLine } from "@/lib/books/search";
import { searchPath, type SourceLine } from "@/lib/reports/detail";
import {
  reportsHref,
  SECTIONS,
  STATUS_VIEWS,
  type ReportFilters,
  type Section,
  type StatusView,
} from "@/lib/reports/query";
import { CATEGORIES, CATEGORY_COLUMN, STATUS_LABELS, type Category, type Report, type Status } from "@/lib/reports/reports";
import { applyResolutions, type ReportGroup } from "@/lib/reports/rows";
import type { ResultLine as QuestLine } from "@/lib/search";
import { cn } from "@/lib/utils";
import type { ResultLine as ZoneLine } from "@/lib/zones/search";
import type { Source } from "@/lib/sections";

const SECTION_LABELS: Record<Section, string> = {
  quests: "Quests",
  gossip: "Gossip",
  books: "Books",
  zones: "Zones",
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
  canRegenerate,
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
  /** Whether this visitor may spend credits from the panel below a row. */
  canRegenerate: boolean;
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
  const lang = useLang();
  const [resolved, setResolved] = useState<Record<number, Report>>({});
  /** Reports with a resolution in flight. A set, because a group resolves all of its at once. */
  const [busy, setBusy] = useState<ReadonlySet<number>>(new Set());
  /** The group whose line is opened below it, by group key. */
  const [open, setOpen] = useState<string | null>(null);

  /**
   * Lines looked up so far, by source and id. Undefined means "not asked yet", null means
   * the lookup came back with nothing - a report about a line the corpus has since dropped.
   *
   * Here rather than inside the expanded row, because the play button needs the same line
   * without the panel being open, and a second fetch for the same id would be a second
   * corpus lookup for the same answer.
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

  const load = useCallback(
    async (reportSource: Source, lineId: string): Promise<SourceLine | null> => {
      const key = lineKey(reportSource, lineId);
      let cached: SourceLine | null | undefined;
      // Read through a setState rather than off `lines`, which this callback closes over
      // stale: two rows expanded in the same tick would otherwise both fetch.
      setLines((current) => {
        cached = current[key];
        return current;
      });
      if (cached !== undefined) return cached;

      const response = await fetch(searchPath(reportSource, lineId, lang)).catch(() => null);
      const body = response?.ok
        ? ((await response.json().catch(() => null)) as { lines?: SourceLine[] } | null)
        : null;
      const line = body?.lines?.[0] ?? null;

      setLines((current) => ({ ...current, [key]: line }));
      return line;
    },
    [],
  );

  function toggle(group: ReportGroup) {
    const report = group.reports[0];
    if (!report.lineId) return;
    const next = open === group.key ? null : group.key;
    setOpen(next);
    if (next !== null) void load(report.source, report.lineId);
  }

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

  /**
   * One request per report, even for a group: each row keeps its own resolvedAt and
   * resolvedBy, and a report that fails to resolve stays open rather than taking the rest
   * of its group down with it.
   */
  async function resolve(ids: number[], status: Status) {
    setBusy((current) => new Set([...current, ...ids]));
    await Promise.all(
      ids.map(async (id) => {
        const response = await fetch("/api/reports/resolve", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ id, status }),
        }).catch(() => null);

        if (response?.ok) {
          const { report } = (await response.json()) as { report: Report };
          setResolved((current) => ({ ...current, [report.id]: report }));
        }

        setBusy((current) => {
          const next = new Set(current);
          next.delete(id);
          return next;
        });
      }),
    );
  }

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
  function whereCell(report: Report, count?: number) {
    return (
      <div className="flex items-center gap-2 overflow-hidden whitespace-nowrap">
        {/* The explorer, narrowed to this line: where a triager works. A report with no
            line id - a gossip NPC whose reporter never picked one of the takes - narrows
            the explorer by its address instead. The `/r/` page the reporter saw is the
            last fallback, for an address no filter addresses. */}
        {report.lineId ? (
          <Link
            href={explorerHref(report.source, report.lineId)}
            title={report.lineId}
            className="truncate font-mono underline-offset-2 hover:underline"
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
            className="text-muted-foreground truncate font-mono underline-offset-2 hover:underline"
          >
            {report.target}
          </Link>
        ) : (
          <span className="text-muted-foreground truncate">about the project</span>
        )}
        {count ? (
          <Badge variant="secondary" className="shrink-0 py-0 leading-5">
            {count} reports
          </Badge>
        ) : null}
      </div>
    );
  }

  /** Play and open the line. Once per line, so on a group's row rather than each report's. */
  function lineActions(group: ReportGroup) {
    const [first] = group.reports;
    if (!first.lineId) return null;
    const expanded = open === group.key;

    return (
      <>
        <Button
          size="icon-xs"
          variant="ghost"
          title="Play this line"
          aria-label="Play this line"
          onClick={() => void play(first)}
        >
          <Play />
        </Button>
        <Button size="sm" variant="ghost" aria-expanded={expanded} onClick={() => toggle(group)}>
          {expanded ? "Hide" : "Details"}
        </Button>
      </>
    );
  }

  /**
   * Fixed and Not a problem while any of these reports is open, Reopen once none is.
   *
   * Given a whole group, it answers every open report in it: one regenerated line fixes
   * every complaint about it, and answering them one by one was the chore grouping removes.
   */
  function resolveActions(rows: Report[]) {
    const openIds = rows.filter((row) => row.status === "open").map((row) => row.id);
    const ids = openIds.length ? openIds : rows.map((row) => row.id);
    const disabled = ids.some((id) => busy.has(id));

    return openIds.length ? (
      <>
        <LiteButton variant="accept" disabled={disabled} onClick={() => resolve(ids, "fixed")}>
          Fixed
        </LiteButton>
        <LiteButton variant="reject" disabled={disabled} onClick={() => resolve(ids, "not_an_issue")}>
          Not a problem
        </LiteButton>
      </>
    ) : (
      <LiteButton variant="ghost" disabled={disabled} onClick={() => resolve(ids, "open")}>
        Reopen
      </LiteButton>
    );
  }

  /**
   * One report. On its own it carries the line; nested under a group it carries only what
   * that reporter said, indented, with the line left to the group's row above it.
   */
  function reportRow(
    report: Report,
    {
      where,
      lineActions,
      nested,
      expanded,
    }: { where?: ReactNode; lineActions?: ReactNode; nested?: boolean; expanded: boolean },
  ) {

    return (
      // Every cell is one line except the body, which is clamped to two, so the row centres
      // rather than aligning to a top edge that only one cell has.
      <tr
        key={report.id}
        className={cn(
          "align-middle [&>td]:border-b [&>td]:py-2 [&>td]:leading-5",
          nested && "[&>td:first-child]:pl-4",
        )}
      >
        <td className="text-muted-foreground pr-3 text-xs whitespace-nowrap">
          {when(report.createdAt)}
        </td>

        <td className="max-w-[20rem] pr-3 text-xs">{where}</td>

        <td className="pr-3 text-xs whitespace-nowrap">{CATEGORY_COLUMN[report.category]}</td>

        <td className="max-w-md pr-3">
          <p className={cn("whitespace-pre-wrap", !expanded && "line-clamp-2")}>{report.body}</p>
          {report.name || report.email ? (
            <p className="text-muted-foreground mt-1 text-xs">
              {[report.name, report.email].filter(Boolean).join(" · ")}
            </p>
          ) : null}
        </td>

        <td className="pr-3 text-xs whitespace-nowrap">{STATUS_LABELS[report.status]}</td>

        <td>
          <div className="flex items-center justify-end gap-1">
            {lineActions}
            {resolveActions([report])}
          </div>
        </td>
      </tr>
    );
  }

  /**
   * The line several reports are about: newest filing, every complaint made about it, how
   * many are still open, and the actions that answer all of them. The reports follow it.
   */
  function groupRow(group: ReportGroup) {
    const [first] = group.reports;
    const complaints = [...new Set(group.reports.map((row) => CATEGORY_COLUMN[row.category]))];
    const openCount = group.reports.filter((row) => row.status === "open").length;

    return (
      <tr
        key={group.key}
        className="bg-muted/20 align-middle [&>td]:border-b [&>td]:py-2 [&>td]:leading-5"
      >
        <td className="text-muted-foreground pr-3 text-xs whitespace-nowrap">
          {when(first.createdAt)}
        </td>
        <td className="max-w-[20rem] pr-3 text-xs">{whereCell(first, group.reports.length)}</td>
        <td className="pr-3 text-xs" colSpan={2}>
          {complaints.join(", ")}
        </td>
        <td className="pr-3 text-xs whitespace-nowrap">
          {openCount === group.reports.length
            ? STATUS_LABELS.open
            : openCount === 0
              ? "Answered"
              : `${openCount} open`}
        </td>
        <td>
          <div className="flex items-center justify-end gap-1">
            {lineActions(group)}
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
              <SortHeader
                column="filed"
                sort={{ column: "filed", direction: filters.dir }}
                onSort={() => go({ dir: filters.dir === "desc" ? "asc" : "desc" })}
              >
                Filed
              </SortHeader>
              <th className="border-b py-2 pr-3 font-normal">Where</th>
              <th className="border-b py-2 pr-3 font-normal">Complaint</th>
              <th className="border-b py-2 pr-3 font-normal">What they said</th>
              <th className="border-b py-2 pr-3 font-normal">Status</th>
              <th className="border-b py-2 font-normal" />
            </tr>
          </thead>

          <tbody>
            {groups.map((group) => {
              const [first] = group.reports;
              const expanded = open === group.key;
              const key = first.lineId ? lineKey(first.source, first.lineId) : null;
              const single = group.reports.length === 1;

              return [
                single ? (
                  reportRow(first, {
                    where: whereCell(first),
                    lineActions: lineActions(group),
                    expanded,
                  })
                ) : (
                  groupRow(group)
                ),

                ...(single ? [] : group.reports.map((report) => reportRow(report, { nested: true, expanded }))),

                expanded && first.lineId && key ? (
                  <tr key={`${group.key}-detail`}>
                    <td colSpan={6} className="bg-muted/40 border-b">
                      <ReportDetail
                        source={first.source}
                        lineId={first.lineId}
                        line={lines[key]}
                        canRegenerate={canRegenerate}
                        onRegenerated={(version) =>
                          setVersions((current) => ({ ...current, [key]: version }))
                        }
                        onOverridden={(text) =>
                          setLines((current) => {
                            const known = current[key];
                            if (!known) return current;
                            return { ...current, [key]: { ...known, override: text } };
                          })
                        }
                      />
                    </td>
                  </tr>
                ) : null,
              ];
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
          ) : playing.source === "zones" ? (
            <ZonesPlayer
              audioRef={audio}
              line={playingLine as ZoneLine}
              version={playingVersion}
            />
          ) : (
            <BooksPlayer
              audioRef={audio}
              line={playingLine as BookLine}
              version={playingVersion}
            />
          )}
        </div>
      ) : null}
    </>
  );
}
