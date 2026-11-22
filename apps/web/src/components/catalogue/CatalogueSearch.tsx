"use client";

import { SearchIcon, SlidersHorizontalIcon, XIcon } from "lucide-react";
import { useId, useRef, useState, type ReactNode, type Ref } from "react";

import { useUiText } from "@/components/UiTextProvider";
import { AUDIO_STATES, type AudioState, type StateCounts } from "@/lib/audio-state";
import { fill } from "@/lib/site-text/format";
import { cn } from "@/lib/utils";

export type StatusOption = {
  key: string;
  label: string;
  /** The dot's colour: the same state colours the rows use. */
  tone?: "missing" | "stale" | "current" | "reported" | "neutral";
  pressed: boolean;
  onPress: () => void;
};

export type ActiveFilter = {
  key: string;
  label: string;
  value: string;
  onRemove: () => void;
};

/**
 * The search block every audio page opens with: one search field, the audio states as one-click
 * buttons, every other filter behind one Filters button in named groups, and the filters in force
 * as a row of removable pills.
 *
 * The panel opens inline rather than over the list, so the list it narrows stays readable under it
 * and nothing needs a focus trap.
 */
export function CatalogueSearch({
  inputRef,
  query,
  placeholder,
  onQueryChange,
  onQuerySubmit,
  scope,
  audio,
  statuses = [],
  onShowAll,
  groups,
  active,
  onClearAll,
}: {
  inputRef?: Ref<HTMLInputElement>;
  query: string;
  placeholder: string;
  onQueryChange: (value: string) => void;
  /** Places and readables search on Enter; quests search as you type and leave this out. */
  onQuerySubmit?: () => void;
  /** Where the query is matched, as a small select inside the field. */
  scope?: ReactNode;
  /** The audio state buttons, each with its count. Pressing the pressed one clears it. */
  audio: { state?: AudioState; counts?: StateCounts; onState: (state: AudioState | undefined) => void };
  /** Buttons after the audio states, such as Reported. */
  statuses?: StatusOption[];
  /**
   * "All" as one write: pressing each status off in turn would fire several URL writes in one
   * tick, each built from the same params, and the last would put the others back.
   */
  onShowAll: () => void;
  groups: ReactNode;
  active: ActiveFilter[];
  onClearAll: () => void;
}) {
  const [open, setOpen] = useState(false);
  const text = useUiText();
  const t = text.catalogue.search;
  // Done hides itself with the panel, so focus would fall to the page without this.
  const toggle = useRef<HTMLButtonElement>(null);
  const panelId = useId();
  // From the pills, not the buttons: a hand-typed ?fb=open narrows the list for a viewer who has
  // no Reported button, and All must not claim the list is unfiltered then.
  const allPressed = !active.some((filter) => filter.key === "state" || filter.key === "reports");
  // The badge counts what the panel holds; the audio buttons show their own state.
  const inPanel = active.filter((filter) => filter.key !== "state" && filter.key !== "reports").length;

  return (
    <div className="cat-search">
      <div className="cat-q">
        <SearchIcon aria-hidden="true" />
        <input
          ref={inputRef}
          type="search"
          value={query}
          placeholder={placeholder}
          aria-label={t.label}
          autoFocus
          onChange={(event) => onQueryChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== "Enter" || !onQuerySubmit) return;
            event.preventDefault();
            onQuerySubmit();
          }}
        />
        {scope}
      </div>

      <div className="cat-row" role="group" aria-label={t.fields.state}>
        <button
          type="button"
          className="bs-chip"
          aria-pressed={allPressed}
          onClick={onShowAll}
        >
          {t.all}
          <Count value={audio.counts?.all} />
        </button>
        {AUDIO_STATES.map((state) => (
          <button
            key={state}
            type="button"
            className="bs-chip"
            aria-pressed={audio.state === state}
            onClick={() => audio.onState(audio.state === state ? undefined : state)}
          >
            <i className={cn("cat-dot", `cat-dot-${state}`)} aria-hidden="true" />
            {text.catalogue.facets.audio[state]}
            <Count value={audio.counts?.[state]} />
          </button>
        ))}
        {statuses.map((status) => (
          <button
            key={status.key}
            type="button"
            className="bs-chip"
            aria-pressed={status.pressed}
            onClick={status.onPress}
          >
            {status.tone ? <i className={cn("cat-dot", `cat-dot-${status.tone}`)} aria-hidden="true" /> : null}
            {status.label}
          </button>
        ))}
        <span className="cat-sep" aria-hidden="true" />
        <button
          type="button"
          ref={toggle}
          className="bs-chip cat-filters"
          aria-expanded={open}
          aria-controls={panelId}
          onClick={() => setOpen((was) => !was)}
        >
          <SlidersHorizontalIcon aria-hidden="true" />
          {t.filters}
          {inPanel > 0 ? <span className="cat-badge">{inPanel}</span> : null}
        </button>
      </div>

      <div id={panelId} hidden={!open} className="cat-panel">
        <div className="cat-fieldsets">{groups}</div>
        <div className="cat-panel-foot">
          <span>{t.note}</span>
          <button type="button" className="bs-btn bs-btn-text" onClick={onClearAll}>
            {t.clear}
          </button>
          <button
            type="button"
            className="bs-btn bs-btn-primary"
            onClick={() => {
              setOpen(false);
              toggle.current?.focus();
            }}
          >
            {t.done}
          </button>
        </div>
      </div>

      {active.length > 0 ? (
        <div className="cat-active" role="group" aria-label={t.inForce}>
          {active.map((filter) => (
            <span key={filter.key} className="cat-pill">
              <b>{filter.label}</b> {filter.value}
              <button type="button" aria-label={fill(t.remove, { label: filter.label })} onClick={filter.onRemove}>
                <XIcon aria-hidden="true" />
              </button>
            </span>
          ))}
          <button type="button" className="cat-clear" onClick={onClearAll}>
            {t.clear}
          </button>
        </div>
      ) : null}
    </div>
  );
}

export function FilterGroup({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  return (
    <fieldset className="cat-fieldset">
      <legend>{title}</legend>
      {description ? <p className="cat-fieldset-desc">{description}</p> : null}
      <div className="cat-fieldset-body">{children}</div>
    </fieldset>
  );
}

export function FilterField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="cat-field">
      <span className="cat-field-label">{label}</span>
      {children}
    </div>
  );
}

export type Option = { value: string; label: string };

/**
 * A closed list as a native select: fast to render with a thousand books in it, keyboard-searchable
 * by first letter, and the platform's own picker on a phone.
 */
export function FilterSelect({
  label,
  value,
  options,
  onChange,
  any,
}: {
  label: string;
  value: string | undefined;
  options: readonly Option[];
  onChange: (value: string | undefined) => void;
  any?: string;
}) {
  const known = value === undefined || options.some((option) => option.value === value);
  const fallback = useUiText().catalogue.search.any;
  const anyLabel = any ?? fallback;
  return (
    <FilterField label={label}>
      <select
        className={cn("cat-select", value !== undefined && "cat-set")}
        aria-label={label}
        value={value ?? ""}
        onChange={(event) => onChange(event.target.value === "" ? undefined : event.target.value)}
      >
        <option value="">{anyLabel}</option>
        {/* A deep-linked value missing from the list stays selected rather than silently dropped. */}
        {!known && value !== undefined ? <option value={value}>{value}</option> : null}
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </FilterField>
  );
}

/** Two to four choices as one row of buttons, the first meaning "no filter". */
export function FilterSegments({
  label,
  value,
  options,
  onChange,
  any,
}: {
  label: string;
  value: string | undefined;
  options: readonly Option[];
  onChange: (value: string | undefined) => void;
  any?: string;
}) {
  const fallback = useUiText().catalogue.search.any;
  const anyLabel = any ?? fallback;
  const all: { value: string | undefined; label: string }[] = [{ value: undefined, label: anyLabel }, ...options];
  return (
    <FilterField label={label}>
      <div className="cat-seg" role="group" aria-label={label}>
        {all.map((option) => (
          <button
            key={option.value ?? ""}
            type="button"
            aria-pressed={value === option.value}
            onClick={() => onChange(option.value)}
          >
            {option.label}
          </button>
        ))}
      </div>
    </FilterField>
  );
}

export function FilterChecks({
  options,
  values,
  onChange,
}: {
  options: readonly Option[];
  values: readonly string[] | undefined;
  onChange: (values: string[] | undefined) => void;
}) {
  const picked = new Set(values ?? []);
  return (
    <div className="cat-checks">
      {options.map((option) => (
        <label key={option.value} className="cat-check">
          <input
            type="checkbox"
            checked={picked.has(option.value)}
            onChange={(event) => {
              const next = options
                .map((each) => each.value)
                .filter((each) => (each === option.value ? event.target.checked : picked.has(each)));
              onChange(next.length > 0 ? next : undefined);
            }}
          />
          {option.label}
        </label>
      ))}
    </div>
  );
}

export function FilterToggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="cat-check">
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
      {label}
    </label>
  );
}

/** "Made between": the two ends of the generated-on range, as YYYY-MM-DD days. */
export function FilterDates({
  label,
  after,
  before,
  onChange,
}: {
  label: string;
  after: string | undefined;
  before: string | undefined;
  onChange: (next: { generatedAfter?: string; generatedBefore?: string }) => void;
}) {
  return (
    <FilterField label={label}>
      <div className="cat-two">
        <DateInput label={`${label}: from`} value={after} onCommit={(generatedAfter) => onChange({ generatedAfter })} />
        <DateInput label={`${label}: to`} value={before} onCommit={(generatedBefore) => onChange({ generatedBefore })} />
      </div>
    </FilterField>
  );
}

function DateInput({
  label,
  value,
  onCommit,
}: {
  label: string;
  value: string | undefined;
  onCommit: (value: string | undefined) => void;
}) {
  // Typing a year makes the browser report year 0002, 0020, 0202 on the way to 2026; written
  // through, each would be a history entry and a search. The draft holds them instead.
  const [draft, setDraft] = useState(value ?? "");
  const [shown, setShown] = useState(value);
  if (value !== shown) {
    setShown(value);
    setDraft(value ?? "");
  }
  return (
    <input
      type="date"
      className={cn("cat-select", value && "cat-set")}
      aria-label={label}
      value={draft}
      onChange={(event) => {
        const next = event.target.value;
        setDraft(next);
        if (next === "" || /^[1-9]\d{3}-/.test(next)) onCommit(next || undefined);
      }}
      // A half-typed year was never written, so leaving the field shows what filters the list.
      onBlur={() => setDraft(value ?? "")}
    />
  );
}

export function ScopeSelect({
  value,
  options,
  onChange,
}: {
  value: string;
  options: readonly Option[];
  onChange: (value: string) => void;
}) {
  const t = useUiText().catalogue.search;
  return (
    <select className="cat-scope" aria-label={t.scope} value={value} onChange={(event) => onChange(event.target.value)}>
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );
}

function Count({ value }: { value: number | undefined }) {
  if (value === undefined) return null;
  // The space keeps the accessible name "Missing 56", not "Missing56"; a flex row draws none.
  return (
    <>
      {" "}
      <span className="cat-count">{value.toLocaleString()}</span>
    </>
  );
}
