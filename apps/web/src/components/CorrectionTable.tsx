"use client";

/**
 * Keep both wordings visible so reviewers can compare them before replacing one. Pass only fields
 * reviewers may see, because client props are visible in the page payload.
 */
import Link from "next/link";
import { useCallback, useRef, useState } from "react";

import { useLang } from "@/components/LangProvider";
import { useUiText } from "@/components/UiTextProvider";
import { fill } from "@/lib/site-text/format";
import { STAGE_LABELS } from "@/components/contribution-chips";
import SendersButton from "@/components/SendersButton";
import { useLocalDates } from "@/components/useLocalDates";
import type { ClientSummary } from "@/lib/contributions/client";
import { genderSplit, hasClassSlot, readerSide, wordDiff, type DiffPart } from "@/lib/contributions/compare";
import type { ContributionStatus } from "@/lib/contributions/contributions";
import { otherGender, readingWord, sexWord, type ReaderGender } from "@/lib/contributions/gender";
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
  /** One side of a moment already split by player gender. */
  split: boolean;
  /** The player genders whose client has shown this text word for word (lib/contributions/readers.ts). */
  readBy: ReaderGender[];
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
  /** The gender of the character it was shown to, where the addon said: the side of every `$G` it took. */
  readerGender: ReaderGender | null;
  body: string | null;
  rejectReason: string | null;
};

/**
 * What an accept sends beside the id: the wording it fixes, and the player gender the player's
 * text is for where it splits that wording instead; or that it is another wording. With the
 * moderator's edit of the player's text where there is one, and the player tokens they confirmed
 * our line has wrongly (`drops`).
 */
type Accept = ({ lineId: string; variant: number; split?: ReaderGender } | { as: "wording" }) & {
  text?: string;
  drops?: string[];
};
type Extra = Accept | { reason: string };

/** Why a row's request was refused, and the accept to send again without the player tokens it would lose. */
type Refusal = { message: string; retry?: { accept: Accept; drops: string[] } };

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
  const t = useUiText();
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
  /** The row whose Keep both choices are open. */
  const [keepingId, setKeepingId] = useState<number | null>(null);
  const [reasonsOf, setReasonsOf] = useState<Record<number, string>>({});
  /** A long backlog renders a page at a time: every row diffs both texts. */
  const [limit, setLimit] = useState(CORRECTIONS_SHOWN);
  const [refusals, setRefusals] = useState<Record<number, Refusal>>({});
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
    const drops = Array.isArray(body?.dropped) ? body.dropped : [];
    const retry = drops.length > 0 ? { accept: payload as Accept, drops } : undefined;
    setRefusals((current) => ({ ...current, [id]: { message, retry } }));
    return null;
  }, []);

  /** A refusal's retry is for the accept it answered, so a new pick or edit takes it away, its reason kept. */
  const forgetRetry = (id: number) =>
    setRefusals((all) => (all[id]?.retry ? { ...all, [id]: { message: all[id].message } } : all));

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
      if (ok && next === "accepted") {
        setDroppingId((open) => (open === id ? null : open));
        setKeepingId((open) => (open === id ? null : open));
      }
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
  /**
   * The template a split by gender writes, theirs on either side, for the buttons and their
   * previews; null where our line is not one plain quest line the two texts can split. The server
   * builds its own from the line as it then stands.
   */
  const splitsOf = (wording: CorrectionWording, after: string): Record<ReaderGender, string> | null => {
    if (source !== "quests" || wording.split) return null;
    const f = genderSplit(wording.before, after, "f");
    return f ? { f, m: genderSplit(wording.before, after, "m")! } : null;
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
        const splits = current === "new" ? splitsOf(wording, after) : null;
        // Offered outright where the evidence says which side theirs is.
        const side = splits && readerSide(row.readerGender, wording.readBy);
        const chooser = keepingId === row.id ? splits : null;
        const keepAsWording = () => void resolve(row.id, "accepted", { as: "wording", ...editOf(row) });
        const splitAs = (theirsFor: ReaderGender) =>
          void resolve(row.id, "accepted", { lineId: wording.lineId, variant: wording.variant, split: theirsFor, ...editOf(row) });
        const refusal = refusals[row.id];
        const retry = refusal?.retry;
        return (
          <div key={row.id} id={`contribution-${row.id}`} className="bs-review-row" data-moved={current !== row.status ? "" : undefined}>
            <div className="bs-who">
              {row.npc ? <div className="bs-who-name">{row.npc.npcName ?? "unnamed"}</div> : null}
              {row.quest ? (
                <span className="bs-who-sub">
                  {row.quest.title}{" "}
                  <a href={wowheadQuestUrl(lang, row.quest.questId)} target="_blank" rel="noreferrer" className="hover:underline">
                    #{row.quest.questId}
                  </a>
                  {row.quest.stage ? ` · ${STAGE_LABELS[row.quest.stage]}` : null}
                </span>
              ) : (
                <span className="bs-who-sub">{row.title ?? wording.lineId}</span>
              )}
            </div>

            <div className="min-w-0">
              <p className="bs-label">{row.wordings.length > 1 ? t.corrections.pickWording : t.corrections.oursNow}</p>
              {row.wordings.length > 1 ? (
                <ul className="flex flex-col gap-2">
                  {row.wordings.map((line, index) => (
                    <li key={`${line.lineId}|${line.variant}`}>
                      {index === chosen ? (
                        <Marked parts={diff.before} tone="removed" />
                      ) : (
                        <button
                          type="button"
                          title={t.corrections.setAgainst}
                          className="text-muted-foreground hover:text-foreground text-left whitespace-pre-wrap"
                          onClick={() => {
                            forgetRetry(row.id);
                            setPicked((all) => ({ ...all, [row.id]: index }));
                          }}
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
              <p className="bs-label">{t.corrections.theirs}</p>
              {editing ? (
                <textarea
                  className="bs-textarea"
                  value={after}
                  aria-label={t.corrections.playerText}
                  rows={Math.max(3, after.split("\n").length + 1)}
                  onChange={(event) => {
                    forgetRetry(row.id);
                    setDrafts((all) => ({ ...all, [row.id]: event.target.value }));
                  }}
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
                      ? t.corrections.stopPuttingBack
                      : t.corrections.putWordBack
                  }
                  className="text-muted-foreground hover:text-foreground mt-1 text-xs underline-offset-2 hover:underline"
                  onClick={() => row.quest && void markClassWord(row.id, row.quest.questId, !classWord)}
                >
                  {classWord ? t.corrections.classWordKept : t.corrections.classWordOwn}
                </button>
              ) : null}
              {current === "rejected" ? (
                <ul className="bs-findings">
                  <li className="bs-finding bs-finding-drop">
                    {(reasonsOf[row.id] ?? row.rejectReason) ? fill(t.corrections.rejected, { reason: reasonsOf[row.id] ?? row.rejectReason ?? "" }) : t.corrections.rejectedNoReason}
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
                    title={source === "readables" ? t.corrections.takeAsPage : t.corrections.takeAsText}
                    onClick={() => void resolve(row.id, "accepted", fixOf(row))}
                  >
                    {t.corrections.replaceOurs}
                  </button>
                  {splits && side ? (
                    <button
                      type="button"
                      className="bs-btn"
                      disabled={hold}
                      title={fill(t.corrections.splitTitle, { ours: sexWord(t, otherGender(side)), theirs: sexWord(t, side), text: splits[side] })}
                      onClick={() => splitAs(side)}
                    >
                      {t.corrections.splitByGender}
                    </button>
                  ) : null}
                  {source === "quests" ? (
                    <button
                      type="button"
                      className="bs-btn"
                      disabled={hold}
                      title={
                        splits
                          ? t.corrections.addBeside
                          : t.corrections.addAsWording
                      }
                      onClick={() => (splits ? setKeepingId(chooser ? null : row.id) : keepAsWording())}
                    >
                      {splits ? t.corrections.keepBothMore : t.corrections.keepBoth}
                    </button>
                  ) : null}
                  <button
                    type="button"
                    className="bs-btn bs-btn-text"
                    disabled={hold}
                    onClick={() => {
                      forgetRetry(row.id);
                      setDrafts(({ [row.id]: open, ...rest }) => (open === undefined ? { ...rest, [row.id]: savedOf(row) } : rest));
                    }}
                  >
                    {editing ? t.corrections.cancelEdit : t.corrections.editText}
                  </button>
                  <button type="button" className="bs-btn bs-btn-text" disabled={hold} onClick={() => setDroppingId(dropping ? null : row.id)}>
                    {t.contributions.dropEllipsis}
                  </button>
                </>
              ) : (
                <button type="button" className="bs-btn bs-btn-text" disabled={hold} onClick={() => void resolve(row.id, "new")}>
                  {t.contributions.reopen}
                </button>
              )}
              {refusal ? <p className="bs-refusal">{refusal.message}</p> : null}
              {retry && current === "new" ? (
                <button
                  type="button"
                  className="bs-btn"
                  disabled={hold}
                  title={fill(t.corrections.acceptWithoutHow, { tokens: retry.drops.join(", ") })}
                  onClick={() =>
                    // The text as it now stands: typing, or a class word put back, may have changed it since.
                    void resolve(row.id, "accepted", { ...retry.accept, text: undefined, ...editOf(row), drops: retry.drops })
                  }
                >
                  {fill(t.corrections.acceptWithout, { tokens: retry.drops.join(", ") })}
                </button>
              ) : null}
            </div>

            <div className="bs-meta">
              <span>
                {row.client.label} · {row.locale}
                {row.client.buildNumber ? ` · ${row.client.buildNumber}` : null}
              </span>
              {row.readerGender ? <span>{fill(t.corrections.theirsReadBy, { gender: sexWord(t, row.readerGender) })}</span> : null}
              {wording.readBy.length ? <span>{fill(t.corrections.oursReadBy, { who: readingWord(t, wording.readBy) })}</span> : null}
              <span className="inline-flex items-center gap-1">
                {t.contributions.sentBy} <SendersButton id={row.id} count={row.count} />
              </span>
              <span>{fill(t.contributions.filed, { when: when(row.createdAt) })}</span>
              <Link href={localeHref(lang, wording.editHref)} className="underline underline-offset-[3px]">
                {source === "readables" ? t.corrections.openPage : t.corrections.openLine}
              </Link>
            </div>
            {row.body ? (
              <div className="bs-aside">
                <p className="bs-label">{t.corrections.saidWrong}</p>
                <p className="bs-text">{row.body}</p>
              </div>
            ) : null}
            {chooser ? (
              <div className="bs-reasons bs-choices">
                <p>{t.corrections.keepBothHow}</p>
                <button type="button" className="bs-reason" disabled={hold} onClick={keepAsWording}>
                  {t.corrections.asAnotherWording}
                </button>
                {(row.readerGender === "m" ? (["m", "f"] as const) : (["f", "m"] as const)).map((side) => (
                  <button
                    key={side}
                    type="button"
                    className="bs-reason"
                    disabled={hold}
                    title={chooser[side]}
                    onClick={() => splitAs(side)}
                  >
                    {fill(row.readerGender === side ? t.corrections.theirsForReader : t.corrections.theirsFor, { gender: sexWord(t, side) })}
                  </button>
                ))}
                <button type="button" className="bs-btn bs-btn-text" onClick={() => setKeepingId(null)}>
                  {t.common.cancel}
                </button>
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
            {fill(t.corrections.showMore, {
              n: Math.min(CORRECTIONS_SHOWN, initial.length - limit),
              m: initial.length - limit,
            })}
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
