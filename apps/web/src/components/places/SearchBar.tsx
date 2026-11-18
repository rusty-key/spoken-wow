"use client";

import {
  CatalogueSearch,
  FilterDates,
  FilterGroup,
  FilterSegments,
  FilterSelect,
  FilterToggle,
  ScopeSelect,
  type ActiveFilter,
  type Option,
} from "@/components/catalogue/CatalogueSearch";
import type { MadeByFacets } from "@/lib/takes/made-by";
import { AUDIO_STATE_LABELS } from "@/lib/audio-state";
import { RECORDED_OPTIONS, type Recorded } from "@/lib/recordings/live";
import type { ExplorerFilters, ExplorerSection } from "@/components/explorer/section";

/**
 * The places and bosses search: one bar, configured by the section. Every filter is a param in the
 * URL, so a link to a filtered view is a link to the same view.
 */
type Props = {
  section: Pick<ExplorerSection, "facetLabel" | "facets" | "labels">;
  fields: readonly string[];
  kinds: readonly string[];
  filters: ExplorerFilters;
  canTriage: boolean;
  madeBy?: MadeByFacets;
  recordable?: boolean;
  query: string;
  inputRef: React.RefObject<HTMLInputElement | null>;
  onQueryChange: (value: string) => void;
  onQuerySubmit: () => void;
  onChange: (next: Partial<ExplorerFilters>) => void;
  onClearAll: () => void;
};

const labelOf = (options: readonly Option[], value: string) =>
  options.find((option) => option.value === value)?.label ?? value;

const capital = (word: string) => word.charAt(0).toUpperCase() + word.slice(1);

export function SearchBar({
  section,
  fields,
  kinds,
  filters,
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
  const fieldName = (field: string) =>
    field === "any" ? "Anywhere" : field === "name" ? section.labels.name : field === "text" ? section.labels.text : capital(field);
  const fieldOptions: Option[] = fields.map((field) => ({ value: field, label: fieldName(field) }));
  const kindOptions: Option[] = kinds.map((kind) => ({ value: kind, label: `${capital(kind)}s` }));
  const facetOptions: Option[] = section.facets.map((facet) => ({ value: String(facet.value), label: facet.label }));
  const authors: Option[] = madeBy?.authors.map(({ id, name }) => ({ value: id, label: name })) ?? [];

  const setState = (state: ExplorerFilters["state"]) => onChange({ state: filters.state === state ? undefined : state });
  const statuses = [
    { key: "missing", label: "Missing audio", tone: "missing" as const, pressed: filters.state === "missing", onPress: () => setState("missing") },
    { key: "stale", label: "Outdated", tone: "stale" as const, pressed: filters.state === "stale", onPress: () => setState("stale") },
    { key: "current", label: "Up to date", tone: "current" as const, pressed: filters.state === "current", onPress: () => setState("current") },
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
  const add = (key: string, label: string, value: string | undefined, clear: Partial<ExplorerFilters>) => {
    if (value) active.push({ key, label, value, onRemove: () => onChange(clear) });
  };
  add("state", "Audio", filters.state && AUDIO_STATE_LABELS[filters.state], { state: undefined });
  add("reports", "Reported", filters.reports === "open" ? "open reports" : undefined, { reports: undefined });
  add("mapID", section.facetLabel, filters.mapID === undefined ? undefined : labelOf(facetOptions, String(filters.mapID)), { mapID: undefined });
  add("kind", "Kind", filters.kind && labelOf(kindOptions, filters.kind), { kind: undefined });
  add("model", "Model", filters.model, { model: undefined });
  add("author", "Made by", filters.author && labelOf(authors, filters.author), { author: undefined });
  add("recorded", "Voice actor", filters.recorded && labelOf(RECORDED_OPTIONS, filters.recorded), { recorded: undefined });
  if (filters.generatedAfter || filters.generatedBefore) {
    add("generated", "Made", `${filters.generatedAfter ?? "…"} to ${filters.generatedBefore ?? "today"}`, {
      generatedAfter: undefined,
      generatedBefore: undefined,
    });
  }
  add("dirty", "Pronunciation", filters.dirty ? "moved" : undefined, { dirty: undefined });
  add("short", "Length", filters.short ? "short only" : undefined, { short: undefined });

  return (
    <CatalogueSearch
      inputRef={inputRef}
      query={query}
      placeholder={section.labels.search}
      onQueryChange={onQueryChange}
      onQuerySubmit={onQuerySubmit}
      scope={
        <ScopeSelect
          value={filters.field ?? "any"}
          options={fieldOptions}
          onChange={(field) => onChange({ field: field as ExplorerFilters["field"] })}
        />
      }
      statuses={statuses}
      onShowAll={() => onChange({ state: undefined, reports: undefined })}
      active={active}
      onClearAll={onClearAll}
      groups={
        <>
          <FilterGroup title="Where" description={`Which ${section.facetLabel.toLowerCase()} the line belongs to.`}>
            <FilterSelect
              label={section.facetLabel}
              value={filters.mapID === undefined ? undefined : String(filters.mapID)}
              options={facetOptions}
              onChange={(mapID) => onChange({ mapID: mapID === undefined ? undefined : Number(mapID) })}
            />
            {kindOptions.length > 0 && (
              <FilterSegments
                label="Kind"
                value={filters.kind}
                options={kindOptions}
                onChange={(kind) => onChange({ kind: kind as ExplorerFilters["kind"] })}
              />
            )}
          </FilterGroup>

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
            <FilterDates label="Made between" after={filters.generatedAfter} before={filters.generatedBefore} onChange={onChange} />
          </FilterGroup>

          <FilterGroup title="Marked lines" description="Lines whose audio may need another look.">
            {/* Not a value of "audio": a line can be up to date and carry this at once. */}
            <FilterToggle label="Pronunciation moved" checked={filters.dirty ?? false} onChange={(dirty) => onChange({ dirty: dirty || undefined })} />
            <FilterToggle label="Short lines only" checked={filters.short ?? false} onChange={(short) => onChange({ short: short || undefined })} />
          </FilterGroup>
        </>
      }
    />
  );
}
