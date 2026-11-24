"use client";

import { forwardRef, useCallback, useMemo } from "react";

import {
  CatalogueSearch,
  FilterChecks,
  FilterDates,
  FilterField,
  FilterGroup,
  FilterSegments,
  FilterSelect,
  FilterToggle,
  ScopeSelect,
  type ActiveFilter,
  type Option,
} from "@/components/catalogue/CatalogueSearch";
import { CLIENT_FILTER_OPTIONS } from "@/components/ClientSelect";
import LevelBound from "@/components/LevelBound";
import { useUiText } from "@/components/UiTextProvider";
import { DEFAULT_CLIENT_FILTER, type ClientFilter } from "@/lib/contributions/client";
import { BROADCAST_OPTIONS, type BroadcastStatus } from "@/lib/broadcast/status";
import type { MadeByFacets } from "@/lib/takes/made-by";
import type { Facets } from "@/lib/facets";
import type { StateCounts } from "@/lib/audio-state";
import { RECORDED_OPTIONS, type Recorded } from "@/lib/recordings/live";
import { NPC_TYPES, SOURCES, type Source } from "@/lib/line-fields";
import { fill } from "@/lib/site-text/format";
import type { Filter, LineFilters } from "@/lib/search";

type Props = {
  query: string;
  filters: LineFilters;
  facets: Facets;
  onQuery: (value: string) => void;
  onFilters: (next: Partial<LineFilters>) => void;
  onClearAll: () => void;
  /** Editor and up: the ones who act on reports, so the ones who filter by them. */
  canTriage: boolean;
  /** The model and author options; present only for somebody working in the language. */
  madeBy?: MadeByFacets;
  /** The viewer records here, so the search answers whether each line is recorded. */
  recordable?: boolean;
  /** The last answer's counts, for the audio buttons; absent before the first. */
  counts?: StateCounts;
};

// Roster values are lower-case identifiers; the label capitalises them, the URL keeps the value.
const plain = (values: readonly string[]): Option[] =>
  values.map((value) => ({ value, label: capital(value) }));

const optionsOf = <K extends string>(keys: readonly K[], labels: Record<K, string>): Option[] =>
  keys.map((value) => ({ value, label: labels[value] }));

const labelOf = (options: readonly Option[], value: string) =>
  options.find((option) => option.value === value)?.label ?? value;

const capital = (value: string) => value.charAt(0).toUpperCase() + value.slice(1);

const SearchBar = forwardRef<HTMLInputElement, Props>(function SearchBar(
  { query, filters, facets, onQuery, onFilters, onClearAll, canTriage, madeBy, recordable, counts },
  ref,
) {
  const text = useUiText();
  const s = text.catalogue.search;
  const f = s.fields;
  const v = s.values;
  const l = s.labels;
  const facetsText = text.catalogue.facets;

  const sourceOptions = optionsOf(SOURCES, facetsText.source);
  const npcTypeOptions = optionsOf(NPC_TYPES, facetsText.npcType);
  const scopeOptions: Option[] = [
    { value: "any", label: s.scopes.any },
    { value: "npc", label: s.scopes.npc },
    { value: "quest", label: s.scopes.quest },
    { value: "text", label: s.scopes.text },
  ];
  const playerOptions: Option[] = [
    { value: "m", label: v.malePlayer },
    { value: "f", label: v.femalePlayer },
  ];
  const clientOptions: Option[] = CLIENT_FILTER_OPTIONS.filter((value) => value !== DEFAULT_CLIENT_FILTER).map(
    (value) => ({ value, label: facetsText.client[value] }),
  );
  const broadcastOptions = BROADCAST_OPTIONS.map((option) => ({
    value: option.value,
    label: facetsText.broadcast[option.value],
  }));
  const recordedOptions = RECORDED_OPTIONS.map((option) => ({
    value: option.value,
    label: facetsText.recorded[option.value],
  }));

  /** The flavors reachable under a race and gender, or all of them under neither. */
  const flavorsUnder = useCallback(
    (race: string | undefined, gender: string | undefined) => {
      if (!race && !gender) return facets.flavors;
      const reachable = facets.flavorScopes.filter(
        (scope) => (!race || scope.race === race) && (!gender || scope.gender === gender),
      );
      return [...new Set(reachable.map((scope) => scope.flavor))].sort((a, b) => a.localeCompare(b));
    },
    [facets.flavors, facets.flavorScopes],
  );

  const flavorOptions = useMemo(
    () => flavorsUnder(filters.race, filters.gender),
    [flavorsUnder, filters.race, filters.gender],
  );

  /**
   * The flavor to keep when the race or gender changes under it. Dropped when the new pairing has
   * no such voice, which would otherwise leave a filter matching nothing.
   */
  function keptFlavor(next: { race?: string; gender?: string }) {
    if (!filters.flavor) return undefined;
    const race = "race" in next ? next.race : filters.race;
    const gender = "gender" in next ? next.gender : filters.gender;
    return flavorsUnder(race, gender).includes(filters.flavor) ? filters.flavor : undefined;
  }

  // Triagers only: the count on a row is public, but a list of complaints is a worklist.
  const statuses = canTriage
    ? [
        {
          key: "reported",
          label: f.reports,
          tone: "reported" as const,
          pressed: filters.reports === "open",
          onPress: () => onFilters({ reports: filters.reports === "open" ? undefined : "open" }),
        },
      ]
    : [];

  const authors: Option[] = madeBy?.authors.map(({ id, name }) => ({ value: id, label: name })) ?? [];
  const genderOptions = plain(facets.genders);
  const zoneOptions: Option[] = facets.zones.map((zone) => ({ value: String(zone.uiMapID), label: zone.name }));

  const active: ActiveFilter[] = [];
  const add = (key: string, label: string, value: string | undefined, clear: Partial<LineFilters>) => {
    if (value) active.push({ key, label, value, onRemove: () => onFilters(clear) });
  };
  add("state", f.state, filters.state ? facetsText.audioLower[filters.state] : undefined, { state: undefined });
  add("reports", f.reports, filters.reports === "open" ? v.open : undefined, { reports: undefined });
  add("source", f.source, filters.source?.map((value) => facetsText.source[value]).join(", "), { source: undefined });
  add("npcType", f.npcType, filters.npcType ? facetsText.npcType[filters.npcType] : undefined, { npcType: undefined });
  add("zone", f.zone, filters.zone === undefined ? undefined : labelOf(zoneOptions, String(filters.zone)), { zone: undefined });
  if (filters.minLevel !== undefined || filters.maxLevel !== undefined) {
    add("level", f.level, `${filters.minLevel ?? "…"}–${filters.maxLevel ?? "…"}`, { minLevel: undefined, maxLevel: undefined });
  }
  add("broadcast", f.broadcast, filters.broadcast ? labelOf(broadcastOptions, filters.broadcast) : undefined, { broadcast: undefined });
  add("client", f.client, filters.client && filters.client !== DEFAULT_CLIENT_FILTER ? facetsText.client[filters.client] : undefined, { client: undefined });
  add("race", f.race, filters.race && capital(filters.race), { race: undefined, flavor: keptFlavor({ race: undefined }) });
  add("gender", f.gender, filters.gender && capital(filters.gender), { gender: undefined, flavor: keptFlavor({ gender: undefined }) });
  add("flavor", f.flavor, filters.flavor && capital(filters.flavor), { flavor: undefined });
  add("voice", f.voice, filters.voice && capital(filters.voice), { voice: undefined });
  add("playerGender", f.playerGender, filters.playerGender ? labelOf(playerOptions, filters.playerGender) : undefined, { playerGender: undefined });
  add("model", f.model, filters.model, { model: undefined });
  add("author", f.author, filters.author && labelOf(authors, filters.author), { author: undefined });
  add("recorded", f.recorded, filters.recorded ? labelOf(recordedOptions, filters.recorded) : undefined, { recorded: undefined });
  if (filters.generatedAfter || filters.generatedBefore) {
    add("generated", f.generated, fill(v.between, { from: filters.generatedAfter ?? "…", to: filters.generatedBefore ?? v.today }), {
      generatedAfter: undefined,
      generatedBefore: undefined,
    });
  }
  add("overridden", f.overridden, filters.overridden ? v.yes : undefined, { overridden: undefined });
  add("dirty", f.dirty, filters.dirty ? v.moved : undefined, { dirty: undefined });
  add("narration", f.narration, filters.narration ? v.yes : undefined, { narration: undefined });
  add("ignored", f.ignored, filters.ignored ? v.onlyIgnored : undefined, { ignored: undefined });

  return (
    <CatalogueSearch
      inputRef={ref}
      query={query}
      placeholder={s.placeholder}
      onQueryChange={onQuery}
      scope={
        <ScopeSelect
          value={filters.filter ?? "any"}
          options={scopeOptions}
          onChange={(value) => onFilters({ filter: value as Filter })}
        />
      }
      statuses={statuses}
      audio={{ state: filters.state, counts, onState: (state) => onFilters({ state }) }}
      onShowAll={() => onFilters({ state: undefined, reports: undefined })}
      active={active}
      onClearAll={onClearAll}
      groups={
        <>
          <FilterGroup title={s.groups.line} description={s.groups.lineHint}>
            <FilterChecks
              options={sourceOptions}
              values={filters.source}
              onChange={(source) => onFilters({ source: source as Source[] | undefined })}
            />
            <FilterSegments
              label={f.npcType}
              any={v.anyone}
              value={filters.npcType}
              options={npcTypeOptions}
              onChange={(npcType) => onFilters({ npcType: npcType as LineFilters["npcType"] })}
            />
            {zoneOptions.length > 0 && (
              <FilterSelect
                label={f.zone}
                value={filters.zone === undefined ? undefined : String(filters.zone)}
                options={zoneOptions}
                onChange={(zone) => onFilters({ zone: zone ? Number(zone) : undefined })}
              />
            )}
            <FilterField label={l.questLevel}>
              <div className="cat-two">
                <LevelBound label={l.minLevel} placeholder={l.from} value={filters.minLevel} onChange={(minLevel) => onFilters({ minLevel })} />
                <LevelBound label={l.maxLevel} placeholder={l.to} value={filters.maxLevel} onChange={(maxLevel) => onFilters({ maxLevel })} />
              </div>
            </FilterField>
            {/* Only gossip has ids, so any pick here narrows to gossip too. */}
            <FilterSelect
              label={f.broadcast}
              value={filters.broadcast}
              options={broadcastOptions}
              onChange={(broadcast) => onFilters({ broadcast: broadcast as BroadcastStatus | undefined })}
            />
          </FilterGroup>

          <FilterGroup title={s.groups.speaker} description={s.groups.speakerHint}>
            <FilterSelect label={f.race} value={filters.race} options={plain(facets.races)} onChange={(race) => onFilters({ race, flavor: keptFlavor({ race }) })} />
            {genderOptions.length <= 3 ? (
              <FilterSegments label={f.gender} value={filters.gender} options={genderOptions} onChange={(gender) => onFilters({ gender, flavor: keptFlavor({ gender }) })} />
            ) : (
              <FilterSelect label={f.gender} value={filters.gender} options={genderOptions} onChange={(gender) => onFilters({ gender, flavor: keptFlavor({ gender }) })} />
            )}
            <FilterSelect label={l.character} value={filters.flavor} options={plain(flavorOptions)} onChange={(flavor) => onFilters({ flavor })} />
            <FilterSelect label={f.voice} value={filters.voice} options={plain(facets.voices)} onChange={(voice) => onFilters({ voice })} />
            <FilterSegments
              label={l.playerVersion}
              any={v.both}
              value={filters.playerGender}
              options={playerOptions}
              onChange={(playerGender) => onFilters({ playerGender: playerGender as LineFilters["playerGender"] })}
            />
          </FilterGroup>

          <FilterGroup title={s.groups.take} description={s.groups.takeHint}>
            {madeBy && (
              <>
                <FilterSelect label={f.model} value={filters.model} options={madeBy.models.map((value) => ({ value, label: value }))} onChange={(model) => onFilters({ model })} />
                <FilterSelect label={f.author} any={v.anyone} value={filters.author} options={authors} onChange={(author) => onFilters({ author })} />
              </>
            )}
            {recordable && (
              <FilterSelect
                label={f.recorded}
                value={filters.recorded}
                options={recordedOptions}
                onChange={(recorded) => onFilters({ recorded: recorded as Recorded | undefined })}
              />
            )}
            {/* A file the app has never written has no date, and counts as made long ago. */}
            <FilterDates label={l.madeBetween} after={filters.generatedAfter} before={filters.generatedBefore} onChange={onFilters} />
          </FilterGroup>

          <FilterGroup title={s.groups.marked} description={s.groups.markedHint}>
            <FilterToggle label={l.rewrittenByTeam} checked={filters.overridden ?? false} onChange={(overridden) => onFilters({ overridden })} />
            {/* Not a narrower "outdated": a lexicon edit moves no text, so the two find different faults. */}
            <FilterToggle label={l.pronunciationMoved} checked={filters.dirty ?? false} onChange={(dirty) => onFilters({ dirty })} />
            <FilterToggle label={l.hasNarration} checked={filters.narration ?? false} onChange={(narration) => onFilters({ narration })} />
            {/* Shows only the ignored lines: mixing nobody-will-voice-these back in is not a view anyone asked for. */}
            <FilterToggle label={l.onlyIgnored} checked={filters.ignored ?? false} onChange={(ignored) => onFilters({ ignored })} />
            <FilterSelect
              label={f.client}
              any={facetsText.client[DEFAULT_CLIENT_FILTER]}
              value={filters.client && filters.client !== DEFAULT_CLIENT_FILTER ? filters.client : undefined}
              options={clientOptions}
              onChange={(client) => onFilters({ client: (client ?? DEFAULT_CLIENT_FILTER) as ClientFilter })}
            />
          </FilterGroup>
        </>
      }
    />
  );
});

export default SearchBar;
