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
import { materialName } from "@/lib/readables/filters";
import { shownText } from "@/lib/readables/shown";
import type { ResultLine } from "@/lib/readables/search";
import { cn, endsSelection } from "@/lib/utils";

export type RowState =
  | { phase: "busy" }
  | { phase: "done"; version: number }
  | { phase: "error"; message: string };

type Props = {
  line: ResultLine;
  current: boolean;
  /** Whether to draw the "Made by" cell: the search sent it, so the viewer works here. */
  showMadeBy: boolean;
  /** Whether to draw the voice actor cell: the search sent recordings, so the viewer records here. */
  showRecordings: boolean;
  onRecordingChanged: (line: ResultLine) => void;
  /** Editor and up: the regenerate control, and reading and resolving the row's reports. */
  canRegenerate: boolean;
  /** May write this page's text in the page's language, apart from regenerating it. */
  canEdit: boolean;
  canTriage: boolean;
  /**
   * How many rows this book occupies here, or 0 when this is not its first row.
   *
   * The count is the run in THIS result page, not `line.pageCount`: a filter can show three
   * pages of a twenty-page journal, and paging can split a book across two screens. A
   * rowspan longer than the rows beneath it pushes every following row one column right.
   */
  groupRows: number;
  state?: RowState;
  onPlay: (line: ResultLine) => void;
  onRegenerate: (line: ResultLine) => void;
  /** Narrowing to this book, from its name. */
  onSelectBook: (line: ResultLine) => void;
  /** The narrowed view as a link, for a click that opens it elsewhere. */
  bookHref: (line: ResultLine) => string;
  /** Reports go to the acting team, so this is null when viewing another team. */
  onReport: ((line: ResultLine) => void) | null;
  /** An earlier take is live again, so the row and the player can catch up. */
  onRestored: (line: ResultLine, version: number) => void;
  /** Rewrite what this page says. Editor and up. */
  onEditText: (line: ResultLine) => void;
  /** Change what the acting team's audio says for the page. */
  onOverride: (line: ResultLine) => void;
  /** A drifted override was kept or dropped. */
  onOverrideAnswered: (line: ResultLine) => void;
  /** Name the book's owner in the page's language; null on the English site or without `text`. */
  onRename: ((line: ResultLine) => void) | null;
  /** Say this take is fine as it stands, despite a pronunciation having moved under it. */
  onClearDirty: (line: ResultLine) => void;
};

// The same colour discipline as the other two explorers: red is only ever a real problem,
// amber is something that has drifted, grey is a fact about the row.
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

export function PageRow({
  line,
  current,
  showMadeBy,
  showRecordings,
  onRecordingChanged,
  canRegenerate,
  canEdit,
  canTriage,
  groupRows,
  state,
  onPlay,
  onRegenerate,
  onSelectBook,
  bookHref,
  onClearDirty,
  onReport,
  onRestored,
  onEditText,
  onOverride,
  onOverrideAnswered,
  onRename,
}: Props) {
  const playable = line.state !== "missing";
  const [expanded, setExpanded] = useState(false);

  /**
   * Clicking the row shows the whole page, but only when the click meant that.
   *
   * Two things it must not swallow: a click that landed on a control is that control's
   * business, and a click ending a drag over the prose is somebody copying it -- which is
   * half of what this cell is for on a page of a book.
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
        // The first row of a book carries the heavier rule, so the books stay legible as
        // blocks once their name is written only once.
        groupRows > 0 && "border-t-border border-t",
      )}
    >
      {/* Written once per book and spanning its pages, the way the zone column reads as one
          zone rather than as the same word forty times. Only on the run's first row: the
          rows beneath it have no cell here at all. */}
      {groupRows > 0 && (
        <>
          <td rowSpan={groupRows} className="border-border/60 border-r px-2 py-2">
            <FilterLink
              href={bookHref(line)}
              onApply={() => onSelectBook(line)}
              className="hover:text-foreground block max-w-full text-left font-medium break-words underline-offset-2 hover:underline"
              title={`Show only ${line.title}`}
            >
              <Untranslated missing={line.missing?.title}>{line.title}</Untranslated>
            </FilterLink>
            {onRename && (
              <RenameButton label={`Name ${line.title}`} onClick={() => onRename(line)} />
            )}
          </td>

          <td
            rowSpan={groupRows}
            className="text-muted-foreground border-border/60 border-r px-2 py-2 text-xs"
          >
            <div>{line.ownerKind === "object" ? "in the world" : "carried"}</div>
            <div>{materialName(line.material)}</div>
            <div>{line.pageCount === 1 ? "1 page" : `${line.pageCount} pages`}</div>
            {/* Which object or item opens it. More than one is common, and two objects
                sharing a name is exactly why the addon needs a checksum. */}
            <div className="mt-1 font-mono break-words opacity-70">
              {line.ownerIds.join(", ")}
            </div>
          </td>
        </>
      )}

      <td className="text-muted-foreground px-2 py-2 text-xs whitespace-nowrap">
        {line.pageCount > 1 ? `${line.pageNumber} / ${line.pageCount}` : "—"}
      </td>

      {/* The prose is plain markup rather than a button's label, which is what makes it
          selectable: text inside a <button> cannot reliably be dragged over and copied.
          That is why playing needs a control of its own. */}
      <td className="p-0">
        <div className="flex w-full min-w-0 items-start gap-2 px-2 py-2">
          <button
            aria-current={current}
            disabled={!playable}
            onClick={() => onPlay(line)}
            title={playable ? `${line.file}.mp3` : undefined}
            aria-label={`Play page ${line.pageNumber} of ${line.title}`}
            className="cat-play"
          >
            <PlayIcon />
          </button>

          <div className="min-w-0 flex-1">
            <span className={cn("block whitespace-pre-wrap", !expanded && "clamp-2")}>
              <Untranslated missing={line.missing?.text}>{shownText(line)}</Untranslated>
            </span>
            {/* Under the original rather than in its place: the original is what the page and
                the game still show, and the override is only what the team's take says. */}
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
                source="readables"
                lineId={line.id}
                text={line.override.text}
                onAnswered={() => onOverrideAnswered(line)}
              />
            )}
          </div>
          {line.missing?.text ? (
            <span className="mt-0.5 shrink-0 text-xs">
              <UntranslatedMark />
            </span>
          ) : null}

          {/* A row click is a mouse gesture and reaches no keyboard, so the same toggle
              needs a real control. It doubles as the only thing saying rows expand. */}
          <button
            aria-expanded={expanded}
            aria-label={expanded ? "Collapse this page" : "Show the whole page"}
            title={expanded ? "Collapse" : "Show the whole page"}
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

      {/* Audio, in a column of its own rather than floated into the prose: the point of a
          column is that it lines up down the page, and "which of these has no clip yet" is
          the question this screen is most often asked. */}
      <td className="px-2 py-2 text-xs whitespace-nowrap">
        {state?.phase === "error" ? (
          <StateWord tone="error">{state.message}</StateWord>
        ) : state?.phase === "done" ? (
          <StateWord tone="current">v{state.version}</StateWord>
        ) : !line.generatable ? (
          // Why this page is silent, rather than leaving it looking merely un-narrated. It
          // is in the corpus because the game has it.
          <span className="text-muted-foreground italic">{line.skipReason}</span>
        ) : STATE_LABEL[line.state] ? (
          <StateWord tone={STATE_TONE[line.state]}>{STATE_LABEL[line.state]}</StateWord>
        ) : (
          // Which take is live, and the way to any other. The label IS the control: the
          // number is the question, and "which other numbers are there" is what a click
          // asks. Only where there is audio to have takes of.
          <TakeSelector
            source="readables"
            file={line.file}
            version={line.take?.version ?? null}
            canRestore={canRegenerate}
            takes={line.take?.takes ?? 0}
            onRestored={(version) => onRestored(line, version)}
          />
        )}
        {/* Beneath the state rather than inside it: the text has not moved, so this page is
            `current` and dirty at once, and one word cannot say both. */}
        {line.dirty && (
          <div className="text-amber-300" title="Cut before a pronunciation it speaks was changed">
            pronunciation
          </div>
        )}
      </td>

      {showMadeBy && <MadeByCell madeBy={line.madeBy} />}
      {showRecordings && (
        <ActorTakeCell
          source="readables"
          file={line.file}
          recording={line.recording ?? null}
          onChanged={() => onRecordingChanged(line)}
        />
      )}

      <td className="text-muted-foreground px-2 py-2 text-right text-xs whitespace-nowrap">
        {line.chars}
      </td>

      {/* One line, like the other two explorers': the controls read left to right and the
          column keeps its width whatever a row happens to offer. */}
      <td className="py-1.5 pr-1 pl-2">
        <RowActions
          subject={`page ${line.pageNumber} of ${line.title}`}
          badge={
            // The same chip the quests and places rows carry; ReportsBadge says why.
            <ReportsBadge source="readables" lineId={line.id} count={line.reportsOpen} canTriage={canTriage} />
          }
          primary={[
            // Rewriting is free and not an audio action, gated as the other two sections gate theirs.
            ...(canEdit
              ? [{ label: "Edit", aria: `Edit the text of page ${line.pageNumber} of ${line.title}`, title: "Rewrite what this page says", onClick: () => onEditText(line) }]
              : []),
            // An override changes only what the team's take says, so it needs what regenerating
            // needs. English standing in for the language is not this language's text to override.
            ...(canRegenerate && !line.missing?.text
              ? [{ label: "Override", aria: `Override the text of page ${line.pageNumber} of ${line.title}`, title: "Change what your team says", onClick: () => onOverride(line) }]
              : []),
          ]}
          regenerate={
            canRegenerate ? (
              <RegenerateButton
                withLabel
                onClick={() => onRegenerate(line)}
                busy={state?.phase === "busy"}
                blocked={line.generatable ? null : `this page cannot be voiced: ${line.skipReason}`}
              />
            ) : undefined
          }
          more={[
            // Outside the edit gates: reporting is what a reader who cannot sign in has.
            ...(onReport ? [{ label: "Report a problem", aria: `Report page ${line.pageNumber} of ${line.title}`, onClick: () => onReport(line) }] : []),
            // Only on a dirty row: a clean one would be offering to clear nothing.
            ...(canRegenerate && line.dirty
              ? [
                  {
                    label: "Clear the pronunciation mark",
                    aria: `Clear the pronunciation mark on page ${line.pageNumber} of ${line.title}`,
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
