"use client";

import ActorTakeCell from "@/components/ActorTakeCell";
import { MadeByCell } from "@/components/MadeBy";
import { RenameButton } from "@/components/RenameButton";
import { Untranslated, UntranslatedMark } from "@/components/Untranslated";
import FilterLink from "@/components/FilterLink";
import { ChevronDownIcon, Eraser, FlagIcon, PencilIcon, PlayIcon } from "lucide-react";
import { useState } from "react";

import RegenerateButton from "@/components/RegenerateButton";
import ReportsBadge from "@/components/ReportsBadge";
import TakeSelector from "@/components/TakeSelector";
import { Button } from "@/components/ui/button";
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
  /** Open the report dialog. Everyone gets this, signed in or not. */
  onReport: (line: ResultLine) => void;
  /** An earlier take is live again, so the row and the player can catch up. */
  onRestored: (line: ResultLine, version: number) => void;
  /** Rewrite what this page says. Editor and up. */
  onEditText: (line: ResultLine) => void;
  /** Name the book's owner in the page's language; null on the English site or without `text`. */
  onRename: ((line: ResultLine) => void) | null;
  /** Say this take is fine as it stands, despite a pronunciation having moved under it. */
  onClearDirty: (line: ResultLine) => void;
};

// The same colour discipline as the other two explorers: red is only ever a real problem,
// amber is something that has drifted, grey is a fact about the row.
const STATE_STYLE = {
  missing: "text-destructive",
  stale: "text-amber-300",
  current: "text-muted-foreground",
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
        current && "bg-muted",
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
            className={cn(
              "mt-px shrink-0 rounded-sm p-0.5",
              "focus-visible:ring-ring/50 focus-visible:ring-[3px] focus-visible:outline-none",
              playable
                ? "text-muted-foreground hover:text-foreground cursor-pointer"
                : "text-muted-foreground/30 cursor-default",
              current && "text-foreground",
            )}
          >
            <PlayIcon className="size-3.5" />
          </button>

          <span className={cn("min-w-0 flex-1 whitespace-pre-wrap", !expanded && "clamp-2")}>
            <Untranslated missing={line.missing?.text}>{shownText(line)}</Untranslated>
          </span>
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
          <span className="text-destructive">{state.message}</span>
        ) : state?.phase === "done" ? (
          <span className="text-emerald-400">v{state.version}</span>
        ) : !line.generatable ? (
          // Why this page is silent, rather than leaving it looking merely un-narrated. It
          // is in the corpus because the game has it.
          <span className="text-muted-foreground italic">{line.skipReason}</span>
        ) : STATE_LABEL[line.state] ? (
          <span className={STATE_STYLE[line.state]}>{STATE_LABEL[line.state]}</span>
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
        <span className="flex items-center justify-end gap-1 whitespace-nowrap">
        {/* The same chip the quests and places rows carry; ReportsBadge says why. Readables has
            no separate triage flag: the editors who regenerate a page are the ones who
            answer for it. */}
        <ReportsBadge
          source="readables"
          lineId={line.id}
          count={line.reportsOpen}
          canTriage={canTriage}
        />
        {/* Outside the canRegenerate gate, deliberately: reporting is what a reader who
            cannot sign in has, and /api/reports is unauthenticated for the same reason.
            Every page has an address -- it is the page id the addon builds its link from --
            so unlike a quests row there is no case where this is hidden. */}
        <Button
          variant="ghost"
          size="icon"
          title="Report a problem with this page"
          aria-label={`Report page ${line.pageNumber} of ${line.title}`}
          onClick={() => onReport(line)}
        >
          <FlagIcon className="size-3.5" />
        </Button>
        {/* Rewriting the text is not an audio action and it is free, but it is gated the
            same way the other two sections gate theirs: the edit is what a later
            regeneration would speak. */}
        {canEdit && (
          <Button
            variant="ghost"
            size="icon"
            title="Rewrite what this page says"
            aria-label={`Edit the text of page ${line.pageNumber} of ${line.title}`}
            onClick={() => onEditText(line)}
          >
            <PencilIcon className="size-3.5" />
          </Button>
        )}
        {/* Only on a dirty row: a clean one keeps the single control it already had. */}
        {canRegenerate && line.dirty && (
          <Button
            variant="ghost"
            size="icon"
            title="Audio predates a pronunciation change - clear the mark (does not regenerate)"
            aria-label={`Clear the pronunciation mark on page ${line.pageNumber} of ${line.title}`}
            onClick={() => onClearDirty(line)}
          >
            <Eraser className="size-3.5" />
          </Button>
        )}
        {canRegenerate && (
          <RegenerateButton
            onClick={() => onRegenerate(line)}
            busy={state?.phase === "busy"}
            blocked={line.generatable ? null : `this page cannot be voiced: ${line.skipReason}`}
          />
        )}
        </span>
      </td>
    </tr>
  );
}
