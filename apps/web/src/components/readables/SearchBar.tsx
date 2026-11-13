"use client";

import { MadeByChips } from "@/components/MadeBy";
import RecordedChip from "@/components/RecordedChip";
import type { MadeByFacets } from "@/lib/takes/made-by";
import FilterChip, { type ChipOption } from "@/components/FilterChip";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AUDIO_STATE_OPTIONS } from "@/lib/audio-state";
import type { BookFacet } from "@/lib/readables/catalogue";
import {
  activeFilterCount,
  FIELDS,
  OWNER_KINDS,
  STATES,
  type PageFilters,
} from "@/lib/readables/filters";

/**
 * The same controls the other two explorers use, on this section's fields.
 *
 * The book dropdown is the one that differs: a title is not unique -- two objects are both
 * "A Dusty Tome" -- so an option is keyed by the chain's first page and labelled with its
 * page count, which is what tells the two apart at a glance.
 */

/** Where the free-text query is matched. "any" is the idle state, so it is not an option. */
const FIELD_OPTIONS: ChipOption[] = FIELDS.filter((field) => field !== "any").map((field) => ({
  value: field,
  label: `${field} only`,
}));

const KIND_OPTIONS: ChipOption[] = OWNER_KINDS.map((kind) => ({
  value: kind,
  label: kind === "object" ? "in the world" : "carried items",
}));

// "no" is how the pages nothing can voice are found, with the reason on each row.
const VOICEABLE_OPTIONS: ChipOption[] = [
  { value: "yes", label: "yes" },
  { value: "no", label: "no" },
];

type Props = {
  books: BookFacet[];
  filters: PageFilters;
  query: string;
  inputRef: React.RefObject<HTMLInputElement | null>;
  onQueryChange: (value: string) => void;
  /** Enter, meaning "search now" rather than waiting out the debounce. */
  onQuerySubmit: () => void;
  onChange: (next: Partial<PageFilters>) => void;
  onClearAll: () => void;
  /** Editor and up: the ones who act on reports, so the ones who filter by them. */
  canTriage: boolean;
  /** The model and author chips' options; present only for somebody working in the language. */
  madeBy?: MadeByFacets;
  /** The viewer records here, so the search answers whether each line is recorded. */
  recordable?: boolean;
};

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
}: Props) {
  const active = activeFilterCount(filters);

  const bookOptions: ChipOption[] = books.map((book) => ({
    value: book.bookId,
    label: book.pages > 1 ? `${book.title} (${book.pages} pages)` : book.title,
  }));

  return (
    <div className="mb-4 flex flex-wrap items-center gap-2">
      <Input
        ref={inputRef}
        value={query}
        placeholder="Search titles and page text"
        className="h-8 w-64"
        onChange={(event) => onQueryChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") onQuerySubmit();
        }}
      />

      <FilterChip
        label="match"
        value={filters.field && filters.field !== "any" ? filters.field : undefined}
        options={FIELD_OPTIONS}
        onChange={(value) => onChange({ field: (value as PageFilters["field"]) ?? "any" })}
      />

      <FilterChip
        label="book"
        value={filters.bookId}
        options={bookOptions}
        onChange={(value) => onChange({ bookId: value || undefined })}
      />

      <FilterChip
        label="opened by"
        value={filters.ownerKind}
        options={KIND_OPTIONS}
        onChange={(value) => onChange({ ownerKind: value as PageFilters["ownerKind"] })}
      />

      <FilterChip
        label="audio"
        value={filters.state}
        options={AUDIO_STATE_OPTIONS}
        onChange={(value) => onChange({ state: value as PageFilters["state"] })}
      />
      {madeBy && (
        <MadeByChips
          facets={madeBy}
          model={filters.model}
          author={filters.author}
          onChange={onChange}
        />
      )}
      {recordable && <RecordedChip value={filters.recorded} onChange={(recorded) => onChange({ recorded })} />}

      <FilterChip
        label="voiceable"
        value={filters.voiceable === undefined ? undefined : filters.voiceable ? "yes" : "no"}
        options={VOICEABLE_OPTIONS}
        onChange={(value) => onChange({ voiceable: value ? value === "yes" : undefined })}
      />

      {/* A checkbox rather than a value of `state`, because a page can be current and carry
          this at once: as a state it would hide whichever answer came second. */}
      <Label className="flex items-center gap-1.5 text-xs">
        <Checkbox
          checked={filters.dirty ?? false}
          onCheckedChange={(checked) => onChange({ dirty: checked === true ? true : undefined })}
        />
        pronunciation moved
      </Label>

      {/* Behind the triage role, as in the places and quests bars: the count is public, but
          a list of what people have complained about is a worklist, and only triagers work it. */}
      {canTriage && (
        <Label className="flex items-center gap-1.5 text-xs">
          <Checkbox
            checked={filters.reports === "open"}
            onCheckedChange={(checked) => onChange({ reports: checked === true ? "open" : undefined })}
          />
          reported only
        </Label>
      )}

      {active > 0 && (
        <Button variant="ghost" size="sm" onClick={onClearAll}>
          Clear {active} filter{active === 1 ? "" : "s"}
        </Button>
      )}
    </div>
  );
}
