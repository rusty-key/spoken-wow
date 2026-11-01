"use client";

/**
 * The corrections tab: a quest line or book page as the corpus has it, beside the text a
 * player's client showed for the same quest and moment, or page, with the words that differ marked on each side.
 *
 * Both texts are shown open, not behind a `<details>` as the triage table's are: the
 * difference is the whole reason the row is here, and it is usually a word or two in a
 * paragraph -- the marks are what make it a glance rather than a read.
 *
 * A quest moment the game shows in more than one wording lists each under "Corpus has", the
 * one closest to the player's text picked; picking another sets the player's text against it,
 * and Accept fixes the one picked.
 *
 * Takes `CorrectionRow`, not the stored row, for the reason ContributionTable's docstring gives:
 * a client component's props are readable in the page's payload.
 */
import Link from "next/link";
import { useCallback, useState } from "react";

import { useLang } from "@/components/LangProvider";
import ClientSelect from "@/components/ClientSelect";
import { SEARCH_IN_OPTIONS, STAGE_CHIP_OPTIONS, STAGE_LABELS } from "@/components/contribution-chips";
import FilterChip from "@/components/FilterChip";
import MultiFilterChip from "@/components/MultiFilterChip";
import { LiteButton } from "@/components/LiteControls";
import { Refreshing } from "@/components/Loading";
import SendersButton from "@/components/SendersButton";
import StatusTabs from "@/components/StatusTabs";
import { Input } from "@/components/ui/input";
import { usePendingPush } from "@/components/usePendingPush";
import { useLocalDates } from "@/components/useLocalDates";
import { useSearchBox } from "@/components/useSearchBox";
import type { ClientSummary } from "@/lib/contributions/client";
import { wordDiff, type DiffPart } from "@/lib/contributions/compare";
import type { ContributionStatus } from "@/lib/contributions/contributions";
import { type ClientFilter, type QuestStage, type StageFilter } from "@/lib/contributions/query";
import { localeHref } from "@/lib/lang";
import type { Filter } from "@/lib/search";
import { cn } from "@/lib/utils";
import { wowheadQuestUrl } from "@/lib/wowhead";

/** One wording of the moment as the corpus has it. */
export type CorrectionWording = {
  lineId: string;
  variant: number;
  /** Where the line is edited, locale prefix not yet applied. */
  editHref: string;
  /** The corpus's current text, its `$B` breaks already made line breaks. */
  before: string;
};

export type CorrectionRow = {
  id: number;
  /** The moment's wordings, one for a book page or a moment with only its first. */
  wordings: CorrectionWording[];
  /** The index in `wordings` of the one closest to `after`. */
  closest: number;
  /** Null for a book page, and for stored meta naming no quest, which a quest correction always does. */
  quest: { title: string; questId: number; stage: QuestStage | null } | null;
  /** Who the player's client said speaks the line; null when the envelope named nobody. */
  npc: { npcId: number; npcName: string | null } | null;
  client: ClientSummary;
  locale: string;
  count: number;
  createdAt: string;
  status: ContributionStatus;
  /** A book page's title, with its number; null for a quest. */
  title: string | null;
  /** What the player's client showed. */
  after: string;
  body: string | null;
};

/** What an accept sends beside the id: the wording it fixes, or that it is another wording. */
type Accept = { lineId: string; variant: number } | { as: "wording" };

/** Corrections are quest panels only, so gossip is not offered. */
const QUEST_STAGE_OPTIONS = STAGE_CHIP_OPTIONS.filter((option) => option.value !== "gossip");

export type CorrectionSource = "quests" | "readables";

type Filters = { status: ContributionStatus; client: ClientFilter; stage: StageFilter; q: string; searchIn: Filter };

function correctionsHref(source: CorrectionSource, filters: Filters): string {
  // Client always written, "all" included: left out, it means the Era and Forever default.
  const params = new URLSearchParams({ status: filters.status, client: filters.client });
  if (filters.stage.length) params.set("stage", filters.stage.join(","));
  if (filters.q.trim()) params.set("q", filters.q.trim());
  if (filters.searchIn !== "any") params.set("filter", filters.searchIn);
  return `/contributions/${source}/corrections?${params}`;
}


export default function CorrectionTable({
  source,
  initial,
  status,
  client,
  stage,
  q,
  searchIn,
}: {
  source: CorrectionSource;
  initial: CorrectionRow[];
  status: ContributionStatus;
  client: ClientFilter;
  stage: StageFilter;
  q: string;
  searchIn: Filter;
}) {
  const when = useLocalDates();
  const lang = useLang();
  const { pending, push } = usePendingPush();
  const filters: Filters = { status, client, stage, q, searchIn };
  const go = (next: Partial<Filters>) => push(localeHref(lang, correctionsHref(source, { ...filters, ...next })));
  const [query, setQuery] = useSearchBox(q, (next) => go({ q: next }));
  /** Statuses changed here since the page loaded, shown without waiting for a reload. */
  const [resolved, setResolved] = useState<Record<number, ContributionStatus>>({});
  const [busy, setBusy] = useState<number | null>(null);
  const [refusals, setRefusals] = useState<Record<number, string>>({});
  /** The wording each row is set against, where a moderator picked one other than the closest. */
  const [picked, setPicked] = useState<Record<number, number>>({});

  /** An "Accept all" run in flight, for its progress line and to hold every row's buttons still. */
  const [bulk, setBulk] = useState<{ done: number; total: number } | null>(null);
  /** What the last "Accept all" came to, until the next one starts. */
  const [bulkOutcome, setBulkOutcome] = useState<string | null>(null);
  /** "Accept all" asks twice: every row it accepts writes a line's or page's text. */
  const [confirmAll, setConfirmAll] = useState(false);

  // Accepting writes the player's text as the picked wording's, or beside them as another
  // (api/contributions/correction); rejecting and reopening are resolve's plain status flips.
  const send = useCallback(async (id: number, next: ContributionStatus, as?: Accept): Promise<boolean> => {
    const response = await fetch(
      next === "accepted" ? "/api/contributions/correction" : "/api/contributions/resolve",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id, status: next, ...as }),
      },
    ).catch(() => null);
    if (response?.ok) {
      setResolved((current) => ({ ...current, [id]: next }));
      setRefusals(({ [id]: _, ...rest }) => rest);
      return true;
    }
    const body = await response?.json().catch(() => null);
    const message = typeof body?.error === "string" ? body.error : "That didn't go through -- try again.";
    setRefusals((current) => ({ ...current, [id]: message }));
    return false;
  }, []);

  const resolve = useCallback(
    async (id: number, next: ContributionStatus, as?: Accept) => {
      setBusy(id);
      await send(id, next, as);
      setBusy(null);
    },
    [send],
  );

  /**
   * One accept after another, as each row's own button sends it: a refused row keeps its
   * refusal under it and the rest carry on. Not side by side, because two corrections can
   * name the same line and each writes its text.
   */
  const acceptAll = useCallback(
    async (ids: [number, Accept][]) => {
      setBulkOutcome(null);
      setBulk({ done: 0, total: ids.length });
      let refused = 0;
      for (const [index, [id, as]] of ids.entries()) {
        if (!(await send(id, "accepted", as))) refused++;
        setBulk({ done: index + 1, total: ids.length });
      }
      setBulk(null);
      setBulkOutcome(
        `Accepted ${ids.length - refused} of ${ids.length}` + (refused > 0 ? ` -- ${refused} refused.` : "."),
      );
    },
    [send],
  );

  /** The wording a row is set against, and its Accept fixes: the one picked, or the closest. */
  const chosenOf = (row: CorrectionRow): number => picked[row.id] ?? row.closest;
  const fixOf = (row: CorrectionRow): Accept => {
    const { lineId, variant } = row.wordings[chosenOf(row)];
    return { lineId, variant };
  };
  const toAccept = initial
    .filter((row) => (resolved[row.id] ?? row.status) === "new")
    .map((row): [number, Accept] => [row.id, fixOf(row)]);

  return (
    <>
      <StatusTabs
        active={status}
        onGo={push}
        hrefFor={(next) => localeHref(lang, correctionsHref(source, { ...filters, status: next }))}
      />
      <nav className="mb-4 flex flex-wrap items-center gap-2">
        <Input
          type="search"
          value={query}
          placeholder={source === "readables" ? "Either text…" : "NPC, quest, or either text…"}
          aria-label="Search"
          className="h-8 min-w-0 basis-64"
          onChange={(event) => setQuery(event.target.value)}
        />
        <FilterChip
          label="search in"
          value={searchIn === "any" ? undefined : searchIn}
          options={source === "readables" ? SEARCH_IN_OPTIONS.filter((option) => option.value === "text") : SEARCH_IN_OPTIONS}
          onChange={(next) => go({ searchIn: (next ?? "any") as Filter })}
        />
        {source === "quests" ? (
          <MultiFilterChip
            label="stage"
            values={stage}
            options={QUEST_STAGE_OPTIONS}
            onChange={(next) => go({ stage: (next ?? []) as StageFilter })}
          />
        ) : null}
        <span className="text-muted-foreground text-xs">
          {initial.length} {initial.length === 1 ? "correction" : "corrections"}
        </span>
        {pending && <Refreshing />}
        <ClientSelect value={client} onChange={(next) => go({ client: next })} />
      </nav>

      {status === "new" && initial.length > 0 ? (
        <div className="mb-3 flex flex-wrap items-center gap-2 text-xs">
          {bulk ? (
            <span className="text-muted-foreground">
              Accepted: {bulk.done} of {bulk.total}…
            </span>
          ) : confirmAll ? (
            <>
              <span>
                Accept all {toAccept.length} shown? Each writes the player&apos;s text as{" "}
                {source === "readables" ? "its page's words" : "what its line speaks"}.
              </span>
              <LiteButton
                variant="accept"
                onClick={() => {
                  setConfirmAll(false);
                  void acceptAll(toAccept);
                }}
              >
                Accept {toAccept.length}
              </LiteButton>
              <LiteButton variant="ghost" onClick={() => setConfirmAll(false)}>
                Cancel
              </LiteButton>
            </>
          ) : (
            <LiteButton variant="accept" disabled={toAccept.length === 0} onClick={() => setConfirmAll(true)}>
              Accept all ({toAccept.length})
            </LiteButton>
          )}
          {bulkOutcome && !bulk ? <span className="text-muted-foreground ml-2">{bulkOutcome}</span> : null}
        </div>
      ) : null}

      {initial.length === 0 ? (
        <p className="text-muted-foreground text-sm">Nothing here.</p>
      ) : (
        <table
          aria-busy={pending}
          className={cn("w-full border-separate border-spacing-0 text-sm transition-opacity", pending && "opacity-60")}
        >
          <thead className="text-muted-foreground text-left text-xs">
            <tr>
              <th className="border-b py-2 pr-3 font-normal">{source === "readables" ? "Book" : "Quest"}</th>
              <th className="border-b py-2 pr-3 font-normal">Client</th>
              <th className="border-b py-2 pr-3 font-normal">Count</th>
              <th className="w-[38%] border-b py-2 pr-3 font-normal">Corpus has</th>
              <th className="w-[38%] border-b py-2 pr-3 font-normal">Player saw</th>
              <th className="border-b py-2 font-normal" />
            </tr>
          </thead>
          <tbody>
            {initial.map((row) => {
              const current = resolved[row.id] ?? row.status;
              const chosen = chosenOf(row);
              const wording = row.wordings[chosen];
              const diff = wordDiff(wording.before, row.after);
              return (
                <tr
                  key={row.id}
                  id={`contribution-${row.id}`}
                  className={cn(
                    "align-top [&>td]:border-b [&>td]:py-2 [&>td]:leading-5",
                    current !== row.status && "opacity-50",
                  )}
                >
                  <td className="max-w-[14rem] pr-3 text-xs">
                    {row.quest ? (
                      <>
                        <span>{row.quest.title}</span>{" "}
                        <a
                          href={wowheadQuestUrl(row.quest.questId)}
                          target="_blank"
                          rel="noreferrer"
                          className="text-muted-foreground hover:underline"
                        >
                          #{row.quest.questId}
                        </a>
                        {row.quest.stage ? (
                          <div className="text-muted-foreground">{STAGE_LABELS[row.quest.stage]}</div>
                        ) : null}
                      </>
                    ) : (
                      (row.title ?? wording.lineId)
                    )}
                    {row.npc ? (
                      <div className="text-muted-foreground">
                        {row.npc.npcName ?? "unnamed"} #{row.npc.npcId}
                      </div>
                    ) : null}
                    <div className="text-muted-foreground mt-1">{when(row.createdAt)}</div>
                  </td>

                  <td className="pr-3 text-xs whitespace-nowrap">
                    <div>{row.client.label}</div>
                    <div className="text-muted-foreground">
                      {row.locale}
                      {row.client.buildNumber ? ` · ${row.client.buildNumber}` : null}
                    </div>
                  </td>

                  <td className="pr-3 text-xs whitespace-nowrap"><SendersButton id={row.id} count={row.count} /></td>

                  <td className="pr-3">
                    {row.wordings.length > 1 ? (
                      <ul className="space-y-2">
                        {row.wordings.map((line, index) => (
                          <li
                            key={`${line.lineId}|${line.variant}`}
                            className={cn("border-l-2 pl-2", index === chosen ? "border-red-500/60" : "border-transparent")}
                          >
                            {index === chosen ? (
                              <Marked parts={diff.before} tone="removed" />
                            ) : (
                              <button
                                type="button"
                                title="Set the player's text against this wording"
                                className="text-muted-foreground hover:text-foreground text-left whitespace-pre-wrap"
                                onClick={() => setPicked((all) => ({ ...all, [row.id]: index }))}
                              >
                                {line.before}
                              </button>
                            )}
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <Marked parts={diff.before} tone="removed" />
                    )}
                  </td>
                  <td className="pr-3">
                    <Marked parts={diff.after} tone="added" />
                    {row.body ? (
                      <div className="mt-2 rounded border p-2">
                        <p className="text-muted-foreground text-xs font-medium">What they said was wrong:</p>
                        <p className="mt-1 whitespace-pre-wrap">{row.body}</p>
                      </div>
                    ) : null}
                  </td>

                  <td>
                    <div className="flex items-center justify-end gap-1">
                      <Link
                        href={localeHref(lang, wording.editHref)}
                        className="border-border bg-background hover:bg-muted inline-flex h-7 items-center rounded-md border px-2.5 text-[0.8rem] font-medium whitespace-nowrap"
                      >
                        {source === "readables" ? "Edit page" : "Edit line"}
                      </Link>
                      {current === "new" ? (
                        <>
                          <LiteButton
                            variant="accept"
                            disabled={busy === row.id || bulk !== null}
                            title={source === "readables" ? "Take the player's text as this page's words" : "Take the player's text as what this line speaks"}
                            onClick={() => void resolve(row.id, "accepted", fixOf(row))}
                          >
                            Accept
                          </LiteButton>
                          {source === "quests" ? (
                            <LiteButton
                              variant="accept"
                              disabled={busy === row.id || bulk !== null}
                              title="Keep the corpus text and add the player's as another wording of this moment"
                              onClick={() => void resolve(row.id, "accepted", { as: "wording" })}
                            >
                              Accept as new line
                            </LiteButton>
                          ) : null}
                          <LiteButton
                            variant="reject"
                            disabled={busy === row.id || bulk !== null}
                            onClick={() => void resolve(row.id, "rejected")}
                          >
                            Reject
                          </LiteButton>
                        </>
                      ) : (
                        <LiteButton
                          variant="ghost"
                          disabled={busy === row.id || bulk !== null}
                          onClick={() => void resolve(row.id, "new")}
                        >
                          Reopen
                        </LiteButton>
                      )}
                    </div>
                    {refusals[row.id] ? (
                      <p className="text-destructive mt-1 text-right text-xs">{refusals[row.id]}</p>
                    ) : null}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </>
  );
}

/** One side of a correction, its differing words marked. */
export function Marked({ parts, tone }: { parts: DiffPart[]; tone: "removed" | "added" }) {
  return (
    <p className="whitespace-pre-wrap">
      {parts.map((part, index) =>
        part.changed ? (
          <mark
            key={index}
            className={cn(
              "rounded-sm px-0.5 text-inherit",
              tone === "removed"
                ? "bg-red-500/15 line-through decoration-red-500/60"
                : "bg-green-500/20",
            )}
          >
            {part.text}
          </mark>
        ) : (
          <span key={index}>{part.text}</span>
        ),
      )}
    </p>
  );
}
