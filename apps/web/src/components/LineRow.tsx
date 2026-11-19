"use client";

import ActorTakeCell from "@/components/ActorTakeCell";
import { MadeByCell } from "@/components/MadeBy";
import OverrideDrift from "@/components/OverrideDrift";
import { RenameButton } from "@/components/RenameButton";
import { Untranslated, UntranslatedMark } from "@/components/Untranslated";
import FilterLink from "@/components/FilterLink";
import { useLang } from "@/components/LangProvider";
import { localeHref } from "@/lib/lang";
import { RowActions, StateWord, type RowAction } from "@/components/catalogue/RowParts";
import { ChevronDownIcon, MessageSquareIcon, MessageSquareQuoteIcon, PlayIcon } from "lucide-react";
import { useState } from "react";

import ReportsBadge from "./ReportsBadge";
import TakeSelector from "./TakeSelector";
import { targetForLine } from "@/lib/reports/line-target";
import { cn, endsSelection } from "@/lib/utils";
import type { LineState } from "./Explorer";
import type { ResultLine } from "@/lib/search";
import WowheadLink from "@/components/WowheadLink";
import { npcPageHref } from "@/lib/links";
import { wowheadEntityUrl, wowheadQuestUrl } from "@/lib/wowhead";

/**
 * Why a line has no audio, or null when it does.
 *
 * Reads `voiceable` rather than the corpus's `generatable`, because an override can rescue a
 * line the extractor gave up on: once the stage direction is gone, its absence is a gap like
 * any other rather than an expected skip.
 */
function absence(line: ResultLine): { kind: "gap" | "skip"; label: string } | null {
  if (line.hasAudio) return null;
  // An unvoiceable line is an expected absence, not a gap: text with unresolved $ / <> tokens
  // would be read aloud verbatim, and an untranslated line has nothing to voice.
  if (!line.voiceable) {
    return { kind: "skip", label: line.skipReason ?? "not voiced" };
  }
  return { kind: "gap", label: "no audio" };
}

/**
 * The game's own quest markers, because the reader already knows them: yellow "!" over an
 * NPC means a quest to take, yellow "?" one to hand in. Progress keeps the family with a
 * minus - nothing to do here yet - and gossip, which the game marks with no overhead icon
 * at all, gets a grey speech bubble instead of a fourth punctuation mark nobody would read.
 */
const QUEST_MARKS: Record<string, { glyph: string; label: string }> = {
  accept: { glyph: "!", label: "quest offered" },
  complete: { glyph: "?", label: "quest turn-in" },
  progress: { glyph: "−", label: "quest in progress" },
};

/**
 * What a follow-up line is, in words, for the mark's tooltip and the quest column.
 *
 * "Accepted or turned in" rather than whichever one it was: the corpus row keeps the quest
 * but not which of its two scripts says the line, and one line can be said by both. The
 * addon's FollowupLines.lua still has start/end, so a row could say which if that ever
 * reaches the corpus.
 */
const FOLLOWUP_LABEL = "said in chat after the quest is accepted or turned in";
const CHATTER_LABEL = "said in chat in the world, with no quest behind it";

function SourceMark({ source }: { source: string }) {
  // Gossip's bubble, because this is an NPC talking rather than a quest dialog, but in the
  // quest marks' amber: it only happens because of a quest, and the row names which.
  if (source === "followup") {
    return (
      <span
        title={FOLLOWUP_LABEL}
        aria-label="follow-up"
        className="mt-1 flex w-3.5 shrink-0 justify-center"
      >
        <MessageSquareQuoteIcon className="size-3.5 text-amber-400" />
      </span>
    );
  }

  if (source === "chatter") {
    return (
      <span title={CHATTER_LABEL} aria-label="NPC chat" className="mt-1 flex w-3.5 shrink-0 justify-center">
        <MessageSquareQuoteIcon className="size-3.5 text-zinc-400" />
      </span>
    );
  }

  if (source === "gossip") {
    return (
      <span title="gossip" aria-label="gossip" className="mt-1 flex w-3.5 shrink-0 justify-center">
        <MessageSquareIcon className="size-3.5 text-zinc-400" />
      </span>
    );
  }

  const mark = QUEST_MARKS[source];
  if (!mark) return null;

  return (
    <span
      title={mark.label}
      aria-label={source}
      className="mt-px w-3.5 shrink-0 text-center text-sm leading-5 font-bold text-amber-400"
    >
      {mark.glyph}
    </span>
  );
}

type Props = {
  line: ResultLine;
  current: boolean;
  /** Whether to draw the "Made by" cell: the search sent it, so the viewer works here. */
  showMadeBy: boolean;
  /** Whether to draw the voice actor cell: the search sent recordings, so the viewer records here. */
  showRecordings: boolean;
  onRecordingChanged: (line: ResultLine) => void;
  canRegenerate: boolean;
  /** Editor and up: may read the report bodies and resolve them from the row. */
  canTriage: boolean;
  onOverrideAnswered: (line: ResultLine) => void;
  state?: LineState;
  blocked: string | null;
  /** How many takes this line's file has. Zero means nothing has been cut yet. */
  takes: number;
  /** Which take is live, for the Audio column. Null where nothing has been cut. */
  version: number | null;
  /** The live audio was made from text that has since changed. */
  stale: boolean;
  /**
   * The live audio was cut before a pronunciation it speaks was changed, and nobody has
   * said since that it is fine. Independent of `stale`: a lexicon edit moves no text.
   */
  dirty: boolean;
  onPlay: (line: ResultLine) => void;
  onEditText: (line: ResultLine) => void;
  /**
   * Name the speaker or the quest in the page's language. Null on the English site, where
   * names come from the corpus, and for somebody who may not edit.
   */
  onRename: ((line: ResultLine, what: "npc" | "quest") => void) | null;
  /** Open the ignore dialog, or null for anyone not allowed to make that decision. */
  onIgnore: ((line: ResultLine) => void) | null;
  /** Add another NPC who says this line, put one in this speaker's place, or take it off. Null but for an admin. */
  onAddSpeaker: ((line: ResultLine) => void) | null;
  onReplaceSpeaker: ((line: ResultLine) => void) | null;
  onRemoveSpeaker: ((line: ResultLine) => void) | null;
  onRegenerate: (line: ResultLine) => void;
  /** Null in another team's view because reports go to the acting team. Otherwise everyone, signed in or not. */
  onReport: ((line: ResultLine) => void) | null;
  onRestored: (file: string, version: number) => void;
  /** Narrow the search to this line's quest; the href opens that view elsewhere. */
  onNarrowToQuest: (line: ResultLine) => void;
  questHref: (line: ResultLine) => string;
  /** Say this take is fine as it stands, despite a pronunciation having moved under it. */
  onClearDirty: (line: ResultLine) => void;
};

/** A line's kind in words, under its quest, where the old table drew a glyph only. */
const SOURCE_WORDS: Record<string, string> = {
  accept: "accept",
  progress: "progress",
  complete: "complete",
  gossip: "gossip",
  followup: "after the quest",
  chatter: "NPC chat",
};

/**
 * The heading over one NPC's lines: who speaks, in which voice, and the ways to that NPC. The
 * results come sorted by speaker, so this replaces a name and three id lines repeated per row.
 */
export function SpeakerHeader({
  line,
  columns,
  onRename,
  showNpcPage,
  onNarrowToNpc,
  npcHref,
}: {
  line: ResultLine;
  columns: number;
  onRename: ((line: ResultLine, what: "npc" | "quest") => void) | null;
  /** Whether the NPC's id links to its row on /npcs, which only an admin can open. */
  showNpcPage: boolean;
  onNarrowToNpc: (line: ResultLine) => void;
  npcHref: (line: ResultLine) => string;
}) {
  const lang = useLang();
  return (
    <tr className="cat-group">
      <th colSpan={columns} scope="colgroup">
        <FilterLink
          href={npcHref(line)}
          onApply={() => onNarrowToNpc(line)}
          className="cat-group-name"
          title={`Show only ${line.npcName}`}
        >
          <Untranslated missing={line.missing?.npcName}>{line.npcName}</Untranslated>
        </FilterLink>
        {onRename && <RenameButton label={`Name ${line.npcName}`} onClick={() => onRename(line, "npc")} />}
        {/* The voice slot is spelled race-gender-flavor: it says whose voice reads these lines. */}
        <span className="cat-group-meta">
          {[line.race, line.gender, line.flavor].filter(Boolean).join(" · ")}
          {" · "}
          {line.npcType} {line.npcId} <WowheadLink href={wowheadEntityUrl(line.npcType, line.npcId)} />
          {showNpcPage && (
            <>
              {" "}
              <a href={localeHref(lang, npcPageHref(line.npcId))} title="Open this NPC on the NPCs page" className="underline underline-offset-2">
                npc
              </a>
            </>
          )}
          {line.added && <span title="Added by hand, not from the game data"> · added</span>}
        </span>
      </th>
    </tr>
  );
}

/** Whether `line` starts a new speaker after `previous`, so a SpeakerHeader goes above it. */
export function newSpeaker(line: ResultLine, previous: ResultLine | undefined): boolean {
  return !previous || previous.npcType !== line.npcType || previous.npcId !== line.npcId || previous.voice !== line.voice;
}

export default function LineRow({
  line,
  current,
  showMadeBy,
  showRecordings,
  onRecordingChanged,
  canRegenerate,
  canTriage,
  onOverrideAnswered,
  state,
  blocked,
  takes,
  version,
  stale,
  dirty,
  onPlay,
  onEditText,
  onRename,
  onIgnore,
  onAddSpeaker,
  onReplaceSpeaker,
  onRemoveSpeaker,
  onRegenerate,
  onReport,
  onRestored,
  onNarrowToQuest,
  questHref,
  onClearDirty,
}: Props) {
  const missing = absence(line);
  const [expanded, setExpanded] = useState(false);
  const lang = useLang();
  const subject = `${line.npcName}'s line`;

  /**
   * Clicking the row shows the whole line, but only when the click meant that: a click on a
   * control is that control's, and a click that ends a drag over the text is someone copying it.
   */
  function toggleFromRow(event: React.MouseEvent<HTMLTableRowElement>) {
    const target = event.target as HTMLElement | null;
    if (target?.closest("button, a, input, textarea, select, [role='dialog']")) return;
    if (endsSelection()) return;
    setExpanded((open) => !open);
  }

  const more: RowAction[] = [
    ...(canRegenerate
      ? [{ label: "Regenerate", aria: `Regenerate ${subject}`, disabled: blocked ?? undefined, onClick: () => onRegenerate(line) }]
      : []),
    // Outside the canRegenerate gate: reporting is what a player who cannot sign in has.
    // Hidden only when the line has no address the report page could resolve.
    ...(onReport && targetForLine(line)
      ? [{ label: "Report a problem", aria: `Report a problem with ${subject}`, onClick: () => onReport(line) }]
      : []),
    ...(onIgnore
      ? [
          {
            label: line.ignored ? "Ignored" : "Never voice this line",
            aria: `${line.ignored ? "Ignored" : "Never voice this line"}: ${subject}`,
            title: line.ignored ? `Ignored: ${line.ignored}` : undefined,
            marked: Boolean(line.ignored),
            onClick: () => onIgnore(line),
          },
        ]
      : []),
    // Only on a dirty row: a clean row would be offering to clear nothing.
    ...(canRegenerate && dirty
      ? [
          {
            label: "Clear the pronunciation mark",
            aria: `Clear the pronunciation mark on ${subject}`,
            title: "The take stays; only the mark goes",
            onClick: () => onClearDirty(line),
          },
        ]
      : []),
    ...(onRename && line.questId !== null
      ? [{ label: "Name the quest", aria: `Name the quest ${line.questId}`, onClick: () => onRename(line, "quest") }]
      : []),
    ...(onAddSpeaker
      ? [{ label: "Add another speaker", aria: `Add another speaker: another NPC who says ${subject}`, onClick: () => onAddSpeaker(line) }]
      : []),
    ...(onReplaceSpeaker
      ? [
          {
            label: "Replace the speaker",
            aria: `Replace the speaker: put another NPC in ${line.npcName}'s place on this line`,
            onClick: () => onReplaceSpeaker(line),
          },
        ]
      : []),
    ...(onRemoveSpeaker && !line.soleSpeaker
      ? [{ label: "Remove this speaker", aria: `Remove this speaker: take ${line.npcName} off this line`, onClick: () => onRemoveSpeaker(line) }]
      : []),
  ];

  return (
    <tr data-line-key={line.key} onClick={toggleFromRow} className={cn("cat-tr", current && "cat-current")}>
      <td className="cat-cell-play">
        {/* Play is its own control: text inside a <button> cannot reliably be selected and copied. */}
        <button
          aria-current={current}
          disabled={!line.hasAudio}
          onClick={() => onPlay(line)}
          title={line.hasAudio ? `Play ${line.audioPath}` : undefined}
          aria-label={`Play ${subject}`}
          className="cat-play"
        >
          <PlayIcon />
        </button>
      </td>

      <td>
        <div className="cat-line">
          <SourceMark source={line.source} />
          {/* A $g line is split per player gender, and the two rows differ by a word. */}
          {line.playerGender && (
            <span className="cat-pg" title={`To ${line.playerGender === "m" ? "male" : "female"} player`}>
              {line.playerGender === "m" ? "M" : "F"}
            </span>
          )}
          {/* The override, when there is one: this shows what the line says out loud. */}
          <div className="min-w-0 flex-1">
            <span className={cn("block whitespace-pre-wrap", !expanded && "line-clamp-1")}>
              <Untranslated missing={line.missing?.text}>{line.override ?? line.text}</Untranslated>
            </span>
            {line.override !== null && line.driftedOverride && canRegenerate && (
              <OverrideDrift
                file={line.driftedOverride.file}
                lineId={line.driftedOverride.lineId}
                text={line.override}
                onAnswered={() => onOverrideAnswered(line)}
              />
            )}
          </div>
          <span className="cat-tags">
            {line.missing?.text ? <UntranslatedMark /> : null}
            {line.contributionId ? (
              <a
                // ?status=accepted: the review page opens on new contributions, which never holds
                // the accepted one this line came from.
                href={localeHref(lang, `/contributions/quests?status=accepted#contribution-${line.contributionId}`)}
                title="Accepted from a player's contribution"
                className="underline underline-offset-2"
              >
                contributed
              </a>
            ) : null}
            {line.ignored && <span title={line.ignored}>ignored</span>}
            {line.narration && (
              <span className="text-sky-300" title="A narrator reads this line's stage directions">
                narration
              </span>
            )}
            {line.override && !line.narrationRestored && !stale && <span title="This line's spoken text was rewritten">rewritten</span>}
          </span>
          {/* A row click reaches no keyboard, so expanding needs a real control too. */}
          <button
            aria-expanded={expanded}
            aria-label={expanded ? "Collapse this line" : "Show the whole line"}
            title={expanded ? "Collapse" : "Show the whole line"}
            onClick={() => setExpanded((open) => !open)}
            className="cat-expand"
          >
            <ChevronDownIcon className={cn("size-3.5 transition-transform", expanded && "rotate-180")} />
          </button>
        </div>
      </td>

      <td>
        {line.questId !== null ? (
          <>
            <FilterLink
              href={questHref(line)}
              onApply={() => onNarrowToQuest(line)}
              className="cat-two-top hover:underline"
              title={`Show only quest ${line.questId}`}
            >
              <Untranslated missing={line.missing?.questTitle}>{line.questTitle ?? `Quest ${line.questId}`}</Untranslated>
            </FilterLink>
            <span className="cat-two-sub">
              {SOURCE_WORDS[line.source] ?? line.source} · quest {line.questId} <WowheadLink href={wowheadQuestUrl(line.questId)} />
            </span>
          </>
        ) : (
          // Gossip and chat have no quest: the BroadcastText ids they speak stand in its place.
          <>
            <span className="cat-two-top">{line.source === "chatter" ? "NPC chat" : "Gossip"}</span>
            <span className="cat-two-sub">
              {line.broadcast?.length
                ? line.broadcast.map(({ id, matchedBy }, index) => (
                    <span
                      key={id}
                      title={
                        matchedBy === "text"
                          ? "Matched by English text: one of the ids that read this way"
                          : "The world database names this id for an NPC saying this text"
                      }
                    >
                      {index > 0 ? ", " : "broadcast "}
                      {id}
                    </span>
                  ))
                : "no broadcast id"}
              {line.moment?.map((sibling) => (
                <a
                  key={sibling}
                  href={localeHref(lang, `/quests?line=${encodeURIComponent(sibling)}`)}
                  className="underline underline-offset-2"
                  title={`Same moment: ${sibling}, the same id in the same voice, kept as a line of its own`}
                >
                  {" · same moment"}
                </a>
              ))}
            </span>
          </>
        )}
      </td>

      <td className="whitespace-nowrap">
        {/* What just happened replaces the state: after a regeneration "no audio" is wrong. */}
        {state?.phase === "busy" ? (
          <StateWord tone="skip">Generating…</StateWord>
        ) : state?.phase === "error" ? (
          <StateWord tone="error">{state.message}</StateWord>
        ) : state?.phase === "done" ? (
          <StateWord tone="current">v{state.version}</StateWord>
        ) : missing ? (
          <StateWord tone={missing.kind === "gap" ? "missing" : "skip"} title={missing.kind === "skip" ? "This line is never voiced" : undefined}>
            {missing.label}
          </StateWord>
        ) : stale ? (
          <StateWord tone="stale" title="Made from text that has since changed">
            audio outdated
          </StateWord>
        ) : (
          // Which take is live, and the way to any other: the label is the control.
          <TakeSelector
            source="quests"
            file={line.audioPath}
            version={version}
            canRestore={canRegenerate}
            takes={takes}
            onRestored={(restored) => onRestored(line.audioPath, restored)}
          />
        )}
        {/* Beneath the state: a line can be current and dirty at once, and one word cannot say both. */}
        {dirty && (
          <div className="cat-state cat-state-stale mt-0.5" title="Cut before a pronunciation it speaks was changed">
            pronunciation moved
          </div>
        )}
      </td>

      {showMadeBy && <MadeByCell madeBy={line.madeBy} />}

      {showRecordings && (
        <ActorTakeCell source="quests" file={line.audioPath} recording={line.recording ?? null} onChanged={() => onRecordingChanged(line)} />
      )}

      <td className="cat-cell-actions">
        <RowActions
          subject={subject}
          badge={<ReportsBadge source="quests" lineId={line.lineId} count={line.reportsOpen} canTriage={canTriage} />}
          primary={
            canRegenerate && !line.missing?.text
              ? [
                  {
                    label: "Edit",
                    aria: `Edit the spoken text of ${subject}`,
                    title: "Edit what this line says out loud",
                    marked: line.override !== null,
                    onClick: () => onEditText(line),
                  },
                ]
              : []
          }
          more={more}
        />
      </td>
    </tr>
  );
}
