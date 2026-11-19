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
import type { MadeByFacets } from "@/lib/takes/made-by";
import { AUDIO_STATE_LABELS, type StateCounts } from "@/lib/audio-state";
import type { BookFacet } from "@/lib/readables/catalogue";
import { RECORDED_OPTIONS, type Recorded } from "@/lib/recordings/live";
import { FIELDS, OWNER_KINDS, type PageFilters } from "@/lib/readables/filters";

const FIELD_NAMES: Record<(typeof FIELDS)[number], string> = { any: "Anywhere", title: "Title", text: "Page text" };
const FIELD_OPTIONS: Option[] = FIELDS.map((field) => ({ value: field, label: FIELD_NAMES[field] }));

const KIND_OPTIONS: Option[] = OWNER_KINDS.map((kind) => ({
  value: kind,
  label: kind === "object" ? "In the world" : "Carried items",
}));

const VOICEABLE_OPTIONS: Option[] = [
  { value: "yes", label: "Voiceable" },
  { value: "no", label: "Not voiceable" },
];

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
  const authors: Option[] = madeBy?.authors.map(({ id, name }) => ({ value: id, label: name })) ?? [];
  const voiceable = filters.voiceable === undefined ? undefined : filters.voiceable ? "yes" : "no";

  const setState = (state: PageFilters["state"]) => onChange({ state: filters.state === state ? undefined : state });
  const statuses = [
    { key: "missing", label: "Missing", tone: "missing" as const, count: counts?.missing, pressed: filters.state === "missing", onPress: () => setState("missing") },
    { key: "stale", label: "Outdated", tone: "stale" as const, count: counts?.stale, pressed: filters.state === "stale", onPress: () => setState("stale") },
    { key: "current", label: "Up to date", tone: "current" as const, count: counts?.current, pressed: filters.state === "current", onPress: () => setState("current") },
    // Triagers only: the count on a row is public, but a list of complaints is a worklist.
    ...(canTriage
      ? [
          {
            key: "reported",
            label: "Reported",
            tone: "reported" as const,
            pressed: filters.reports === "open",
            onPress: () => onChange({ reports: filters.reports === "open" ? undefined : "open" }),
          },
        ]
      : []),
  ];

  const active: ActiveFilter[] = [];
  const add = (key: string, label: string, value: string | undefined, clear: Partial<PageFilters>) => {
    if (value) active.push({ key, label, value, onRemove: () => onChange(clear) });
  };
  add("state", "Audio", filters.state && AUDIO_STATE_LABELS[filters.state], { state: undefined });
  add("reports", "Reported", filters.reports === "open" ? "open reports" : undefined, { reports: undefined });
  add("bookId", "Book", filters.bookId && labelOf(bookOptions, filters.bookId), { bookId: undefined });
  add("ownerKind", "Opened", filters.ownerKind && labelOf(KIND_OPTIONS, filters.ownerKind), { ownerKind: undefined });
  add("voiceable", "Voiceable", voiceable && labelOf(VOICEABLE_OPTIONS, voiceable), { voiceable: undefined });
  add("model", "Model", filters.model, { model: undefined });
  add("author", "Made by", filters.author && labelOf(authors, filters.author), { author: undefined });
  add("recorded", "Voice actor", filters.recorded && labelOf(RECORDED_OPTIONS, filters.recorded), { recorded: undefined });
  add("dirty", "Pronunciation", filters.dirty ? "moved" : undefined, { dirty: undefined });

  return (
    <CatalogueSearch
      inputRef={inputRef}
      query={query}
      placeholder="Book title or what the page says"
      onQueryChange={onQueryChange}
      onQuerySubmit={onQuerySubmit}
      scope={
        <ScopeSelect
          value={filters.field ?? "any"}
          options={FIELD_OPTIONS}
          onChange={(field) => onChange({ field: field as PageFilters["field"] })}
        />
      }
      statuses={statuses}
      allCount={counts?.all}
      onShowAll={() => onChange({ state: undefined, reports: undefined })}
      active={active}
      onClearAll={onClearAll}
      groups={
        <>
          <FilterGroup title="The book" description="Which book, and where a player finds it.">
            <FilterSelect label="Book" value={filters.bookId} options={bookOptions} onChange={(bookId) => onChange({ bookId })} />
            <FilterSegments
              label="Opened from"
              value={filters.ownerKind}
              options={KIND_OPTIONS}
              onChange={(ownerKind) => onChange({ ownerKind: ownerKind as PageFilters["ownerKind"] })}
            />
            <FilterSegments
              label="Voiceable"
              value={voiceable}
              options={VOICEABLE_OPTIONS}
              onChange={(value) => onChange({ voiceable: value ? value === "yes" : undefined })}
            />
          </FilterGroup>

          {(madeBy || recordable) && (
            <FilterGroup title="The take" description="How the audio was made.">
              {madeBy && (
                <>
                  <FilterSelect label="Model" value={filters.model} options={madeBy.models.map((value) => ({ value, label: value }))} onChange={(model) => onChange({ model })} />
                  <FilterSelect label="Made by" any="Anyone" value={filters.author} options={authors} onChange={(author) => onChange({ author })} />
                </>
              )}
              {recordable && (
                <FilterSelect
                  label="Voice actor"
                  value={filters.recorded}
                  options={RECORDED_OPTIONS}
                  onChange={(recorded) => onChange({ recorded: recorded as Recorded | undefined })}
                />
              )}
            </FilterGroup>
          )}

          <FilterGroup title="Marked pages" description="Pages whose audio may need another look.">
            {/* Not a value of "audio": a page can be up to date and carry this at once. */}
            <FilterToggle label="Pronunciation moved" checked={filters.dirty ?? false} onChange={(dirty) => onChange({ dirty: dirty || undefined })} />
          </FilterGroup>
        </>
      }
    />
  );
}
