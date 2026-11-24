"use client";

import {
  CatalogueSearch,
  FilterGroup,
  FilterSegments,
  FilterSelect,
  FilterToggle,
  ScopeSelect,
  type ActiveFilter,
  type Option,
} from "@/components/catalogue/CatalogueSearch";
import { useUiText } from "@/components/UiTextProvider";
import type { MadeByFacets } from "@/lib/takes/made-by";
import type { StateCounts } from "@/lib/audio-state";
import type { BookFacet } from "@/lib/readables/catalogue";
import { RECORDED_OPTIONS, type Recorded } from "@/lib/recordings/live";
import { fill } from "@/lib/site-text/format";
import { FIELDS, OWNER_KINDS, type PageFilters } from "@/lib/readables/filters";


type Props = {
  books: BookFacet[];
  filters: PageFilters;
  query: string;
  inputRef: React.RefObject<HTMLInputElement | null>;
  onQueryChange: (value: string) => void;
  onQuerySubmit: () => void;
  onChange: (next: Partial<PageFilters>) => void;
  onClearAll: () => void;
  canTriage: boolean;
  madeBy?: MadeByFacets;
  recordable?: boolean;
  /** The last answer's counts, for the audio buttons; absent before the first. */
  counts?: StateCounts;
};

const labelOf = (options: readonly Option[], value: string) =>
  options.find((option) => option.value === value)?.label ?? value;

export function SearchBar({
  books,
  filters,
  query,
  inputRef,
  onQueryChange,
  onQuerySubmit,
  onChange,
  onClearAll,
  canTriage,
  madeBy,
  recordable,
  counts,
}: Props) {
  const bookOptions: Option[] = books.map((book) => ({
    value: book.bookId,
    label: book.pages > 1 ? `${book.title} (${book.pages} pages)` : book.title,
  }));
  const text = useUiText();
  const s = text.catalogue.search;
  const f = s.fields;
  const v = s.values;
  const l = s.labels;
  const facetsText = text.catalogue.facets;
  const recordedOptions = RECORDED_OPTIONS.map((option) => ({ value: option.value, label: facetsText.recorded[option.value] }));
  const fieldOptions: Option[] = FIELDS.map((field) => ({
    value: field,
    label: field === "any" ? s.scopes.any : field === "title" ? l.bookTitleField : l.bookText,
  }));
  const kindOptions: Option[] = OWNER_KINDS.map((kind) => ({
    value: kind,
    label: kind === "object" ? l.inTheWorld : l.carriedItems,
  }));
  const voiceableOptions: Option[] = [
    { value: "yes", label: l.voiceableYes },
    { value: "no", label: l.voiceableNo },
  ];
  const authors: Option[] = madeBy?.authors.map(({ id, name }) => ({ value: id, label: name })) ?? [];
  const voiceable = filters.voiceable === undefined ? undefined : filters.voiceable ? "yes" : "no";

  // Triagers only: the count on a row is public, but a list of complaints is a worklist.
  const statuses = canTriage
    ? [
        {
          key: "reported",
          label: f.reports,
          tone: "reported" as const,
          pressed: filters.reports === "open",
          onPress: () => onChange({ reports: filters.reports === "open" ? undefined : "open" }),
        },
      ]
    : [];

  const active: ActiveFilter[] = [];
  const add = (key: string, label: string, value: string | undefined, clear: Partial<PageFilters>) => {
    if (value) active.push({ key, label, value, onRemove: () => onChange(clear) });
  };
  add("state", f.state, filters.state ? facetsText.audioLower[filters.state] : undefined, { state: undefined });
  add("reports", f.reports, filters.reports === "open" ? v.open : undefined, { reports: undefined });
  add("bookId", l.book, filters.bookId ? labelOf(bookOptions, filters.bookId) : undefined, { bookId: undefined });
  add("ownerKind", l.openedFrom, filters.ownerKind ? labelOf(kindOptions, filters.ownerKind) : undefined, { ownerKind: undefined });
  add("voiceable", l.voiceable, voiceable ? labelOf(voiceableOptions, voiceable) : undefined, { voiceable: undefined });
  add("model", f.model, filters.model, { model: undefined });
  add("author", f.author, filters.author ? labelOf(authors, filters.author) : undefined, { author: undefined });
  add("recorded", f.recorded, filters.recorded ? labelOf(recordedOptions, filters.recorded) : undefined, { recorded: undefined });
  add("dirty", f.dirty, filters.dirty ? v.moved : undefined, { dirty: undefined });

  return (
    <CatalogueSearch
      inputRef={inputRef}
      query={query}
      placeholder={l.bookTitle}
      onQueryChange={onQueryChange}
      onQuerySubmit={onQuerySubmit}
      scope={
        <ScopeSelect
          value={filters.field ?? "any"}
          options={fieldOptions}
          onChange={(field) => onChange({ field: field as PageFilters["field"] })}
        />
      }
      statuses={statuses}
      audio={{ state: filters.state, counts, onState: (state) => onChange({ state }) }}
      onShowAll={() => onChange({ state: undefined, reports: undefined })}
      active={active}
      onClearAll={onClearAll}
      groups={
        <>
          <FilterGroup title={l.bookGroup} description={l.bookHint}>
            <FilterSelect label={l.book} value={filters.bookId} options={bookOptions} onChange={(bookId) => onChange({ bookId })} />
            <FilterSegments
              label={l.openedFrom}
              value={filters.ownerKind}
              options={kindOptions}
              onChange={(ownerKind) => onChange({ ownerKind: ownerKind as PageFilters["ownerKind"] })}
            />
            <FilterSegments
              label={l.voiceable}
              value={voiceable}
              options={voiceableOptions}
              onChange={(value) => onChange({ voiceable: value ? value === "yes" : undefined })}
            />
          </FilterGroup>

          {(madeBy || recordable) && (
            <FilterGroup title={s.groups.take} description={s.groups.takeHint}>
              {madeBy && (
                <>
                  <FilterSelect label={f.model} value={filters.model} options={madeBy.models.map((value) => ({ value, label: value }))} onChange={(model) => onChange({ model })} />
                  <FilterSelect label={f.author} any={v.anyone} value={filters.author} options={authors} onChange={(author) => onChange({ author })} />
                </>
              )}
              {recordable && (
                <FilterSelect
                  label={f.recorded}
                  value={filters.recorded}
                  options={recordedOptions}
                  onChange={(recorded) => onChange({ recorded: recorded as Recorded | undefined })}
                />
              )}
            </FilterGroup>
          )}

          <FilterGroup title={l.markedPages} description={l.markedPagesHint}>
            {/* Not a value of "audio": a page can be up to date and carry this at once. */}
            <FilterToggle label={l.pronunciationMoved} checked={filters.dirty ?? false} onChange={(dirty) => onChange({ dirty: dirty || undefined })} />
          </FilterGroup>
        </>
      }
    />
  );
}
