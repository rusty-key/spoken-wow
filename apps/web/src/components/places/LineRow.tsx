"use client";

import ActorTakeCell from "@/components/ActorTakeCell";
import { MadeByCell } from "@/components/MadeBy";
import { RenameButton } from "@/components/RenameButton";
import { Untranslated, UntranslatedMark } from "@/components/Untranslated";
import FilterLink from "@/components/FilterLink";
import { ChevronDownIcon, PlayIcon } from "lucide-react";

import { RowActions, StateWord, type RowAction } from "@/components/catalogue/RowParts";
import { useState } from "react";

import RegenerateButton from "@/components/RegenerateButton";
import ReportsBadge from "@/components/ReportsBadge";
import TakeSelector from "@/components/TakeSelector";
import TextOverrideDrift from "@/components/TextOverrideDrift";
import { cn, endsSelection } from "@/lib/utils";
import { canPlay, type ExplorerLine, type ExplorerSection } from "@/components/explorer/section";

export type RowState =
  | { phase: "busy" }
  | { phase: "done"; version: number }
  | { phase: "error"; message: string };

type Props<L extends ExplorerLine> = {
  section: Pick<ExplorerSection<L>, "source" | "facetLabel" | "chip" | "ownLine" | "detail">;
  line: L;
  current: boolean;
  /** Whether to draw the "Made by" cell: the search sent it, so the viewer works here. */
  showMadeBy: boolean;
  /** Whether to draw the voice actor cell: the search sent recordings, so the viewer records here. */
  showRecordings: boolean;
  onRecordingChanged: (line: L) => void;
  /** Editor and up: the rewrite and regenerate controls. */
  canRegenerate: boolean;
  /** May write this line's text in the page's language, which a translator may do without
   *  being able to regenerate. */
  canEdit: boolean;
  /** Editor and up: may read the report bodies and resolve them from the row. */
  canTriage: boolean;
  state?: RowState;
  onPlay: (line: L) => void;
  /** Narrow the list to the line's chip: its zone or instance. */
  onNarrowToChip: (line: L) => void;
  /** The narrowed view as a link, for a click that opens it elsewhere. */
  chipHref: (line: L) => string;
  /** Null in another team's view, whose reports would land in the visitor's own team. */
  onReport: ((line: L) => void) | null;
  /** An earlier take is live again, so the row and the player can catch up. */
  onRestored: (line: L, version: number) => void;
  onEditText: (line: L) => void;
  /** Change what the acting team's audio says for the line. */
  onOverride: (line: L) => void;
  /** A drifted override was kept or dropped. */
  onOverrideAnswered: (line: L) => void;
  /** Name the line's place or boss in the page's language; null in English or without `text`. */
  onRename: ((line: L) => void) | null;
  onRegenerate: (line: L) => void;
  /** Say this take is fine as it stands, despite a pronunciation having moved under it. */
  onClearDirty: (line: L) => void;
};

// The same colour discipline as the quests explorer: red is only ever a real problem, amber
// is something that has drifted, grey is a fact about the row.
const STATE_TONE = {
  missing: "missing",
  stale: "stale",
  current: "current",
} as const;

const STATE_LABEL = {
  missing: "no audio",
  stale: "audio outdated",
  current: "",
} as const;

export function LineRow<L extends ExplorerLine>({
  section,
  line,
  current,
  showMadeBy,
  showRecordings,
  onRecordingChanged,
  canRegenerate,
  canEdit,
  canTriage,
  state,
  onPlay,
  onNarrowToChip,
  chipHref,
  onReport,
  onRestored,
  onEditText,
  onOverride,
  onOverrideAnswered,
  onRename,
  onRegenerate,
  onClearDirty,
}: Props<L>) {
  const playable = canPlay(line);
  // Nothing written in this language: no text to read, voice or play, but one to write.
  const unwritten = line.text === null;
  // English standing in for the language is not this language's text to override, and the
  // route refuses it.
  const overridable = !unwritten && line.translated !== false;
  const chip = section.chip(line);
  const [expanded, setExpanded] = useState(false);

  /**
   * Clicking the row shows the whole line, but only when the click meant that.
   *
   * Two things it must not swallow. Every control in the row is a descendant of this
   * handler, so a click that landed on one of them is that button's business rather than a
   * toggle. And a click that ends a drag over the prose is someone copying it, which is the
   * other half of what this cell is for.
   */
  function toggleFromRow(event: React.MouseEvent<HTMLTableRowElement>) {
    const target = event.target as HTMLElement | null;
    if (target?.closest("button, a, input, textarea, select, [role='dialog']")) return;
    if (endsSelection()) return;
    setExpanded((open) => !open);
  }

  return (
    <tr
      data-line-key={line.id}
      onClick={toggleFromRow}
      className={cn(
        "border-border/60 border-b align-top transition-colors",
        "hover:bg-muted/60",
        current && "cat-current",
      )}
    >
      {/* Narrowing is a sibling of the play button below, never nested inside it: a
          <button> within a <button> is invalid HTML and the inner click never fires. */}
      <td className="px-2 py-2">
        {chip !== null && (
          <FilterLink
            href={chipHref(line)}
            onApply={() => onNarrowToChip(line)}
            className="hover:text-foreground block max-w-full truncate text-left underline-offset-2 hover:underline"
            title={`Show only ${chip}`}
          >
            <Untranslated missing={line.zoneNameMissing}>{chip}</Untranslated>
          </FilterLink>
        )}
      </td>

      <td className="px-2 py-2">
        {section.ownLine?.(line) ? (
          <span className="text-muted-foreground italic">{section.facetLabel.toLowerCase()} line</span>
        ) : (
          <span className="block truncate">
            <Untranslated missing={line.nameMissing}>{line.name}</Untranslated>
          </span>
        )}
        {onRename && <RenameButton label={`Name ${line.name}`} onClick={() => onRename(line)} />}
        {section.detail && (
          <span className="text-muted-foreground block text-xs">{section.detail(line)}</span>
        )}
      </td>

      {/* The prose is plain markup rather than the label of a button, which is what makes it
          selectable: text inside a <button> cannot reliably be dragged over and copied. That
          is why playing needs a control of its own. */}
      <td className="p-0">
        <div className="flex w-full min-w-0 items-start gap-2 px-2 py-2">
          {!unwritten && (
            <button
              aria-current={current}
              disabled={!playable}
              onClick={() => onPlay(line)}
              title={playable ? `${line.file}.mp3` : undefined}
              aria-label={`Play ${line.name}`}
              className="cat-play"
            >
              <PlayIcon />
            </button>
          )}

          {/* An untranslated line shows the English in its place, marked as such, so the
              reader still sees what the line is about and that it is waiting to be written. */}
          {unwritten ? (
            <span className="text-muted-foreground min-w-0 flex-1 italic">No story in this language yet.</span>
          ) : (
            <div className="min-w-0 flex-1">
              <span className={cn("block whitespace-pre-wrap", !expanded && "clamp-2")}>
                <Untranslated missing={line.translated === false}>{line.text}</Untranslated>
              </span>
              {/* Under the original rather than in its place: the original is what the page
                  and the game still show, and the override is only what the team's take says. */}
              {line.override && (
                <span
                  className={cn("mt-1 block border-l-2 border-sky-400/60 pl-2 whitespace-pre-wrap", !expanded && "clamp-2")}
                  title="What your team's audio says"
                >
                  {line.override.text}
                </span>
              )}
              {line.override?.drifted && canRegenerate && (
                <TextOverrideDrift
                  source={section.source}
                  lineId={line.id}
                  text={line.override.text}
                  onAnswered={() => onOverrideAnswered(line)}
                />
              )}
            </div>
          )}
          {line.translated === false ? (
            <span className="mt-0.5 shrink-0 text-xs">
              <UntranslatedMark />
            </span>
          ) : null}

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
          <StateWord tone="error">{state.message}</StateWord>
        ) : state?.phase === "done" ? (
          <StateWord tone="current">v{state.version}</StateWord>
        ) : STATE_LABEL[line.state] ? (
          <StateWord tone={STATE_TONE[line.state]}>{STATE_LABEL[line.state]}</StateWord>
        ) : unwritten ? null : (
          // Which take is live, and the way to any other. The label IS the control, so
          // there is no second icon for a history nobody knew was there.
          <TakeSelector
            source={section.source}
            file={line.file}
            version={line.take?.version ?? null}
            canRestore={canRegenerate}
            takes={line.take?.takes ?? 0}
            onRestored={(version) => onRestored(line, version)}
          />
        )}
        {/* Beneath the state rather than inside it: the text has not moved, so this line is
            `current` and dirty at once, and one word cannot say both. */}
        {line.dirty && !unwritten && (
          <div className="text-amber-300" title="Cut before a pronunciation it speaks was changed">
            pronunciation
          </div>
        )}
      </td>

      {showMadeBy && <MadeByCell madeBy={line.madeBy} />}
      {showRecordings && (
        <ActorTakeCell
          source={section.source}
          file={line.file}
          recording={line.recording ?? null}
          onChanged={() => onRecordingChanged(line)}
        />
      )}

      <td className="py-1.5 pr-1 pl-2">
        <RowActions
          badge={
            // Beside the actions rather than in a column of its own: it is the same subject.
            <ReportsBadge source={section.source} lineId={line.id} count={line.reportsOpen} canTriage={canTriage} />
          }
          primary={[
            // Rewriting the prose is free and not an audio action, so it has its own gate: a
            // translator writes a language they may not regenerate.
            ...(canEdit
              ? [{ label: "Edit", aria: `Edit the text of ${line.name}`, title: "Rewrite this line's text", onClick: () => onEditText(line) }]
              : []),
            // An override changes only what the team's take says, so it needs what regenerating needs.
            ...(canRegenerate && overridable
              ? [
                  {
                    label: "Override",
                    aria: `Override the text of ${line.name}`,
                    title: "Change what your team says",
                    marked: Boolean(line.override),
                    onClick: () => onOverride(line),
                  },
                ]
              : []),
          ]}
          regenerate={
            canRegenerate && !unwritten ? (
              <RegenerateButton withLabel busy={state?.phase === "busy"} blocked={null} onClick={() => onRegenerate(line)} />
            ) : undefined
          }
          more={[
            // Outside the edit gates: reporting is what a visitor who cannot sign in has.
            ...(onReport ? [{ label: "Report a problem", aria: `Report ${line.name}`, onClick: () => onReport(line) }] : []),
            // Only on a dirty row: a clean one would be offering to clear nothing.
            ...(canRegenerate && line.dirty && !unwritten
              ? [
                  {
                    label: "Clear the pronunciation mark",
                    aria: `Clear the pronunciation mark on ${line.name}`,
                    title: "The take stays; only the mark goes",
                    onClick: () => onClearDirty(line),
                  },
                ]
              : []),
          ] satisfies RowAction[]}
        />
      </td>
    </tr>
  );
}
