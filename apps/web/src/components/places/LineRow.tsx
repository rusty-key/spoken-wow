"use client";

import ActorTakeCell from "@/components/ActorTakeCell";
import { MadeByCell } from "@/components/MadeBy";
import { RenameButton } from "@/components/RenameButton";
import { Untranslated, UntranslatedMark } from "@/components/Untranslated";
import FilterLink from "@/components/FilterLink";
import { ChevronDownIcon, PlayIcon } from "lucide-react";

import { RowActions, StateWord, type RowAction } from "@/components/catalogue/RowParts";
import { useUiText } from "@/components/UiTextProvider";
import { fill } from "@/lib/site-text/format";
import { useState } from "react";

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
  section: Pick<ExplorerSection<L>, "source" | "facetLabel" | "ownLine" | "detail">;
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

/**
 * The heading over one zone's or instance's lines, which the results come grouped by. A click
 * narrows the list to it.
 */
export function GroupHeader<L extends ExplorerLine>({
  section,
  line,
  columns,
  onNarrow,
  href,
}: {
  section: Pick<ExplorerSection<L>, "chip">;
  line: L;
  columns: number;
  onNarrow: (line: L) => void;
  href: (line: L) => string;
}) {
  const chip = section.chip(line);
  return (
    <tr className="cat-group">
      <th colSpan={columns} scope="colgroup">
        {chip === null ? null : (
          <FilterLink href={href(line)} onApply={() => onNarrow(line)} className="cat-group-name" title={`Show only ${chip}`}>
            <Untranslated missing={line.zoneNameMissing}>{chip}</Untranslated>
          </FilterLink>
        )}
      </th>
    </tr>
  );
}

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
  const t = useUiText();
  const [expanded, setExpanded] = useState(false);
  // Missing or outdated audio makes generating the row's task: a gold button, not a menu item.
  const needsTake = canRegenerate && !unwritten && (line.state === "missing" || line.state === "stale");
  const generate: RowAction = {
    label: line.state === "missing" ? t.catalogue.row.generate : t.catalogue.row.regenerate,
    aria: fill(
      line.state === "missing" ? t.catalogue.row.actions.generateForPlace : t.catalogue.row.actions.regenerateForPlace,
      { subject: line.name },
    ),
    disabled: state?.phase === "busy" ? t.catalogue.row.generatingAlready : undefined,
    emphasis: needsTake,
    onClick: () => onRegenerate(line),
  };

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
      className={cn("cat-tr", current && "cat-current")}
    >
      <td className="cat-cell-play">
        {/* Play is its own control: text inside a <button> cannot reliably be selected and copied. */}
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
      </td>

      <td>
        <div className="cat-line">
          {/* An untranslated line shows the English in its place, marked as such, so the
              reader still sees what the line is about and that it is waiting to be written. */}
          {unwritten ? (
            <span className="text-muted-foreground min-w-0 flex-1 italic">{t.catalogue.row.noStory}</span>
          ) : (
            <div className="min-w-0 flex-1">
              <span className={cn("block whitespace-pre-wrap", !expanded && "line-clamp-1")}>
                <Untranslated missing={line.translated === false}>{line.text}</Untranslated>
              </span>
              {/* Under the original rather than in its place: the original is what the page
                  and the game still show, and the override is only what the team's take says. */}
              {line.override && (
                <span
                  className={cn("cat-override", !expanded && "line-clamp-1")}
                  title={t.catalogue.row.overrideSays}
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
            <span className="cat-tags">
              <UntranslatedMark />
            </span>
          ) : null}
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
        <span className="cat-two-top">
          {section.ownLine?.(line) ? (
            <span className="text-muted-foreground italic">{section.facetLabel.toLowerCase()} line</span>
          ) : (
            <Untranslated missing={line.nameMissing}>{line.name}</Untranslated>
          )}
          {onRename && <RenameButton label={`Name ${line.name}`} onClick={() => onRename(line)} />}
        </span>
        {section.detail && <span className="cat-two-sub">{section.detail(line)}</span>}
      </td>

      {/* Audio, in a column of its own rather than floated into the prose, the way the
          readables table has always had it: the point of a column is that it lines up down the
          page, and "which of these has no clip yet" is the question this screen is most
          often asked. It holds what the clip's state is, and which take that clip is. */}
      <td className="whitespace-nowrap">
        {/* The regeneration outcome replaces the state: once a line has just been made,
            "no audio" is stale and confusing rather than merely redundant. */}
        {state?.phase === "busy" ? (
          <StateWord tone="skip">{t.catalogue.row.generating}</StateWord>
        ) : state?.phase === "error" ? (
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
          <div className="text-amber-300" title={t.catalogue.row.pronunciationMoved}>
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

      <td className="cat-cell-actions">
        <RowActions
          subject={line.name}
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
            ...(needsTake ? [generate] : []),
          ]}
          more={[
            ...(canRegenerate && !unwritten && !needsTake ? [generate] : []),
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
            // Outside the edit gates: reporting is what a visitor who cannot sign in has.
            ...(onReport ? [{ label: "Report a problem", aria: `Report a problem with ${line.name}`, onClick: () => onReport(line) }] : []),
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
