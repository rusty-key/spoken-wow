"use client";

import FilterChip, { type ChipOption } from "@/components/FilterChip";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { BookFacet } from "@/lib/books/catalogue";
import {
  activeFilterCount,
  FIELDS,
  OWNER_KINDS,
  STATES,
  type PageFilters,
} from "@/lib/books/filters";

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

const STATE_OPTIONS: ChipOption[] = STATES.map((state) => ({ value: state, label: state }));

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
}: Props) {
  const active = activeFilterCount(filters);

  const bookOptions: ChipOption[] = books.map((book) => ({
    value: String(book.bookId),
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
        value={filters.bookId === undefined ? undefined : String(filters.bookId)}
        options={bookOptions}
        onChange={(value) => onChange({ bookId: value ? Number(value) : undefined })}
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
        options={STATE_OPTIONS}
        onChange={(value) => onChange({ state: value as PageFilters["state"] })}
      />

      {/* A checkbox rather than a chip: it is the one filter people leave on, and 88 of the
          1191 pages are the ones it hides. */}
      <Label className="flex items-center gap-1.5 text-xs">
        <Checkbox
          checked={filters.voiceable ?? false}
          onCheckedChange={(checked) => onChange({ voiceable: checked === true ? true : undefined })}
        />
        voiceable only
      </Label>

      {/* A checkbox rather than a value of `state`, because a page can be current and carry
          this at once: as a state it would hide whichever answer came second. */}
      <Label className="flex items-center gap-1.5 text-xs">
        <Checkbox
          checked={filters.dirty ?? false}
          onCheckedChange={(checked) => onChange({ dirty: checked === true ? true : undefined })}
        />
        pronunciation moved
      </Label>

      {/* Behind the triage role, as in the zones and quests bars: the count is public, but
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
