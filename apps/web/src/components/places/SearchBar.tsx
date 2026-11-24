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
import { useUiText } from "@/components/UiTextProvider";
import type { MadeByFacets } from "@/lib/takes/made-by";
import type { StateCounts } from "@/lib/audio-state";
import { RECORDED_OPTIONS, type Recorded } from "@/lib/recordings/live";
import { fill } from "@/lib/site-text/format";
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
  /** The last answer's counts, for the audio buttons; absent before the first. */
  counts?: StateCounts;
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
  counts,
  query,
  inputRef,
  onQueryChange,
  onQuerySubmit,
  onChange,
  onClearAll,
}: Props) {
  const text = useUiText();
  const s = text.catalogue.search;
  const f = s.fields;
  const v = s.values;
  const l = s.labels;
  const facetsText = text.catalogue.facets;
  const recordedOptions = RECORDED_OPTIONS.map((option) => ({ value: option.value, label: facetsText.recorded[option.value] }));
  const fieldName = (field: string) =>
    field === "any" ? s.scopes.any : field === "name" ? section.labels.name : field === "text" ? section.labels.text : capital(field);
  const fieldOptions: Option[] = fields.map((field) => ({ value: field, label: fieldName(field) }));
  const kindOptions: Option[] = kinds.map((kind) => ({ value: kind, label: `${capital(kind)}s` }));
  const facetOptions: Option[] = section.facets.map((facet) => ({ value: String(facet.value), label: facet.label }));
  const authors: Option[] = madeBy?.authors.map(({ id, name }) => ({ value: id, label: name })) ?? [];

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
  const add = (key: string, label: string, value: string | undefined, clear: Partial<ExplorerFilters>) => {
    if (value) active.push({ key, label, value, onRemove: () => onChange(clear) });
  };
  add("state", f.state, filters.state ? facetsText.audioLower[filters.state] : undefined, { state: undefined });
  add("reports", f.reports, filters.reports === "open" ? v.open : undefined, { reports: undefined });
  add("mapID", section.facetLabel, filters.mapID === undefined ? undefined : labelOf(facetOptions, String(filters.mapID)), { mapID: undefined });
  add("kind", l.kind, filters.kind ? labelOf(kindOptions, filters.kind) : undefined, { kind: undefined });
  add("model", f.model, filters.model, { model: undefined });
  add("author", f.author, filters.author ? labelOf(authors, filters.author) : undefined, { author: undefined });
  add("recorded", f.recorded, filters.recorded ? labelOf(recordedOptions, filters.recorded) : undefined, { recorded: undefined });
  if (filters.generatedAfter || filters.generatedBefore) {
    add("generated", f.generated, fill(v.between, { from: filters.generatedAfter ?? "…", to: filters.generatedBefore ?? v.today }), {
      generatedAfter: undefined,
      generatedBefore: undefined,
    });
  }
  add("dirty", f.dirty, filters.dirty ? v.moved : undefined, { dirty: undefined });
  add("short", l.length, filters.short ? v.shortOnly : undefined, { short: undefined });

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
      audio={{ state: filters.state, counts, onState: (state) => onChange({ state }) }}
      onShowAll={() => onChange({ state: undefined, reports: undefined })}
      active={active}
      onClearAll={onClearAll}
      groups={
        <>
          <FilterGroup title={l.where} description={fill(l.whereHint, { facet: section.facetLabel.toLowerCase() })}>
            <FilterSelect
              label={section.facetLabel}
              value={filters.mapID === undefined ? undefined : String(filters.mapID)}
              options={facetOptions}
              onChange={(mapID) => onChange({ mapID: mapID === undefined ? undefined : Number(mapID) })}
            />
            {kindOptions.length > 0 && (
              <FilterSegments
                label={l.kind}
                value={filters.kind}
                options={kindOptions}
                onChange={(kind) => onChange({ kind: kind as ExplorerFilters["kind"] })}
              />
            )}
          </FilterGroup>

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
            <FilterDates label={l.madeBetween} after={filters.generatedAfter} before={filters.generatedBefore} onChange={onChange} />
          </FilterGroup>

          <FilterGroup title={s.groups.marked} description={l.markedLinesHint}>
            {/* Not a value of "audio": a line can be up to date and carry this at once. */}
            <FilterToggle label={l.pronunciationMoved} checked={filters.dirty ?? false} onChange={(dirty) => onChange({ dirty: dirty || undefined })} />
            <FilterToggle label={l.shortOnly} checked={filters.short ?? false} onChange={(short) => onChange({ short: short || undefined })} />
          </FilterGroup>
        </>
      }
    />
  );
}
