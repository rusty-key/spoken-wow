"use client";

import { Fragment, useMemo } from "react";

import { useUiText } from "@/components/UiTextProvider";

import { BookHeader, PageRow, type RowState } from "@/components/readables/PageRow";
import type { ResultLine } from "@/lib/readables/search";

/**
 * The results, as a table of pages under a heading per book.
 *
 * Same shape as the other two explorers, with the difference these lines have: a page is only
 * half-meaningful without the book around it, so the title and what opens it are written once
 * above its pages.
 */
type Props = {
  lines: ResultLine[];
  current: ResultLine | null;
  /** Whether to draw "Made by": the search sent it, so the viewer works in the language. */
  showMadeBy: boolean;
  /** Whether to draw the voice actor column: the search sent recordings. */
  showRecordings: boolean;
  onRecordingChanged: (line: ResultLine) => void;
  canRegenerate: boolean;
  canEdit: boolean;
  canTriage: boolean;
  rowStates: Record<string, RowState>;
  onPlay: (line: ResultLine) => void;
  onRegenerate: (line: ResultLine) => void;
  /** Narrowing to one book, from its name. */
  onSelectBook: (line: ResultLine) => void;
  bookHref: (line: ResultLine) => string;
  /** Open the report dialog; null in another team's view. */
  onReport: ((line: ResultLine) => void) | null;
  /** An earlier take is live again. */
  onRestored: (line: ResultLine, version: number) => void;
  /** Rewrite what a page says. Editor and up. */
  onEditText: (line: ResultLine) => void;
  onOverride: (line: ResultLine) => void;
  onOverrideAnswered: (line: ResultLine) => void;
  onRename: ((line: ResultLine) => void) | null;
  /** Say a take is fine as it stands, despite a pronunciation having moved under it. */
  onClearDirty: (line: ResultLine) => void;
};

/**
 * How many rows each book occupies here, against the line that starts its run.
 *
 * Counted over the rows actually being drawn, never from `pageCount`: a filter can show
 * three pages of a twenty-page journal, and paging can split a book across two screens. A
 * rowspan longer than the rows under it pushes every following row one column to the right,
 * which is the whole table sliding sideways from one number being taken on trust.
 *
 * The search orders by title then book then page, so a book's rows are contiguous and this
 * is a walk rather than a grouping pass.
 */
export function bookRuns(lines: ResultLine[]): Map<string, number> {
  const sizes = new Map<string, number>();

  for (let i = 0; i < lines.length; ) {
    let end = i;
    while (end < lines.length && lines[end].bookId === lines[i].bookId) end++;
    sizes.set(lines[i].id, end - i);
    i = end;
  }

  return sizes;
}

export function BookList({
  lines,
  current,
  showMadeBy,
  showRecordings,
  onRecordingChanged,
  canRegenerate,
  canEdit,
  canTriage,
  rowStates,
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
  const t = useUiText();
  const groupRows = useMemo(() => bookRuns(lines), [lines]);

  return (
    // Fixed layout, because the point of the columns is that they line up down the page:
    // left to auto sizing, one long book title would widen its column for every row.
    <div className="cat-list">
      <table className="cat-table w-full table-fixed border-collapse text-sm">
        <colgroup>
          <col className="w-12" />
          <col />
          <col className="w-40" />
          <col className="w-36" />
          {showMadeBy && <col className="w-36" />}
          {showRecordings && <col className="w-28" />}
          <col className="w-48" />
        </colgroup>
        <thead>
          <tr>
            <th>
              <span className="sr-only">{t.catalogue.columns.play}</span>
            </th>
            <th>{t.catalogue.columns.pageText}</th>
            <th>{t.catalogue.columns.page}</th>
            <th>{t.catalogue.columns.audio}</th>
            {showMadeBy && <th>{t.catalogue.columns.madeBy}</th>}
            {showRecordings && <th>{t.catalogue.columns.voiceActor}</th>}
            <th>
              <span className="sr-only">{t.catalogue.columns.actions}</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {lines.map((line) => (
            <Fragment key={line.id}>
              {(groupRows.get(line.id) ?? 0) > 0 && (
                <BookHeader
                  line={line}
                  columns={5 + (showMadeBy ? 1 : 0) + (showRecordings ? 1 : 0)}
                  onSelectBook={onSelectBook}
                  bookHref={bookHref}
                  onRename={onRename}
                />
              )}
              <PageRow
                line={line}
                current={current?.id === line.id}
                showMadeBy={showMadeBy}
                showRecordings={showRecordings}
                onRecordingChanged={onRecordingChanged}
                canRegenerate={canRegenerate}
                canEdit={canEdit}
                canTriage={canTriage}
                state={rowStates[line.id]}
                onPlay={onPlay}
                onRegenerate={onRegenerate}
                onClearDirty={onClearDirty}
                onReport={onReport}
                onRestored={onRestored}
                onEditText={onEditText}
                onOverride={onOverride}
                onOverrideAnswered={onOverrideAnswered}
              />
            </Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );
}
