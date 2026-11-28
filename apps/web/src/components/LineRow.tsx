"use client";

import ActorTakeCell from "@/components/ActorTakeCell";
import { MadeByCell } from "@/components/MadeBy";
import OverrideDrift from "@/components/OverrideDrift";
import { RenameButton } from "@/components/RenameButton";
import { Untranslated, UntranslatedMark } from "@/components/Untranslated";
import FilterLink from "@/components/FilterLink";
import { useLang } from "@/components/LangProvider";
import { langName, localeHref } from "@/lib/lang";
import { fill } from "@/lib/site-text/format";
import { RowActions, StateWord, type RowAction } from "@/components/catalogue/RowParts";
import { useUiText } from "@/components/UiTextProvider";
import type { UiText } from "@/lib/ui-text/en";
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

/**
 * Why a line has no audio, or null when it does.
 *
 * Reads `voiceable` rather than the corpus's `generatable`, because an override can rescue a
 * line the extractor gave up on: once the stage direction is gone, its absence is a gap like
 * any other rather than an expected skip. The words are the reader's, so only the kind is
 * decided here.
 */
function absence(line: ResultLine): { kind: "gap" | "skip"; skipReason: string | null } | null {
  if (line.hasAudio) return null;
  // An unvoiceable line is an expected absence, not a gap: text with unresolved $ / <> tokens
  // would be read aloud verbatim, and an untranslated line has nothing to voice.
  if (!line.voiceable) return { kind: "skip", skipReason: line.skipReason ?? null };
  return { kind: "gap", skipReason: null };
}

/**
 * The game's own quest markers, because the reader already knows them: yellow "!" over an
 * NPC means a quest to take, yellow "?" one to hand in. Progress keeps the family with a
 * minus - nothing to do here yet - and gossip, which the game marks with no overhead icon
 * at all, gets a grey speech bubble instead of a fourth punctuation mark nobody would read.
 */
const QUEST_MARKS = {
  accept: { glyph: "!" },
  complete: { glyph: "?" },
  progress: { glyph: "−" },
} satisfies Record<string, { glyph: string }>;

/** The sources that get the game's own quest icon, and so need its tooltip. */
type QuestMarkSource = keyof typeof QUEST_MARKS;

function SourceMark({ source, t }: { source: string; t: UiText["catalogue"]["row"]["marks"] }) {
  // Gossip's bubble, because this is an NPC talking rather than a quest dialog, but in the
  // quest marks' amber: it only happens because of a quest, and the row names which.
  if (source === "followup") {
    return (
      <span
        title={t.followup}
        aria-label="follow-up"
        className="mt-1 flex w-3.5 shrink-0 justify-center"
      >
        <MessageSquareQuoteIcon className="size-3.5 text-amber-400" />
      </span>
    );
  }

  if (source === "chatter") {
    return (
      <span title={t.chatter} aria-label={t.chatter} className="mt-1 flex w-3.5 shrink-0 justify-center">
        <MessageSquareQuoteIcon className="size-3.5 text-zinc-400" />
      </span>
    );
  }

  if (source === "gossip") {
    return (
      <span title={t.gossip} aria-label={t.gossip} className="mt-1 flex w-3.5 shrink-0 justify-center">
        <MessageSquareIcon className="size-3.5 text-zinc-400" />
      </span>
    );
  }

  if (!Object.hasOwn(QUEST_MARKS, source)) return null;
  const mark = QUEST_MARKS[source as QuestMarkSource];

  return (
    <span
      title={t[source as QuestMarkSource]}
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

/**
 * The heading over one NPC's lines: who speaks, in which voice, and the ways to that NPC. Relies
 * on the results coming sorted by speaker, so each NPC's lines sit together under one heading.
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
  const t = useUiText().catalogue.row;
  return (
    <tr className="cat-group">
      <th colSpan={columns} scope="colgroup">
        <FilterLink
          href={npcHref(line)}
          onApply={() => onNarrowToNpc(line)}
          className="cat-group-name"
          title={fill(t.showOnlyNpc, { name: line.npcName })}
        >
          <Untranslated missing={line.missing?.npcName}>{line.npcName}</Untranslated>
        </FilterLink>
        {onRename && <RenameButton label={fill(t.nameNpc, { name: line.npcName })} onClick={() => onRename(line, "npc")} />}
        {/* The voice slot is spelled race-gender-flavor: it says whose voice reads these lines. */}
        <span className="cat-group-meta">
          {[line.race, line.gender, line.flavor].filter(Boolean).join(" · ")}
          {" · "}
          {line.npcType} {line.npcId} <WowheadLink npcType={line.npcType} npcId={line.npcId} />
          {showNpcPage && (
            <>
              {" "}
              <a href={localeHref(lang, npcPageHref(line.npcId))} title={t.openNpc} className="underline underline-offset-2">
                npc
              </a>
            </>
          )}
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
  const text = useUiText();
  const t = text.catalogue.row;
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

  // Missing or outdated audio makes generating the row's task, so it leaves the menu for a gold
  // button; on current audio it stays in the menu, where remaking a fine take is a deliberate act.
  const needsTake = canRegenerate && (missing?.kind === "gap" || (!missing && stale));
  const generate: RowAction = {
    label: missing ? t.generate : t.regenerate,
    aria: missing ? fill(t.actions.generateFor, { subject }) : fill(t.actions.regenerateFor, { subject }),
    disabled: blocked ?? (state?.phase === "busy" ? t.generatingAlready : undefined),
    emphasis: needsTake,
    onClick: () => onRegenerate(line),
  };
  const more: RowAction[] = [
    ...(canRegenerate && !needsTake ? [generate] : []),
    // Outside the canRegenerate gate: reporting is what a player who cannot sign in has.
    // Hidden only when the line has no address the report page could resolve.
    ...(onReport && targetForLine(line)
      ? [{ label: t.report, aria: fill(t.actions.reportFor, { subject }), onClick: () => onReport(line) }]
      : []),
    ...(onIgnore
      ? [
          {
            label: line.ignored ? t.ignored : t.ignore,
            aria: line.ignored ? fill(t.actions.ignoredFor, { subject }) : fill(t.actions.ignoreFor, { subject }),
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
            label: t.clearMark,
            aria: fill(t.actions.clearMarkFor, { subject }),
            title: t.clearMarkTitle,
            onClick: () => onClearDirty(line),
          },
        ]
      : []),
    ...(onRename && line.questId !== null
      ? [{ label: t.nameQuest, aria: fill(t.actions.nameQuestFor, { id: line.questId }), onClick: () => onRename(line, "quest") }]
      : []),
    ...(onAddSpeaker
      ? [{ label: t.addSpeaker, aria: fill(t.actions.addSpeakerFor, { subject }), onClick: () => onAddSpeaker(line) }]
      : []),
    ...(onReplaceSpeaker
      ? [
          {
            label: t.replaceSpeaker,
            aria: fill(t.actions.replaceSpeakerFor, { name: line.npcName }),
            onClick: () => onReplaceSpeaker(line),
          },
        ]
      : []),
    ...(onRemoveSpeaker && !line.soleSpeaker
      ? [{ label: t.removeSpeaker, aria: fill(t.actions.removeSpeakerFor, { name: line.npcName }), onClick: () => onRemoveSpeaker(line) }]
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
          aria-label={fill(text.catalogue.columns.play + " {subject}", { subject })}
          className="cat-play"
        >
          <PlayIcon />
        </button>
      </td>

      <td>
        <div className="cat-line">
          <SourceMark source={line.source} t={t.marks} />
          {/* A $g line is split per player gender, and the two rows differ by a word. */}
          {line.playerGender && (
            <span className="cat-pg" title={line.playerGender === "m" ? t.toMale : t.toFemale}>
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
                title={t.contributedTitle}
                className="underline underline-offset-2"
              >
                {t.contributed}
              </a>
            ) : null}
            {line.ignored && <span title={line.ignored}>{t.ignoredMark}</span>}
            {line.narration && (
              <span className="text-sky-300" title={t.narrationTitle}>
                {t.narration}
              </span>
            )}
            {line.override && !line.narrationRestored && !stale && <span title={t.rewrittenTitle}>{t.rewritten}</span>}
          </span>
          {/* A row click reaches no keyboard, so expanding needs a real control too. */}
          <button
            aria-expanded={expanded}
            aria-label={expanded ? t.collapse : t.showWhole}
            title={expanded ? t.collapseShort : t.showWhole}
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
              title={fill(t.showOnlyQuest, { id: line.questId })}
            >
              <Untranslated missing={line.missing?.questTitle}>{line.questTitle ?? fill(t.questFallback, { id: line.questId })}</Untranslated>
            </FilterLink>
            <span className="cat-two-sub">
              {t.sourceWords[line.source as keyof typeof t.sourceWords] ?? line.source} · {fill(t.questId, { id: line.questId })} <WowheadLink questId={line.questId} />
            </span>
          </>
        ) : (
          // Gossip and chat have no quest: the BroadcastText ids they speak stand in its place.
          <>
            <span className="cat-two-top">{text.catalogue.facets.source[line.source === "chatter" ? "chatter" : "gossip"]}</span>
            <span className="cat-two-sub">
              {line.broadcast?.length
                ? line.broadcast.map(({ id, matchedBy }, index) => (
                    <span
                      key={id}
                      title={
                        matchedBy === "text" ? t.matchedByText : t.namedByWorld
                      }
                    >
                      {index > 0 ? `, ${id}` : fill(t.broadcast, { id })}
                    </span>
                  ))
                : t.noBroadcast}
              {line.moment?.map((sibling) => (
                <a
                  key={sibling}
                  href={localeHref(lang, `/quests?line=${encodeURIComponent(sibling)}`)}
                  className="underline underline-offset-2"
                  title={fill(t.sameMomentTitle, { id: sibling })}
                >
                  {" · "}{t.sameMoment}
                </a>
              ))}
            </span>
          </>
        )}
        {/* Per line, not on the speaker heading: an admin attaches a speaker to one line. */}
        {line.added && (
          <span className="cat-two-sub" title={t.speakerAddedTitle}>
            {t.speakerAdded}
          </span>
        )}
      </td>

      <td className="whitespace-nowrap">
        {/* What just happened replaces the state: after a regeneration "no audio" is wrong. */}
        {state?.phase === "busy" ? (
          <StateWord tone="skip">{t.generating}</StateWord>
        ) : state?.phase === "error" ? (
          <StateWord tone="error">{state.message}</StateWord>
        ) : state?.phase === "done" ? (
          <StateWord tone="current">v{state.version}</StateWord>
        ) : missing ? (
          <StateWord tone={missing.kind === "gap" ? "missing" : "skip"} title={missing.kind === "skip" ? t.notVoiced : undefined}>
            {missing.skipReason ?? (missing.kind === "gap" ? t.noAudio : t.notVoiced)}
          </StateWord>
        ) : stale ? (
          <StateWord tone="stale" title={t.outdatedWhy}>
            {t.outdated}
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
          <div className="cat-state cat-state-stale mt-0.5" title={t.pronunciationMovedWhy}>
            {t.pronunciationMoved}
          </div>
        )}
      </td>

      {showMadeBy && <MadeByCell madeBy={line.madeBy} />}

      {showRecordings && (
        <ActorTakeCell source="quests" file={line.audioPath} recording={line.recording ?? null} onChanged={() => onRecordingChanged(line)} />
      )}

      <td className="cat-cell-actions">
        {/* No text in this language, so nothing here can be edited or voiced: the text comes from
            players' game clients and is accepted on the review page. Saying so beats an empty cell. */}
        {line.missing?.text && (
          <a
            href={localeHref(lang, "/contributions/quests")}
            className="cat-hint"
            title={t.waitingForTextHint}
          >
            {fill(t.waitingForText, { lang: langName(lang) })}
          </a>
        )}
        <RowActions
          subject={subject}
          badge={<ReportsBadge source="quests" lineId={line.lineId} count={line.reportsOpen} canTriage={canTriage} />}
          primary={[
            ...(canRegenerate && !line.missing?.text
              ? [
                  {
                    label: t.edit,
                    aria: fill(t.actions.editFor, { subject }),
                    title: t.editTitle,
                    marked: line.override !== null,
                    onClick: () => onEditText(line),
                  },
                ]
              : []),
            ...(needsTake ? [generate] : []),
          ]}
          more={more}
        />
      </td>
    </tr>
  );
}
