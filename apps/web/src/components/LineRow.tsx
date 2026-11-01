"use client";

import ActorTakeCell from "@/components/ActorTakeCell";
import { MadeByCell } from "@/components/MadeBy";
import OverrideDrift from "@/components/OverrideDrift";
import { RenameButton } from "@/components/RenameButton";
import { Untranslated, UntranslatedMark } from "@/components/Untranslated";
import FilterLink from "@/components/FilterLink";
import { useLang } from "@/components/LangProvider";
import { localeHref } from "@/lib/lang";
import {
  ChevronDownIcon,
  Eraser,
  EyeOffIcon,
  FlagIcon,
  MessageSquareIcon,
  MessageSquareQuoteIcon,
  PencilIcon,
  PlayIcon,
  RepeatIcon,
  UserPlusIcon,
  XIcon,
} from "lucide-react";
import { useState, type ReactNode } from "react";

import ReportsBadge from "./ReportsBadge";
import TakeSelector from "./TakeSelector";
import RegenerateButton from "./RegenerateButton";
import { Button } from "./ui/button";
import { targetForLine } from "@/lib/reports/line-target";
import { cn, endsSelection } from "@/lib/utils";
import type { LineState } from "./Explorer";
import type { ResultLine } from "@/lib/search";
import OutdatedNote from "@/components/OutdatedNote";
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
  // An unvoiceable line is an expected absence, not a gap: progress text is never voiced,
  // and text with unresolved $ / <> tokens would be read aloud verbatim.
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
  /** May write this line's text in the page's language. Apart from regenerating: a
   *  translator may do this and not spend anything. */
  canEdit: boolean;
  /** Editor and up: may read the report bodies and resolve them from the row. */
  canTriage: boolean;
  /** An override's Keep or Drop went through, so the row reads its text again. */
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
  /** Open the report dialog. Everyone gets this, signed in or not. */
  onReport: (line: ResultLine) => void;
  onRestored: (file: string, version: number) => void;
  /**
   * Rows of one line and speaker (its player-gender wordings) share the speaker cells: the
   * first row spans this many rows, and the rest pass 0 and leave those cells out.
   */
  groupSpan: number;
  /** Whether the NPC's id links to its row on /npcs, which only an admin can open. */
  showNpcPage?: boolean;
  /** Narrow the search to this line's NPC, or to its quest; the hrefs open that view elsewhere. */
  onNarrowToNpc: (line: ResultLine) => void;
  onNarrowToQuest: (line: ResultLine) => void;
  npcHref: (line: ResultLine) => string;
  questHref: (line: ResultLine) => string;
  /** Say this take is fine as it stands, despite a pronunciation having moved under it. */
  onClearDirty: (line: ResultLine) => void;
};

function SpeakerAction({ label, onClick, children }: { label: string; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={onClick}
      className="hover:text-foreground ml-1 inline-flex align-middle"
    >
      {children}
    </button>
  );
}

export default function LineRow({
  line,
  current,
  showMadeBy,
  showRecordings,
  onRecordingChanged,
  canRegenerate,
  canEdit,
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
  onNarrowToNpc,
  showNpcPage = false,
  groupSpan,
  onNarrowToQuest,
  npcHref,
  questHref,
  onClearDirty,
}: Props) {
  const missing = absence(line);
  const spanned = groupSpan > 0;
  const [expanded, setExpanded] = useState(false);
  const lang = useLang();

  /**
   * Clicking the row shows the whole line, but only when the click meant that.
   *
   * Two things it must not swallow. Every control in the row - play, the narrowing links, the
   * pencil, history, regenerate - is a descendant of this handler, so a click that landed on
   * one of them is that button's business rather than a toggle. And a click that ends a drag
   * over the text is someone copying it, which is the other half of what this cell is for:
   * toggling the row out from under them would make selecting the text a fight.
   */
  function toggleFromRow(event: React.MouseEvent<HTMLTableRowElement>) {
    const target = event.target as HTMLElement | null;
    if (target?.closest("button, a, input, textarea, select, [role='dialog']")) return;
    if (endsSelection()) return;
    setExpanded((open) => !open);
  }

  return (
    <tr
      data-line-key={line.key}
      onClick={toggleFromRow}
      className={cn(
        "border-border/60 border-b align-top transition-colors",
        // Ungated by hasAudio: every row expands now, not only the ones that play.
        "hover:bg-muted/60",
        current && "bg-muted",
      )}
    >
      {spanned && (
        <td rowSpan={groupSpan} className="px-2 py-2">
          <FilterLink
            href={npcHref(line)}
            onApply={() => onNarrowToNpc(line)}
            className="hover:text-foreground block max-w-full truncate text-left underline-offset-2 hover:underline"
            title={`Show only ${line.npcName}`}
          >
            <Untranslated missing={line.missing?.npcName}>{line.npcName}</Untranslated>
          </FilterLink>
          {onRename && (
            <RenameButton label={`Name ${line.npcName}`} onClick={() => onRename(line, "npc")} />
          )}
          <span className="text-muted-foreground block truncate text-xs">
            {line.npcType} {line.npcId} <WowheadLink href={wowheadEntityUrl(line.npcType, line.npcId)} />
            {showNpcPage && (
              <>
                {" "}
                <a
                  href={localeHref(lang, npcPageHref(line.npcId))}
                  onClick={(event) => event.stopPropagation()}
                  title="Open this NPC on the NPCs page"
                  className="hover:text-foreground underline underline-offset-2"
                >
                  npc
                </a>
              </>
            )}
            {onAddSpeaker && (
              <SpeakerAction label={`Add another NPC who says ${line.npcName}'s line`} onClick={() => onAddSpeaker(line)}>
                <UserPlusIcon className="size-3" />
              </SpeakerAction>
            )}
            {onReplaceSpeaker && (
              <SpeakerAction
                label={`Put another NPC in ${line.npcName}'s place on this line`}
                onClick={() => onReplaceSpeaker(line)}
              >
                <RepeatIcon className="size-3" />
              </SpeakerAction>
            )}
            {onRemoveSpeaker && !line.soleSpeaker && (
              <SpeakerAction label={`Take ${line.npcName} off this line`} onClick={() => onRemoveSpeaker(line)}>
                <XIcon className="size-3" />
              </SpeakerAction>
            )}
          </span>
          {line.added && (
            <span className="text-muted-foreground block text-xs" title="Added by hand, not from the game data">
              added
            </span>
          )}
        </td>
      )}

      {spanned && (
        <td rowSpan={groupSpan} className="px-2 py-2">
          {line.questId !== null ? (
            <>
              <FilterLink
                href={questHref(line)}
                onApply={() => onNarrowToQuest(line)}
                className="hover:text-foreground block max-w-full truncate text-left underline-offset-2 hover:underline"
                title={`Show only quest ${line.questId}`}
              >
                <Untranslated missing={line.missing?.questTitle}>
                  {line.questTitle ?? `quest ${line.questId}`}
                </Untranslated>
              </FilterLink>
              {onRename && (
                <RenameButton
                  label={`Name quest ${line.questId}`}
                  onClick={() => onRename(line, "quest")}
                />
              )}
              {/* "after quest" on a follow-up line: the title alone would read as though the
                  line were part of the quest's dialog, when it is what the NPC says once that
                  dialog has closed. */}
              <span className="text-muted-foreground block truncate text-xs">
                {line.source === "followup" ? (
                  <span title={FOLLOWUP_LABEL}>after quest</span>
                ) : (
                  "quest"
                )}{" "}
                {line.questId} <WowheadLink href={wowheadQuestUrl(line.questId)} />
              </span>
            </>
          ) : (
            // Gossip, which has no quest: the BroadcastText ids it speaks stand in its place.
            <div className="text-xs tabular-nums">
              {line.broadcast?.length ? (
                line.broadcast.map(({ id, matchedBy }) => (
                  <span
                    key={id}
                    className={"block " + (matchedBy === "text" ? "text-muted-foreground" : "")}
                    title={
                      matchedBy === "text"
                        ? "Matched by English text: one of the ids that read this way"
                        : "The world database names this id for an NPC saying this text"
                    }
                  >
                    {id}
                  </span>
                ))
              ) : (
                <span className="text-muted-foreground">—</span>
              )}
              {line.moment?.map((sibling) => (
                <a
                  key={sibling}
                  href={localeHref(lang, `/quests?line=${encodeURIComponent(sibling)}`)}
                  className="text-muted-foreground block truncate underline-offset-2 hover:underline"
                  title={`Same moment: ${sibling}, the same id in the same voice, kept as a line of its own`}
                >
                  same moment
                </a>
              ))}
            </div>
          )}
        </td>
      )}

      {/* The voice slot is spelled race-gender-flavor, so this column is all three at once.
          The flavor is what distinguishes the two or three voices a race-gender has, so it
          belongs beside them rather than in a column of its own. */}
      {spanned && (
        <td rowSpan={groupSpan} className="text-muted-foreground px-2 py-2">
          <span className="block truncate">{line.race}</span>
          <span className="block truncate text-xs">
            {line.flavor ? `${line.gender} · ${line.flavor}` : line.gender}
          </span>
        </td>
      )}

      {/* The text is plain markup rather than the label of a button, which is what makes it
          selectable: text inside a <button> cannot reliably be dragged over and copied. That
          is why playing needs a control of its own. */}
      <td className="p-0">
        <div className="flex w-full min-w-0 items-start gap-2 px-2 py-2">
          <button
            aria-current={current}
            disabled={!line.hasAudio}
            onClick={() => onPlay(line)}
            title={line.hasAudio ? `Play ${line.audioPath}` : undefined}
            aria-label={`Play ${line.npcName}'s line`}
            className={cn(
              "mt-px shrink-0 rounded-sm p-0.5",
              "focus-visible:ring-ring/50 focus-visible:ring-[3px] focus-visible:outline-none",
              line.hasAudio
                ? "text-muted-foreground hover:text-foreground cursor-pointer"
                : "text-muted-foreground/30 cursor-default",
              current && "text-foreground",
            )}
          >
            <PlayIcon className="size-3.5" />
          </button>
          <SourceMark source={line.source} />
          {/* A $g line is split per player gender, and the two rows differ by a word. */}
          {line.playerGender && (
            <span
              className="text-muted-foreground mt-px w-3 shrink-0 text-center text-xs"
              title={`To ${line.playerGender === "m" ? "male" : "female"} player`}
            >
              {line.playerGender === "m" ? "M" : "F"}
            </span>
          )}
          {/* The override, when there is one: this cell shows what the line says out loud,
              and after a rewrite that is no longer what the corpus holds. */}
          <span className={cn("min-w-0 flex-1 whitespace-pre-wrap", !expanded && "line-clamp-2")}>
            <Untranslated missing={line.missing?.text}>{line.override ?? line.text}</Untranslated>
          </span>
          {/* What is true of the TEXT stays beside the text; what is true of the audio
              moved to the Audio column, where it lines up down the page. */}
          <span className="mt-0.5 flex shrink-0 gap-2 text-xs">
            {line.missing?.text ? <UntranslatedMark /> : null}
            {/* Nothing else about a contributed row differs from a native one -- this is the
                whole marker, plus a way back to where it came from. */}
            {line.contributionId ? (
              <a
                // ?status=accepted -- page.tsx defaults to status=new, and a contributed
                // line's own contribution is by definition accepted, so a bare /contributions
                // link would land on a queue that never shows the row it points at.
                href={localeHref(
                  lang,
                  `/contributions/quests?status=accepted#contribution-${line.contributionId}`,
                )}
                onClick={(event) => event.stopPropagation()}
                title="Accepted from a player's contribution"
                className="text-muted-foreground hover:text-foreground underline underline-offset-2"
              >
                contributed
              </a>
            ) : null}
            {/* First of these: it is the reason the row is on screen at all, since a
                search only shows an ignored line when it was asked for. */}
            {line.ignored && (
              <span className="text-muted-foreground" title={line.ignored}>
                ignored
              </span>
            )}
            {line.narration && (
              <span className="text-sky-300" title="A narrator reads this line's stage directions">
                narration
              </span>
            )}
            {line.override && !line.narrationRestored && !stale && (
              <span className="text-muted-foreground" title="This line's spoken text was rewritten">
                rewritten
              </span>
            )}
            {line.override !== null && line.driftedOverride && canRegenerate && (
              <OverrideDrift
                file={line.driftedOverride.file}
                lineId={line.driftedOverride.lineId}
                text={line.override}
                onAnswered={() => onOverrideAnswered(line)}
              />
            )}
          </span>
          {/* A row click is a mouse gesture and reaches no keyboard, so the same toggle needs
              a real control. It doubles as the only thing on screen saying rows expand. */}
          <button
            aria-expanded={expanded}
            aria-label={expanded ? "Collapse this line" : "Show the whole line"}
            title={expanded ? "Collapse" : "Show the whole line"}
            onClick={() => setExpanded((open) => !open)}
            className={cn(
              "text-muted-foreground hover:text-foreground mt-px shrink-0 cursor-pointer rounded-sm p-0.5",
              "focus-visible:ring-ring/50 focus-visible:ring-[3px] focus-visible:outline-none",
            )}
          >
            <ChevronDownIcon
              className={cn("size-3.5 transition-transform", expanded && "rotate-180")}
            />
          </button>
        </div>
      </td>

      {/* Audio, in a column of its own rather than floated into the prose, the way the
          readables table has always had it: the point of a column is that it lines up down the
          page, and "which of these has no clip yet" is the question this screen is most
          often asked. It holds what the clip's state is, and which take that clip is. */}
      <td className="px-2 py-2 text-xs whitespace-nowrap">
        {/* The regeneration outcome replaces the state: once a line has just been made,
            "no audio" is stale and confusing rather than merely redundant. */}
        {state?.phase === "error" ? (
          <span className="text-destructive">{state.message}</span>
        ) : state?.phase === "done" ? (
          <span className="text-emerald-400">
            v{state.version}
          </span>
        ) : missing ? (
          <span
            className={missing.kind === "gap" ? "text-destructive" : "text-muted-foreground"}
            title={missing.kind === "skip" ? "This line is never voiced" : undefined}
          >
            {missing.label}
          </span>
        ) : stale ? (
          // Stale before the take number: "the audio is old" is the more actionable of the
          // two things this cell could say, and a rewrite is why somebody is here.
          <OutdatedNote />
        ) : (
          // Which take is live, and the way to any other. The label IS the control, so the
          // history is no longer hidden behind a second icon.
          <TakeSelector
            source="quests"
            file={line.audioPath}
            version={version}
            canRestore={canRegenerate}
            takes={takes}
            onRestored={(restored) => onRestored(line.audioPath, restored)}
          />
        )}
        {/* Beneath the state rather than inside it: the text has not moved, so a line can
            be current and dirty at once, and one word cannot say both. */}
        {dirty && (
          <div
            className="text-amber-300"
            title="Cut before a pronunciation it speaks was changed"
          >
            pronunciation
          </div>
        )}
      </td>

      {showMadeBy && <MadeByCell madeBy={line.madeBy} />}

      {showRecordings && (
        <ActorTakeCell
          source="quests"
          file={line.audioPath}
          recording={line.recording ?? null}
          onChanged={() => onRecordingChanged(line)}
        />
      )}

      <td className="py-1.5 pr-1 pl-0">
        <span className="flex items-center justify-end whitespace-nowrap">
          {/* The same chip the places and readables rows carry; ReportsBadge says why. */}
          <ReportsBadge
            source="quests"
            lineId={line.lineId}
            count={line.reportsOpen}
            canTriage={canTriage}
          />

          {/* Outside the canRegenerate gate, deliberately: reporting is what a player who
              cannot sign in has, and /api/reports is unauthenticated for the same reason.
              Hidden only when the line has no address the report page could resolve. */}
          {targetForLine(line) && (
            <Button
              variant="ghost"
              size="icon"
              title="Report a problem with this line"
              aria-label={`Report ${line.npcName}'s line`}
              onClick={() => onReport(line)}
            >
              <FlagIcon className="size-3.5" />
            </Button>
          )}
          {canEdit && (
            <Button
              variant="ghost"
              size="icon"
              title="Edit what this line says out loud"
              aria-label={`Edit the spoken text of ${line.npcName}'s line`}
              onClick={() => onEditText(line)}
            >
              <PencilIcon className={cn("size-3.5", line.override && "text-amber-300")} />
            </Button>
          )}
          {onIgnore && (
            <Button
              variant="ghost"
              size="icon"
              title={line.ignored ? `Ignored: ${line.ignored}` : "Never voice this line"}
              aria-label={`Ignore ${line.npcName}'s line`}
              onClick={() => onIgnore(line)}
            >
              <EyeOffIcon className={cn("size-3.5", line.ignored && "text-amber-300")} />
            </Button>
          )}
          {canRegenerate && (
            <>
            {/* Only on a dirty row. The mark is the whole reason this control exists, and a
                clean row would be offering to clear nothing. */}
            {dirty && (
              <Button
                variant="ghost"
                size="icon"
                title="Audio predates a pronunciation change - clear the mark (does not regenerate)"
                aria-label={`Clear the pronunciation mark on ${line.npcName}'s line`}
                onClick={() => onClearDirty(line)}
              >
                <Eraser className="size-3.5 text-amber-300" />
              </Button>
            )}
            <RegenerateButton
              busy={state?.phase === "busy"}
              blocked={blocked}
              onClick={() => onRegenerate(line)}
            />
            </>
          )}
        </span>
      </td>
    </tr>
  );
}
