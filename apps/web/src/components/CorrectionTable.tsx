"use client";

/**
 * The corrections tab: a quest line as the corpus has it, beside the text a player's client
 * showed for the same quest and moment, with the words that differ marked on each side.
 *
 * Both texts are shown open, not behind a `<details>` as the triage table's are: the
 * difference is the whole reason the row is here, and it is usually a word or two in a
 * paragraph -- the marks are what make it a glance rather than a read.
 *
 * Takes `CorrectionRow`, not the stored row, for the reason ContributionTable's docstring gives:
 * a client component's props are readable in the page's payload.
 */
import Link from "next/link";
import { useCallback, useState } from "react";

import { useLang } from "@/components/LangProvider";
import { CLIENT_CHIP_OPTIONS, SEARCH_IN_OPTIONS } from "@/components/contribution-chips";
import FilterChip, { type ChipOption } from "@/components/FilterChip";
import { LiteButton } from "@/components/LiteControls";
import { Refreshing } from "@/components/Loading";
import SendersButton from "@/components/SendersButton";
import StatusTabs from "@/components/StatusTabs";
import { Input } from "@/components/ui/input";
import { usePendingPush } from "@/components/usePendingPush";
import { useSearchBox } from "@/components/useSearchBox";
import type { ClientSummary } from "@/lib/contributions/client";
import { wordDiff, type DiffPart } from "@/lib/contributions/compare";
import type { ContributionStatus } from "@/lib/contributions/contributions";
import { QUEST_STAGES, type ClientFilter, type QuestStage, type StageFilter } from "@/lib/contributions/query";
import { localeHref } from "@/lib/lang";
import { explorerHref } from "@/lib/links";
import type { Filter } from "@/lib/search";
import { cn } from "@/lib/utils";
import { wowheadQuestUrl } from "@/lib/wowhead";

export type CorrectionRow = {
  id: number;
  /** The corpus line `before` is the text of. */
  lineId: string;
  /** Null only for stored meta naming no quest, which a correction always does. */
  quest: { title: string; questId: number; stage: QuestStage | null } | null;
  /** Who the player's client said speaks the line; null when the envelope named nobody. */
  npc: { npcId: number; npcName: string | null } | null;
  client: ClientSummary;
  locale: string;
  count: number;
  createdAt: string;
  status: ContributionStatus;
  /** The corpus's current text, its `$B` breaks already made line breaks. */
  before: string;
  /** What the player's client showed. */
  after: string;
  body: string | null;
};

const STAGE_LABELS: Record<QuestStage, string> = {
  accept: "Accept",
  progress: "Progress",
  complete: "Complete",
};

const STAGE_CHIP_OPTIONS: ChipOption[] = QUEST_STAGES.map((option) => ({ value: option, label: STAGE_LABELS[option] }));

type Filters = { status: ContributionStatus; client: ClientFilter; stage: StageFilter; q: string; searchIn: Filter };

function correctionsHref(filters: Filters): string {
  // Client always written, "all" included: left out, it means the Forever default.
  const params = new URLSearchParams({ status: filters.status, client: filters.client });
  if (filters.stage !== "all") params.set("stage", filters.stage);
  if (filters.q.trim()) params.set("q", filters.q.trim());
  if (filters.searchIn !== "any") params.set("filter", filters.searchIn);
  return `/contributions/corrections?${params}`;
}

function when(at: string): string {
  return new Date(at).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function CorrectionTable({
  initial,
  status,
  client,
  stage,
  q,
  searchIn,
}: {
  initial: CorrectionRow[];
  status: ContributionStatus;
  client: ClientFilter;
  stage: StageFilter;
  q: string;
  searchIn: Filter;
}) {
  const lang = useLang();
  const { pending, push } = usePendingPush();
  const filters: Filters = { status, client, stage, q, searchIn };
  const go = (next: Partial<Filters>) => push(localeHref(lang, correctionsHref({ ...filters, ...next })));
  const [query, setQuery] = useSearchBox(q, (next) => go({ q: next }));
  /** Statuses changed here since the page loaded, shown without waiting for a reload. */
  const [resolved, setResolved] = useState<Record<number, ContributionStatus>>({});
  const [busy, setBusy] = useState<number | null>(null);
  const [refusals, setRefusals] = useState<Record<number, string>>({});

  // Accepting writes the player's text as the line's (api/contributions/correction); rejecting
  // and reopening are resolve's plain status flips.
  const resolve = useCallback(async (id: number, next: ContributionStatus) => {
    setBusy(id);
    const response = await fetch(
      next === "accepted" ? "/api/contributions/correction" : "/api/contributions/resolve",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id, status: next }),
      },
    ).catch(() => null);
    if (response?.ok) {
      setResolved((current) => ({ ...current, [id]: next }));
      setRefusals(({ [id]: _, ...rest }) => rest);
    } else {
      const body = await response?.json().catch(() => null);
      const message = typeof body?.error === "string" ? body.error : "That didn't go through -- try again.";
      setRefusals((current) => ({ ...current, [id]: message }));
    }
    setBusy(null);
  }, []);

  return (
    <>
      <StatusTabs
        active={status}
        onGo={push}
        hrefFor={(next) => localeHref(lang, correctionsHref({ ...filters, status: next }))}
      />
      <nav className="mb-4 flex flex-wrap items-center gap-2">
        <Input
          type="search"
          value={query}
          placeholder="NPC, quest, or either text…"
          aria-label="Search"
          className="h-8 min-w-0 basis-64"
          onChange={(event) => setQuery(event.target.value)}
        />
        <FilterChip
          label="search in"
          value={searchIn === "any" ? undefined : searchIn}
          options={SEARCH_IN_OPTIONS}
          onChange={(next) => go({ searchIn: (next ?? "any") as Filter })}
        />
        <FilterChip
          label="client"
          value={client === "all" ? undefined : client}
          options={CLIENT_CHIP_OPTIONS}
          onChange={(next) => go({ client: (next ?? "all") as ClientFilter })}
        />
        <FilterChip
          label="stage"
          value={stage === "all" ? undefined : stage}
          options={STAGE_CHIP_OPTIONS}
          onChange={(next) => go({ stage: (next ?? "all") as StageFilter })}
        />
        <span className="text-muted-foreground text-xs">
          {initial.length} {initial.length === 1 ? "correction" : "corrections"}
        </span>
        {pending && <Refreshing />}
      </nav>

      {initial.length === 0 ? (
        <p className="text-muted-foreground text-sm">Nothing here.</p>
      ) : (
        <table
          aria-busy={pending}
          className={cn("w-full border-separate border-spacing-0 text-sm transition-opacity", pending && "opacity-60")}
        >
          <thead className="text-muted-foreground text-left text-xs">
            <tr>
              <th className="border-b py-2 pr-3 font-normal">Quest</th>
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
              const diff = wordDiff(row.before, row.after);
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
                      row.lineId
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
                    <Marked parts={diff.before} tone="removed" />
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
                        href={localeHref(lang, explorerHref("quests", row.lineId))}
                        className="border-border bg-background hover:bg-muted inline-flex h-7 items-center rounded-md border px-2.5 text-[0.8rem] font-medium whitespace-nowrap"
                      >
                        Edit line
                      </Link>
                      {current === "new" ? (
                        <>
                          <LiteButton
                            variant="accept"
                            disabled={busy === row.id}
                            title="Take the player's text as what this line speaks"
                            onClick={() => void resolve(row.id, "accepted")}
                          >
                            Accept
                          </LiteButton>
                          <LiteButton
                            variant="reject"
                            disabled={busy === row.id}
                            onClick={() => void resolve(row.id, "rejected")}
                          >
                            Reject
                          </LiteButton>
                        </>
                      ) : (
                        <LiteButton
                          variant="ghost"
                          disabled={busy === row.id}
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
function Marked({ parts, tone }: { parts: DiffPart[]; tone: "removed" | "added" }) {
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
