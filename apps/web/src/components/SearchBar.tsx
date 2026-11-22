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
import { CLIENT_FILTER_LABELS, CLIENT_FILTER_OPTIONS } from "@/components/ClientSelect";
import LevelBound from "@/components/LevelBound";
import { DEFAULT_CLIENT_FILTER, type ClientFilter } from "@/lib/contributions/client";
import { BROADCAST_OPTIONS, type BroadcastStatus } from "@/lib/broadcast/status";
import type { MadeByFacets } from "@/lib/takes/made-by";
import type { Facets } from "@/lib/facets";
import { AUDIO_STATE_LABELS, type StateCounts } from "@/lib/audio-state";
import { RECORDED_OPTIONS, type Recorded } from "@/lib/recordings/live";
import { NPC_TYPE_LABELS, NPC_TYPES, SOURCE_LABELS, SOURCES, type Source } from "@/lib/line-fields";
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

const SOURCE_OPTIONS: Option[] = SOURCES.map((value) => ({ value, label: SOURCE_LABELS[value] }));

const NPC_TYPE_OPTIONS: Option[] = NPC_TYPES.map((value) => ({ value, label: NPC_TYPE_LABELS[value] }));

const SCOPE_OPTIONS: Option[] = [
  { value: "any", label: "Anywhere" },
  { value: "npc", label: "NPC" },
  { value: "quest", label: "Quest" },
  { value: "text", label: "Line text" },
];

const PLAYER_OPTIONS: Option[] = [
  { value: "m", label: "Male player" },
  { value: "f", label: "Female player" },
];

const CLIENT_OPTIONS: Option[] = CLIENT_FILTER_OPTIONS.filter((value) => value !== DEFAULT_CLIENT_FILTER).map(
  (value) => ({ value, label: CLIENT_FILTER_LABELS[value] }),
);

const labelOf = (options: readonly Option[], value: string) =>
  options.find((option) => option.value === value)?.label ?? value;

const capital = (value: string) => value.charAt(0).toUpperCase() + value.slice(1);

const SearchBar = forwardRef<HTMLInputElement, Props>(function SearchBar(
  { query, filters, facets, onQuery, onFilters, onClearAll, canTriage, madeBy, recordable, counts },
  ref,
) {
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
          label: "Reported",
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
  add("state", "Audio", filters.state && AUDIO_STATE_LABELS[filters.state], { state: undefined });
  add("reports", "Reported", filters.reports === "open" ? "open reports" : undefined, { reports: undefined });
  add("source", "Line", filters.source?.map((value) => SOURCE_LABELS[value]).join(", "), { source: undefined });
  add("npcType", "Spoken by", filters.npcType && NPC_TYPE_LABELS[filters.npcType], { npcType: undefined });
  add("zone", "Zone", filters.zone === undefined ? undefined : labelOf(zoneOptions, String(filters.zone)), { zone: undefined });
  if (filters.minLevel !== undefined || filters.maxLevel !== undefined) {
    add("level", "Level", `${filters.minLevel ?? "…"}–${filters.maxLevel ?? "…"}`, { minLevel: undefined, maxLevel: undefined });
  }
  add("broadcast", "Broadcast id", filters.broadcast && labelOf(BROADCAST_OPTIONS, filters.broadcast), { broadcast: undefined });
  add("client", "Game", filters.client && filters.client !== DEFAULT_CLIENT_FILTER ? CLIENT_FILTER_LABELS[filters.client] : undefined, { client: undefined });
  add("race", "Race", filters.race && capital(filters.race), { race: undefined, flavor: keptFlavor({ race: undefined }) });
  add("gender", "Gender", filters.gender && capital(filters.gender), { gender: undefined, flavor: keptFlavor({ gender: undefined }) });
  add("flavor", "Character", filters.flavor && capital(filters.flavor), { flavor: undefined });
  add("voice", "Voice", filters.voice && capital(filters.voice), { voice: undefined });
  add("playerGender", "Player", filters.playerGender && labelOf(PLAYER_OPTIONS, filters.playerGender), { playerGender: undefined });
  add("model", "Model", filters.model, { model: undefined });
  add("author", "Made by", filters.author && labelOf(authors, filters.author), { author: undefined });
  add("recorded", "Voice actor", filters.recorded && labelOf(RECORDED_OPTIONS, filters.recorded), { recorded: undefined });
  if (filters.generatedAfter || filters.generatedBefore) {
    add("generated", "Made", `${filters.generatedAfter ?? "…"} to ${filters.generatedBefore ?? "today"}`, {
      generatedAfter: undefined,
      generatedBefore: undefined,
    });
  }
  add("overridden", "Rewritten", filters.overridden ? "yes" : undefined, { overridden: undefined });
  add("dirty", "Pronunciation", filters.dirty ? "moved" : undefined, { dirty: undefined });
  add("narration", "Narration", filters.narration ? "yes" : undefined, { narration: undefined });
  add("ignored", "Ignored", filters.ignored ? "only ignored" : undefined, { ignored: undefined });

  return (
    <CatalogueSearch
      inputRef={ref}
      query={query}
      placeholder="NPC, quest or what the line says"
      onQueryChange={onQuery}
      scope={
        <ScopeSelect
          value={filters.filter ?? "any"}
          options={SCOPE_OPTIONS}
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
          <FilterGroup title="The line" description="What kind of line, and where it is.">
            <FilterChecks
              options={SOURCE_OPTIONS}
              values={filters.source}
              onChange={(source) => onFilters({ source: source as Source[] | undefined })}
            />
            <FilterSegments
              label="Spoken by"
              any="Anyone"
              value={filters.npcType}
              options={NPC_TYPE_OPTIONS}
              onChange={(npcType) => onFilters({ npcType: npcType as LineFilters["npcType"] })}
            />
            {zoneOptions.length > 0 && (
              <FilterSelect
                label="Zone"
                value={filters.zone === undefined ? undefined : String(filters.zone)}
                options={zoneOptions}
                onChange={(zone) => onFilters({ zone: zone ? Number(zone) : undefined })}
              />
            )}
            <FilterField label="Quest level">
              <div className="cat-two">
                <LevelBound label="minimum quest level" placeholder="from" value={filters.minLevel} onChange={(minLevel) => onFilters({ minLevel })} />
                <LevelBound label="maximum quest level" placeholder="to" value={filters.maxLevel} onChange={(maxLevel) => onFilters({ maxLevel })} />
              </div>
            </FilterField>
            {/* Only gossip has ids, so any pick here narrows to gossip too. */}
            <FilterSelect
              label="Broadcast id"
              value={filters.broadcast}
              options={BROADCAST_OPTIONS}
              onChange={(broadcast) => onFilters({ broadcast: broadcast as BroadcastStatus | undefined })}
            />
          </FilterGroup>

          <FilterGroup title="The speaker" description="Who the voice belongs to.">
            <FilterSelect label="Race" value={filters.race} options={plain(facets.races)} onChange={(race) => onFilters({ race, flavor: keptFlavor({ race }) })} />
            {genderOptions.length <= 3 ? (
              <FilterSegments label="Gender" value={filters.gender} options={genderOptions} onChange={(gender) => onFilters({ gender, flavor: keptFlavor({ gender }) })} />
            ) : (
              <FilterSelect label="Gender" value={filters.gender} options={genderOptions} onChange={(gender) => onFilters({ gender, flavor: keptFlavor({ gender }) })} />
            )}
            <FilterSelect label="Character (gruff, zany …)" value={filters.flavor} options={plain(flavorOptions)} onChange={(flavor) => onFilters({ flavor })} />
            <FilterSelect label="Voice" value={filters.voice} options={plain(facets.voices)} onChange={(voice) => onFilters({ voice })} />
            <FilterSegments
              label="Player version"
              any="Both"
              value={filters.playerGender}
              options={PLAYER_OPTIONS}
              onChange={(playerGender) => onFilters({ playerGender: playerGender as LineFilters["playerGender"] })}
            />
          </FilterGroup>

          <FilterGroup title="The take" description="How the audio was made.">
            {madeBy && (
              <>
                <FilterSelect label="Model" value={filters.model} options={madeBy.models.map((value) => ({ value, label: value }))} onChange={(model) => onFilters({ model })} />
                <FilterSelect label="Made by" any="Anyone" value={filters.author} options={authors} onChange={(author) => onFilters({ author })} />
              </>
            )}
            {recordable && (
              <FilterSelect
                label="Voice actor"
                value={filters.recorded}
                options={RECORDED_OPTIONS}
                onChange={(recorded) => onFilters({ recorded: recorded as Recorded | undefined })}
              />
            )}
            {/* A file the app has never written has no date, and counts as made long ago. */}
            <FilterDates label="Made between" after={filters.generatedAfter} before={filters.generatedBefore} onChange={onFilters} />
          </FilterGroup>

          <FilterGroup title="Marked lines" description="Lines someone changed or flagged.">
            <FilterToggle label="Rewritten by the team" checked={filters.overridden ?? false} onChange={(overridden) => onFilters({ overridden })} />
            {/* Not a narrower "outdated": a lexicon edit moves no text, so the two find different faults. */}
            <FilterToggle label="Pronunciation moved" checked={filters.dirty ?? false} onChange={(dirty) => onFilters({ dirty })} />
            <FilterToggle label="Has narration" checked={filters.narration ?? false} onChange={(narration) => onFilters({ narration })} />
            {/* Shows only the ignored lines: mixing nobody-will-voice-these back in is not a view anyone asked for. */}
            <FilterToggle label="Only ignored lines" checked={filters.ignored ?? false} onChange={(ignored) => onFilters({ ignored })} />
            <FilterSelect
              label="Game"
              any={CLIENT_FILTER_LABELS[DEFAULT_CLIENT_FILTER]}
              value={filters.client && filters.client !== DEFAULT_CLIENT_FILTER ? filters.client : undefined}
              options={CLIENT_OPTIONS}
              onChange={(client) => onFilters({ client: (client ?? DEFAULT_CLIENT_FILTER) as ClientFilter })}
            />
          </FilterGroup>
        </>
      }
    />
  );
});

export default SearchBar;
