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
  state?: RowState;
  onPlay: (line: ResultLine) => void;
  onRegenerate: (line: ResultLine) => void;
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

/**
 * The heading over one book's pages, which the search returns together: the title, what opens it
 * and which objects or items do, written once rather than in two columns beside every page.
 */
export function BookHeader({
  line,
  columns,
  onSelectBook,
  bookHref,
  onRename,
}: {
  line: ResultLine;
  columns: number;
  onSelectBook: (line: ResultLine) => void;
  bookHref: (line: ResultLine) => string;
  onRename: ((line: ResultLine) => void) | null;
}) {
  const t = useUiText();
  return (
    <tr className="cat-group">
      <th colSpan={columns} scope="colgroup">
        <FilterLink href={bookHref(line)} onApply={() => onSelectBook(line)} className="cat-group-name" title={fill(t.catalogue.row.showOnly, { name: line.title })}>
          <Untranslated missing={line.missing?.title}>{line.title}</Untranslated>
        </FilterLink>
        {onRename && <RenameButton label={fill(t.catalogue.row.nameIt, { name: line.title })} onClick={() => onRename(line)} />}
        <span className="cat-group-meta">
          {line.ownerKind === "object" ? t.catalogue.row.inWorld : t.catalogue.row.carried} · {materialName(line.material)} ·{" "}
          {line.pageCount === 1 ? t.catalogue.row.pagesOne : fill(t.catalogue.row.pagesMany, { n: line.pageCount })}
          {/* Which object or item opens it: two objects sharing a name is why the addon needs a checksum. */}
          <span className="cat-ids"> · {line.ownerIds.join(", ")}</span>
        </span>
      </th>
    </tr>
  );
}

export function PageRow({
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
  onRegenerate,
  onClearDirty,
  onReport,
  onRestored,
  onEditText,
  onOverride,
  onOverrideAnswered,
}: Props) {
  const playable = line.state !== "missing";
  const t = useUiText();
  const [expanded, setExpanded] = useState(false);
  // Missing or outdated audio makes generating the row's task: a gold button, not a menu item.
  const needsTake = canRegenerate && line.generatable && (line.state === "missing" || line.state === "stale");
  const generate: RowAction = {
    label: line.state === "missing" ? t.catalogue.row.generate : t.catalogue.row.regenerate,
    aria: fill(
      line.state === "missing" ? t.catalogue.row.actions.generateForPage : t.catalogue.row.actions.regenerateForPage,
      { page: line.pageNumber, title: line.title },
    ),
    disabled: !line.generatable
      ? fill(t.catalogue.row.actions.cannotVoice, { reason: line.skipReason ?? "" })
      : state?.phase === "busy"
        ? t.catalogue.row.generatingAlready
        : undefined,
    emphasis: needsTake,
    onClick: () => onRegenerate(line),
  };

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
      className={cn("cat-tr", current && "cat-current")}
    >
      <td className="cat-cell-play">
        {/* Play is its own control: text inside a <button> cannot reliably be selected and copied. */}
        <button
          aria-current={current}
          disabled={!playable}
          onClick={() => onPlay(line)}
          title={playable ? `${line.file}.mp3` : undefined}
          aria-label={fill(t.catalogue.row.actions.playForPage, { page: line.pageNumber, title: line.title })}
          className="cat-play"
        >
          <PlayIcon />
        </button>
      </td>

      <td>
        <div className="cat-line">
          <div className="min-w-0 flex-1">
            <span className={cn("block whitespace-pre-wrap", !expanded && "line-clamp-1")}>
              <Untranslated missing={line.missing?.text}>{shownText(line)}</Untranslated>
            </span>
            {/* Under the original rather than in its place: the original is what the page and
                the game still show, and the override is only what the team's take says. */}
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
                source="readables"
                lineId={line.id}
                text={line.override.text}
                onAnswered={() => onOverrideAnswered(line)}
              />
            )}
          </div>
          {line.missing?.text ? (
            <span className="cat-tags">
              <UntranslatedMark />
            </span>
          ) : null}

          {/* A row click is a mouse gesture and reaches no keyboard, so the same toggle
              needs a real control. It doubles as the only thing saying rows expand. */}
          <button
            aria-expanded={expanded}
            aria-label={expanded ? t.catalogue.row.collapsePage : t.catalogue.row.showWholePage}
            title={expanded ? t.catalogue.row.collapseShort : t.catalogue.row.showWholePage}
            onClick={() => setExpanded((open) => !open)}
            className="cat-expand"
          >
            <ChevronDownIcon className={cn("size-3.5 transition-transform", expanded && "rotate-180")} />
          </button>
        </div>
      </td>

      <td>
        <span className="cat-two-top">{line.pageCount > 1 ? fill(t.catalogue.pageOf, { page: line.pageNumber, count: line.pageCount }) : t.catalogue.row.onePage}</span>
        <span className="cat-two-sub">{line.chars} characters</span>
      </td>

      {/* Audio, in a column of its own rather than floated into the prose: the point of a
          column is that it lines up down the page, and "which of these has no clip yet" is
          the question this screen is most often asked. */}
      <td className="whitespace-nowrap">
        {state?.phase === "busy" ? (
          <StateWord tone="skip">{t.catalogue.row.generating}</StateWord>
        ) : state?.phase === "error" ? (
          <StateWord tone="error">{state.message}</StateWord>
        ) : state?.phase === "done" ? (
          <StateWord tone="current">v{state.version}</StateWord>
        ) : !line.generatable ? (
          // Why this page is silent, rather than leaving it looking merely un-narrated. It
          // is in the corpus because the game has it.
          <span className="text-muted-foreground italic">{line.skipReason}</span>
        ) : line.state !== "current" ? (
          <StateWord tone={STATE_TONE[line.state]}>
            {line.state === "missing" ? t.catalogue.row.noAudio : t.catalogue.row.outdated}
          </StateWord>
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
          <div className="text-amber-300" title={t.catalogue.row.pronunciationMovedWhy}>
            {t.catalogue.row.pronunciationMoved}
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

      <td className="cat-cell-actions">
        <RowActions
          subject={fill(t.catalogue.row.actions.pageSubject, { page: line.pageNumber, title: line.title })}
          badge={
            <ReportsBadge source="readables" lineId={line.id} count={line.reportsOpen} canTriage={canTriage} />
          }
          primary={[
            // Gated although free: the edit is what a later regeneration would speak.
            ...(canEdit
              ? [{ label: t.catalogue.row.edit, aria: fill(t.catalogue.row.actions.editTextForPage, { page: line.pageNumber, title: line.title }), title: t.catalogue.row.editPageTitle, onClick: () => onEditText(line) }]
              : []),
            ...(needsTake ? [generate] : []),
          ]}
          more={[
            ...(canRegenerate && !needsTake ? [generate] : []),
            // An override changes only what the team's take says, so it needs what regenerating
            // needs. English standing in for the language is not this language's text to override.
            ...(canRegenerate && !line.missing?.text
              ? [
                  {
                    label: t.catalogue.row.override,
                    aria: fill(t.catalogue.row.actions.overrideForPage, { page: line.pageNumber, title: line.title }),
                    title: t.catalogue.row.overrideTitle,
                    marked: line.override !== null,
                    onClick: () => onOverride(line),
                  },
                ]
              : []),
            // Outside the edit gates: reporting is what a reader who cannot sign in has.
            ...(onReport ? [{ label: t.catalogue.row.report, aria: fill(t.catalogue.row.actions.reportForPage, { page: line.pageNumber, title: line.title }), onClick: () => onReport(line) }] : []),
            // Only on a dirty row: a clean one would be offering to clear nothing.
            ...(canRegenerate && line.dirty
              ? [
                  {
                    label: t.catalogue.row.clearMark,
                    aria: fill(t.catalogue.row.actions.clearMarkForPage, { page: line.pageNumber, title: line.title }),
                    title: t.catalogue.row.clearMarkTitle,
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
