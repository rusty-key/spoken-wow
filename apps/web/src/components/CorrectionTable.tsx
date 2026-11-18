"use client";

/**
 * Keep both wordings visible so reviewers can compare them before replacing one. Pass only fields
 * reviewers may see, because client props are visible in the page payload.
 */
import Link from "next/link";
import { useCallback, useRef, useState } from "react";

import { useLang } from "@/components/LangProvider";
import { STAGE_LABELS } from "@/components/contribution-chips";
import SendersButton from "@/components/SendersButton";
import { useLocalDates } from "@/components/useLocalDates";
import type { ClientSummary } from "@/lib/contributions/client";
import { hasClassSlot, wordDiff, type DiffPart } from "@/lib/contributions/compare";
import type { ContributionStatus } from "@/lib/contributions/contributions";
import type { QuestStage } from "@/lib/contributions/query";
import { langName, localeHref } from "@/lib/lang";
import { cn } from "@/lib/utils";
import DropReasons from "@/components/backstage/DropReasons";
import { correctionDropReasons } from "@/lib/contributions/reasons";
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
  /**
   * Null for a book page, and for stored meta naming no quest, which a quest correction always
   * does. `classWord`: the quest names a class as a word of its own (lib/contributions/class-words.ts).
   */
  quest: { title: string; questId: number; stage: QuestStage | null; classWord: boolean } | null;
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
  rejectReason: string | null;
};

/**
 * What an accept sends beside the id: the wording it fixes, or that it is another wording, and
 * the moderator's edit of the player's text where there is one.
 */
type Accept = ({ lineId: string; variant: number } | { as: "wording" }) & { text?: string };
type Extra = Accept | { reason: string };

export type CorrectionSource = "quests" | "readables";

/** How many corrections render at first, and how many more each "Show more" adds. */
const CORRECTIONS_SHOWN = 25;

export default function CorrectionTable({
  source,
  initial,
}: {
  source: CorrectionSource;
  /** The rows the contributions page's own tabs and filters picked. */
  initial: CorrectionRow[];
}) {
  const when = useLocalDates();
  const lang = useLang();
  /**
   * Statuses changed here, with the server's status they were changed from: once a refresh brings
   * another status for the row (another tab reopened it), the server's wins.
   */
  const [resolved, setResolved] = useState<Record<number, { next: ContributionStatus; from: ContributionStatus }>>({});
  /** Rows with a request in flight: each stays locked until its own request answers. */
  const [busy, setBusy] = useState<ReadonlySet<number>>(new Set());
  const inFlight = useRef(new Set<number>());
  const [droppingId, setDroppingId] = useState<number | null>(null);
  const [reasonsOf, setReasonsOf] = useState<Record<number, string>>({});
  /** A long backlog renders a page at a time: every row diffs both texts. */
  const [limit, setLimit] = useState(CORRECTIONS_SHOWN);
  const [refusals, setRefusals] = useState<Record<number, string>>({});
  /** The wording each row is set against, where a moderator picked one other than the closest. */
  const [picked, setPicked] = useState<Record<number, number>>({});
  /** Player texts changed on the server since the page loaded: edited, or a class word put back. */
  const [texts, setTexts] = useState<Record<number, string>>({});
  /** Rows whose player text is open for editing, with the text as typed so far. */
  const [drafts, setDrafts] = useState<Record<number, string>>({});
  /** Quests marked or unmarked here since the page loaded. */
  const [classWords, setClassWords] = useState<Record<number, boolean>>({});

  /** A row's POST: its answer's body, or null with the refusal shown under the row. */
  const post = useCallback(async (url: string, id: number, payload: object): Promise<Record<string, unknown> | null> => {
    const response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id, ...payload }),
    }).catch(() => null);
    const body = await response?.json().catch(() => null);
    if (response?.ok) {
      setRefusals(({ [id]: _, ...rest }) => rest);
      return body ?? {};
    }
    const message = typeof body?.error === "string" ? body.error : "That didn't go through -- try again.";
    setRefusals((current) => ({ ...current, [id]: message }));
    return null;
  }, []);

  // Accepting writes the player's text as the picked wording's, or beside them as another
  // (api/contributions/correction); rejecting and reopening are resolve's plain status flips.
  const send = useCallback(
    async (id: number, next: ContributionStatus, as?: Extra): Promise<boolean> => {
      const url = next === "accepted" ? "/api/contributions/correction" : "/api/contributions/resolve";
      const body = await post(url, id, { status: next, ...as });
      if (!body) return false;
      const from = initial.find((row) => row.id === id)?.status ?? "new";
      setResolved((current) => ({ ...current, [id]: { next, from } }));
      // The text as the server saved it, normalised, rather than as typed.
      const saved = (body.contribution as { text?: unknown } | undefined)?.text;
      if (as && "text" in as && as.text !== undefined && typeof saved === "string") setTexts((current) => ({ ...current, [id]: saved }));
      setDrafts(({ [id]: _, ...rest }) => rest);
      return true;
    },
    [post, initial],
  );

  /** Runs `work` for a row unless one of its requests is already in flight. */
  const held = useCallback(async <T,>(id: number, work: () => Promise<T>): Promise<T | undefined> => {
    if (inFlight.current.has(id)) return undefined;
    inFlight.current.add(id);
    setBusy(new Set(inFlight.current));
    try {
      return await work();
    } finally {
      inFlight.current.delete(id);
      setBusy(new Set(inFlight.current));
    }
  }, []);

  const resolve = useCallback(
    async (id: number, next: ContributionStatus, as?: Extra): Promise<boolean> => {
      const ok = (await held(id, () => send(id, next, as))) ?? false;
      if (ok && next === "accepted") setDroppingId((open) => (open === id ? null : open));
      return ok;
    },
    [send, held],
  );

  const markClassWord = useCallback(
    async (id: number, questId: number, kept: boolean) => {
      await held(id, async () => {
        const body = await post("/api/contributions/class-word", id, { kept });
        if (!body) return;
        const rewritten = body.texts as Record<number, string>;
        setClassWords((current) => ({ ...current, [questId]: kept }));
        setTexts((current) => ({ ...current, ...rewritten }));
        // An open edit of a rewritten row holds the slot just put back, and Accept would send it.
        setDrafts((current) => Object.fromEntries(Object.entries(current).filter(([open]) => !(open in rewritten))));
      });
    },
    [post, held],
  );

  /** The player's text as it now stands, or as typed where the row is open for editing. */
  const savedOf = (row: CorrectionRow): string => texts[row.id] ?? row.after;
  const afterOf = (row: CorrectionRow): string => drafts[row.id] ?? savedOf(row);
  /** The edit an accept sends, where the text was edited and differs from what is saved. */
  const editOf = (row: CorrectionRow): { text?: string } =>
    drafts[row.id] !== undefined && drafts[row.id] !== savedOf(row) ? { text: drafts[row.id] } : {};
  const classWordOf = (row: CorrectionRow): boolean =>
    row.quest ? (classWords[row.quest.questId] ?? row.quest.classWord) : false;

  /** The wording a row is set against, and its Accept fixes: the one picked, or the closest. */
  const chosenOf = (row: CorrectionRow): number => picked[row.id] ?? row.closest;
  const fixOf = (row: CorrectionRow): Accept => {
    const { lineId, variant } = row.wordings[chosenOf(row)];
    return { lineId, variant, ...editOf(row) };
  };
  return (
    <div className="bs-rows">
      {initial.slice(0, limit).map((row) => {
        const change = resolved[row.id];
        const current = change && change.from === row.status ? change.next : row.status;
        const chosen = chosenOf(row);
        const wording = row.wordings[chosen];
        const after = afterOf(row);
        const diff = wordDiff(wording.before, after);
        const editing = drafts[row.id] !== undefined;
        const classWord = classWordOf(row);
        const hold = busy.has(row.id);
        const dropping = droppingId === row.id && current === "new";
        return (
          <div key={row.id} id={`contribution-${row.id}`} className="bs-review-row" data-moved={current !== row.status ? "" : undefined}>
            <div className="bs-who">
              {row.npc ? <div className="bs-who-name">{row.npc.npcName ?? "unnamed"}</div> : null}
              {row.quest ? (
                <span className="bs-who-sub">
                  {row.quest.title}{" "}
                  <a href={wowheadQuestUrl(row.quest.questId)} target="_blank" rel="noreferrer" className="hover:underline">
                    #{row.quest.questId}
                  </a>
                  {row.quest.stage ? ` · ${STAGE_LABELS[row.quest.stage]}` : null}
                </span>
              ) : (
                <span className="bs-who-sub">{row.title ?? wording.lineId}</span>
              )}
            </div>

            <div className="min-w-0">
              <p className="bs-label">{row.wordings.length > 1 ? "Ours now · pick the wording it changes" : "Ours now"}</p>
              {row.wordings.length > 1 ? (
                <ul className="flex flex-col gap-2">
                  {row.wordings.map((line, index) => (
                    <li key={`${line.lineId}|${line.variant}`}>
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
                <div className="bs-text-en">
                  <Marked parts={diff.before} tone="removed" />
                </div>
              )}
            </div>

            <div className="min-w-0">
              <p className="bs-label">Theirs</p>
              {editing ? (
                <textarea
                  className="bs-textarea"
                  value={after}
                  aria-label="The player's text"
                  rows={Math.max(3, after.split("\n").length + 1)}
                  onChange={(event) => setDrafts((all) => ({ ...all, [row.id]: event.target.value }))}
                />
              ) : (
                <Marked parts={diff.after} tone="added" />
              )}
              {row.quest && current === "new" && (classWord || hasClassSlot(after)) ? (
                <button
                  type="button"
                  disabled={hold}
                  title={
                    classWord
                      ? "Stop putting this quest's class word back in contributions"
                      : "This quest names a class as a word of its own, not the reader's class: put the word back in this quest's waiting and future contributions"
                  }
                  className="text-muted-foreground hover:text-foreground mt-1 text-xs underline-offset-2 hover:underline"
                  onClick={() => row.quest && void markClassWord(row.id, row.quest.questId, !classWord)}
                >
                  {classWord ? "Class word kept for this quest · undo" : "$c is this quest's own word"}
                </button>
              ) : null}
              {current === "rejected" ? (
                <ul className="bs-findings">
                  <li className="bs-finding bs-finding-drop">
                    {(reasonsOf[row.id] ?? row.rejectReason) ? `Rejected: ${reasonsOf[row.id] ?? row.rejectReason}` : "Rejected, no reason given."}
                  </li>
                </ul>
              ) : null}
            </div>

            <div className="bs-actions">
              {current === "new" ? (
                <>
                  <button
                    type="button"
                    className="bs-btn"
                    disabled={hold}
                    title={source === "readables" ? "Take the player's text as this page's words" : "Take the player's text as what this line speaks"}
                    onClick={() => void resolve(row.id, "accepted", fixOf(row))}
                  >
                    Replace ours
                  </button>
                  {source === "quests" ? (
                    <button
                      type="button"
                      className="bs-btn"
                      disabled={hold}
                      title="Keep our text and add the player's as another wording of this moment"
                      onClick={() => void resolve(row.id, "accepted", { as: "wording", ...editOf(row) })}
                    >
                      Keep both
                    </button>
                  ) : null}
                  <button
                    type="button"
                    className="bs-btn bs-btn-text"
                    disabled={hold}
                    onClick={() =>
                      setDrafts(({ [row.id]: open, ...rest }) => (open === undefined ? { ...rest, [row.id]: savedOf(row) } : rest))
                    }
                  >
                    {editing ? "Cancel edit" : "Edit text"}
                  </button>
                  <button type="button" className="bs-btn bs-btn-text" disabled={hold} onClick={() => setDroppingId(dropping ? null : row.id)}>
                    Drop…
                  </button>
                </>
              ) : (
                <button type="button" className="bs-btn bs-btn-text" disabled={hold} onClick={() => void resolve(row.id, "new")}>
                  Reopen
                </button>
              )}
              {refusals[row.id] ? <p className="bs-refusal">{refusals[row.id]}</p> : null}
            </div>

            <div className="bs-meta">
              <span>
                {row.client.label} · {row.locale}
                {row.client.buildNumber ? ` · ${row.client.buildNumber}` : null}
              </span>
              <span className="inline-flex items-center gap-1">
                Sent by <SendersButton id={row.id} count={row.count} />
              </span>
              <span>Filed {when(row.createdAt)}</span>
              <Link href={localeHref(lang, wording.editHref)} className="underline underline-offset-[3px]">
                {source === "readables" ? "Open the page" : "Open the line"}
              </Link>
            </div>
            {row.body ? (
              <div className="bs-aside">
                <p className="bs-label">What the player said was wrong</p>
                <p className="bs-text">{row.body}</p>
              </div>
            ) : null}
            {dropping ? (
              <DropReasons
                reasons={correctionDropReasons(langName(lang))}
                disabled={hold}
                onPick={(why) => {
                  void resolve(row.id, "rejected", { reason: why }).then((ok) => {
                    if (!ok) return;
                    setDroppingId(null);
                    setReasonsOf((all) => ({ ...all, [row.id]: why }));
                  });
                }}
                onCancel={() => setDroppingId(null)}
              />
            ) : null}
          </div>
        );
      })}
      {initial.length > limit ? (
        <div className="px-4 py-3">
          <button type="button" className="bs-btn bs-btn-text" onClick={() => setLimit((shown) => shown + CORRECTIONS_SHOWN)}>
            Show {Math.min(CORRECTIONS_SHOWN, initial.length - limit)} more of {initial.length - limit}
          </button>
        </div>
      ) : null}
    </div>
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
