"use client";

import DateChip from "@/components/DateChip";
import { MadeByChips } from "@/components/MadeBy";
import RecordedChip from "@/components/RecordedChip";
import type { MadeByFacets } from "@/lib/takes/made-by";
import FilterChip, { type ChipOption } from "@/components/FilterChip";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AUDIO_STATE_OPTIONS } from "@/lib/audio-state";
import type { ExplorerFilters, ExplorerSection } from "@/components/explorer/section";

/**
 * The same controls the quests explorer uses, on this section's fields.
 *
 * They were plain <select>s and bare checkboxes until the merge, for the honest reason that
 * the zones site had no component library to borrow from. It does now, and two explorers in
 * one app that filter differently read as two apps.
 */

type Props = {
  section: Pick<ExplorerSection, "facetLabel" | "facets" | "labels">;
  /** The section's own search fields, "any" first, and its kinds where it has any. */
  fields: readonly string[];
  kinds: readonly string[];
  filters: ExplorerFilters;
  /** How many filters are in force, by the section's own count. */
  active: number;
  /**
   * Editor and up. Gates the "reported" control only, not the filter behind it: a
   * hand-typed ?fb=open still works for anyone, which is fine because the open counts
   * travel with the search results anyway. Drawing the control for a guest would be
   * offering a worklist to somebody with no work to do.
   */
  /** Triager and up: only they can read the report bodies the filter points at. */
  canTriage: boolean;
  /** The model and author chips' options; present only for somebody working in the language. */
  madeBy?: MadeByFacets;
  /** The viewer records here, so the search answers whether each line is recorded. */
  recordable?: boolean;
  query: string;
  inputRef: React.RefObject<HTMLInputElement | null>;
  onQueryChange: (value: string) => void;
  /** Enter, meaning "search now" rather than waiting out the debounce. */
  onQuerySubmit: () => void;
  onChange: (next: Partial<ExplorerFilters>) => void;
  onClearAll: () => void;
};

export function SearchBar({
  section,
  fields,
  kinds,
  filters,
  active,
  canTriage,
  madeBy,
  recordable,
  query,
  inputRef,
  onQueryChange,
  onQuerySubmit,
  onChange,
  onClearAll,
}: Props) {
  /** Where the free-text query is matched. "any" is the idle state, so it is not an option. */
  const fieldOptions: ChipOption[] = fields
    .filter((field) => field !== "any")
    .map((field) => ({ value: field, label: `${field} only` }));
  const kindOptions: ChipOption[] = kinds.map((kind) => ({ value: kind, label: `${kind}s only` }));

  return (
    <div className="bg-background sticky top-0 z-10 flex flex-wrap items-center gap-2 border-b py-3">
      <Input
        ref={inputRef}
        type="search"
        value={query}
        placeholder={section.labels.search}
        aria-label="Search"
        autoFocus
        className="min-w-0 flex-1 basis-64"
        onChange={(event) => onQueryChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key !== "Enter") return;
          // Nothing here is inside a <form>, so this is not a submit being prevented:
          // it stops the browser's own "search" behaviour on a type=search input.
          event.preventDefault();
          onQuerySubmit();
        }}
      />
      <FilterChip
        label="search in"
        value={filters.field === "any" ? undefined : filters.field}
        options={fieldOptions}
        onChange={(field) => onChange({ field: (field ?? "any") as ExplorerFilters["field"] })}
      />

      <div className="flex w-full flex-wrap items-center gap-2">
        <FilterChip
          label={section.facetLabel.toLowerCase()}
          value={filters.mapID === undefined ? undefined : String(filters.mapID)}
          options={section.facets.map((facet) => ({ value: String(facet.value), label: facet.label }))}
          onChange={(mapID) => onChange({ mapID: mapID === undefined ? undefined : Number(mapID) })}
        />
        {kindOptions.length > 0 && (
          <FilterChip
            label="kind"
            value={filters.kind}
            options={kindOptions}
            onChange={(kind) => onChange({ kind: kind as ExplorerFilters["kind"] })}
          />
        )}
        <FilterChip
          label="audio"
          value={filters.state}
          options={AUDIO_STATE_OPTIONS}
          onChange={(state) => onChange({ state: state as ExplorerFilters["state"] })}
        />
        {/* Read as one range: "generated after X" and "generated before Y". */}
        <DateChip
          label="generated after"
          value={filters.generatedAfter}
          onChange={(generatedAfter) => onChange({ generatedAfter })}
        />
        <DateChip
          label="generated before"
          value={filters.generatedBefore}
          onChange={(generatedBefore) => onChange({ generatedBefore })}
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

        {/* A checkbox rather than a value of `state`, because a line can be current and
            carry this at once: as a state it would hide whichever answer came second. */}
        <div className="flex items-center gap-2 whitespace-nowrap">
          <Checkbox
            id="dirty-only"
            checked={filters.dirty ?? false}
            onCheckedChange={(value) => onChange({ dirty: value === true || undefined })}
          />
          <Label htmlFor="dirty-only" className="text-muted-foreground text-sm">
            pronunciation moved
          </Label>
        </div>

        <div className="flex items-center gap-2 whitespace-nowrap">
          <Checkbox
            id="short-only"
            checked={filters.short ?? false}
            onCheckedChange={(value) => onChange({ short: value === true || undefined })}
          />
          <Label htmlFor="short-only" className="text-muted-foreground text-sm">
            short only
          </Label>
        </div>

        {canTriage && (
          <div className="flex items-center gap-2 whitespace-nowrap">
            <Checkbox
              id="reported-only"
              checked={filters.reports === "open"}
              onCheckedChange={(value) =>
                onChange({ reports: value === true ? "open" : undefined })
              }
            />
            <Label htmlFor="reported-only" className="text-muted-foreground text-sm">
              reported only
            </Label>
          </div>
        )}

        {/* Only when there is something to clear: a button that does nothing on most
            visits is one more thing to read past every time. */}
        {active > 0 && (
          <Button size="sm" variant="ghost" className="ml-auto" onClick={onClearAll}>
            Clear {active === 1 ? "filter" : `all ${active} filters`}
          </Button>
        )}
      </div>
    </div>
  );
}
