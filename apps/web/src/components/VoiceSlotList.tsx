"use client";

import { useLang } from "@/components/LangProvider";
import { BASE_LANG, langName, withLang } from "@/lib/lang";
import { cloneName } from "@/lib/voices/clone-name";
import { Fragment, useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { ChevronDown, Loader2, Pause, Pencil, Pin, Play, Search, Sparkles } from "lucide-react";

import FishReference, { type ReferenceView } from "./FishReference";
import VoiceSamples from "./VoiceSamples";
import AccountVoicePicker from "./voices/AccountVoicePicker";
import { cloneVoice } from "./voices/PopulateDialog";
import type { Provider } from "@/lib/generation/providers";
import { bareDirection } from "@/lib/generation/narration";
import { cn } from "@/lib/utils";
import { displayName } from "@/lib/voices/names";
import type { Sample } from "@/lib/voices/samples";
import type { VoiceSlot } from "@/lib/voices/slots";

/**
 * The roster: every voice the corpus needs, as one provider sees it.
 *
 * What a row says depends on the tab. On ElevenLabs it is whether the clone is in the viewer's
 * own account; on fish.audio it is the reference sent with every line. Either way the sources
 * are only heard here: changing them is the language admin's, behind `editing`, because every
 * collaborator's voices are made from them.
 *
 * A healthy voice is a quiet row, so the few that need somebody stand out, and the filter chips
 * count them. A race's accent is on its group header and a voice's own direction in its row,
 * the two places they apply. Any number of rows can be open, to compare two voices' clips side
 * by side; the <audio> elements are preload="none", so an open row costs no request until it
 * is played.
 */

/** A race and the voices under it, in the order slots.ts already sorted them. */
type Group = {
  race: string;
  slots: VoiceSlot[];
  npcCount: number;
  lineCount: number;
};

/**
 * Races from the roster itself rather than from the corpus facets.
 *
 * The two agree today. Deriving them here keeps a race with no voice slot from appearing as
 * a header with nothing under it, and means this list cannot disagree with the rows it heads.
 */
function groups(slots: VoiceSlot[]): Group[] {
  const byRace = new Map<string, Group>();
  for (const slot of slots) {
    const race = raceOf(slot);
    const group = byRace.get(race) ?? { race, slots: [], npcCount: 0, lineCount: 0 };
    group.slots.push(slot);
    // Summed rather than counted distinctly: an NPC speaks with one voice, so no NPC is in
    // two of a race's slots.
    group.npcCount += slot.npcCount;
    group.lineCount += slot.lineCount;
    byRace.set(race, group);
  }
  return [...byRace.values()];
}

function raceOf(slot: VoiceSlot): string {
  return slot.name.split("-")[0];
}

/** Every direction without its square brackets, as the boxes show and take them. */
function bare(tags: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(tags).map(([key, tag]) => [key, bareDirection(tag)]));
}

function plural(count: number, one: string, many: string): string {
  return `${count.toLocaleString()} ${count === 1 ? one : many}`;
}

type Status = { tone: "good" | "fix" | "bad" | "info" | "quiet"; label: string; pinned?: boolean };

type Filter = { key: string; label: string; tone?: Status["tone"]; test: (slot: VoiceSlot) => boolean };

type Props = {
  tab: Provider;
  slots: VoiceSlot[];
  /**
   * Voice names present in the viewer's ElevenLabs account, or null when it could not be
   * read. Held by the page, so a voice cloned here or from the populate dialog flips both.
   */
  present: Set<string> | null;
  setPresent: Dispatch<SetStateAction<Set<string> | null>>;
  samples: Record<string, Sample[]>;
  setSamples: Dispatch<SetStateAction<Record<string, Sample[]>>>;
  /** Slots with seed clips to import in this language. */
  seedSlots: string[];
  /** This language's fish.audio references, by voice. */
  references: Record<string, ReferenceView>;
  setReferences: Dispatch<SetStateAction<Record<string, ReferenceView>>>;
  /** The directions per race and per voice, as the settings currently in force hold them. */
  raceTags: Record<string, string>;
  /**
   * May change this language's directions: a `configure` grant in it, not only a global admin,
   * since the directions are the language's own.
   */
  directs: boolean;
  /** The sources' editors are showing: an admin asked for them. */
  editing: boolean;
  /** Whether the viewer has an ElevenLabs key to clone into. */
  canClone: boolean;
};

export default function VoiceSlotList({
  tab,
  slots,
  present,
  setPresent,
  samples,
  setSamples,
  seedSlots,
  references,
  setReferences,
  raceTags,
  directs,
  editing,
  canClone,
}: Props) {
  const lang = useLang();
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set());
  const [query, setQuery] = useState("");
  // Kept with the tab it was picked on: "No reference" means nothing on ElevenLabs.
  const [picked, setPicked] = useState<{ tab: Provider; key: string }>({ tab, key: "all" });
  const filter = picked.tab === tab ? picked.key : "all";
  const setFilter = (key: string) => setPicked({ tab, key });
  // Bare, as typed: settings.ts puts the brackets back on save.
  const [tags, setTags] = useState(() => bare(raceTags));
  // The last value written, so a box that was edited and put back does not claim a save.
  const [saved, setSaved] = useState(() => bare(raceTags));
  const [tagError, setTagError] = useState<string | null>(null);
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [accentOpen, setAccentOpen] = useState<string | null>(null);
  const [sweep, setSweep] = useState<{
    done: number;
    total: number;
    failed: string[];
  } | null>(null);
  const [confirmingSweep, setConfirmingSweep] = useState(false);
  const player = usePlayer(tab);

  const seedable = slots.filter((slot) => seedSlots.includes(slot.name));

  // Voices that do not exist in the account yet. Empty while the account could not be read,
  // because "missing" would then mean "unknown" and the button would offer to rebuild
  // everything under a name that promises not to.
  const missing = present === null ? [] : seedable.filter((slot) => !present.has(slot.name));

  /**
   * Seed and clone a list of voices from voice/seed-clips.
   *
   * Sequential rather than parallel: each iteration is an ffmpeg merge and an ElevenLabs
   * voice creation, and fifty of those at once is neither kind to the rate limit nor
   * something whose failures could be reported one at a time. A failure is recorded and the
   * sweep continues, so one bad voice does not cost the other forty-nine.
   */
  async function seed(targets: VoiceSlot[]) {
    setConfirmingSweep(false);
    setSweep({ done: 0, total: targets.length, failed: [] });

    for (const [index, slot] of targets.entries()) {
      try {
        const json = { "Content-Type": "application/json" };
        const imported = await fetch(withLang(lang, `/api/voices/${slot.name}/samples/import`), {
          method: "POST",
          headers: json,
          body: JSON.stringify({ replace: true }),
        });
        if (!imported.ok) throw new Error(String(imported.status));

        const cloned = await fetch(withLang(lang, `/api/voices/${slot.name}/clone`), {
          method: "POST",
          headers: json,
          body: JSON.stringify({ replace: true }),
        });
        if (!cloned.ok) throw new Error(String(cloned.status));

        const payload = await imported.json();
        setSamples((current) => ({ ...current, [slot.name]: payload.samples }));
        setPresent((current) => new Set(current ?? []).add(slot.name));
      } catch {
        setSweep((current) => current && { ...current, failed: [...current.failed, slot.name] });
      }
      setSweep((current) => current && { ...current, done: index + 1 });
    }
  }

  const sweeping = sweep !== null && sweep.done < sweep.total;
  const races = groups(slots);

  /** The set with `key` in it if it was not, and without it if it was. */
  function toggled(set: ReadonlySet<string>, key: string): ReadonlySet<string> {
    const next = new Set(set);
    if (!next.delete(key)) next.add(key);
    return next;
  }

  /**
   * Write the whole map, on blur, when this race's or voice's box actually changed.
   *
   * The whole map rather than the one race because removing a direction is as much an edit as
   * adding one, and the endpoint takes what the tags should now be. On blur rather than per
   * keystroke because every save is a row write and a half-typed "[Scot" is not a direction
   * anyone meant to store.
   */
  async function saveTags(key: string) {
    const next = { ...tags };
    if (!next[key]?.trim()) delete next[key];
    if ((saved[key] ?? "") === (next[key] ?? "")) return;

    setSavingKey(key);
    setTagError(null);
    try {
      const response = await fetch(withLang(lang, "/api/generation/settings/race-tags"), {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ raceTags: next }),
      });
      const body = await response.json();
      if (!response.ok) {
        setTagError(body.error ?? `could not save (${response.status})`);
        // Back to what the server holds, so the box never shows a direction that is not in
        // force - the generation would not use it, and nothing else on the page would say so.
        setTags(saved);
        return;
      }
      const stored = bare(body.config.raceTags as Record<string, string>);
      setTags(stored);
      setSaved(stored);
    } catch (caught) {
      setTagError(caught instanceof Error ? caught.message : String(caught));
      setTags(saved);
    } finally {
      setSavingKey(null);
    }
  }

  /**
   * The direction box for a race or one voice, for whoever configures the language.
   *
   * On both tabs: the language holds one set, and speakers/shape.ts puts it in front of the
   * NPC's words whichever provider speaks them.
   */
  function directionInput(key: string, placeholder: string, autoFocus = false) {
    return (
      <input
        aria-label={`Direction for ${key}`}
        title="Direction, sent to ElevenLabs and fish.audio alike; a voice's follows its race's"
        value={tags[key] ?? ""}
        // No brackets: they are added on save, and typing them is harmless.
        placeholder={placeholder}
        disabled={savingKey !== null}
        autoFocus={autoFocus}
        onChange={(event) => setTags((current) => ({ ...current, [key]: event.target.value }))}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === "Escape") event.currentTarget.blur();
        }}
        onBlur={() => {
          void saveTags(key);
          if (accentOpen === key) setAccentOpen(null);
        }}
        className="vo-input"
      />
    );
  }

  function status(slot: VoiceSlot): Status {
    if (tab === "fish") {
      const reference = references[slot.name];
      if (!reference) return { tone: "quiet", label: "No reference" };
      return reference.pinned
        ? { tone: "info", label: "Pinned to fish.audio", pinned: true }
        : { tone: "info", label: "Reference" };
    }
    // Before the clips: a voice adopted from the account has none.
    if (present?.has(slot.name)) return { tone: "good", label: "In your account" };
    if ((samples[slot.name] ?? []).length === 0) return { tone: "bad", label: "No clips" };
    if (present === null) return { tone: "quiet", label: "Unknown" };
    return { tone: "fix", label: "Not in your account" };
  }

  // On the saved directions, so a row being edited does not filter itself away before its save.
  const directed = (slot: VoiceSlot) => Boolean(saved[slot.name] || saved[raceOf(slot)]);
  const filters: Filter[] =
    tab === "elevenlabs"
      ? [
          { key: "all", label: "All", test: () => true },
          { key: "missing", label: "Not in your account", tone: "fix", test: (s) => status(s).tone === "fix" },
          { key: "noclips", label: "No clips", tone: "bad", test: (s) => status(s).tone === "bad" },
          { key: "unused", label: "No NPCs", tone: "quiet", test: (s) => s.npcCount === 0 },
          { key: "directed", label: "Has a direction", test: directed },
        ]
      : [
          { key: "all", label: "All", test: () => true },
          { key: "noref", label: "No reference", tone: "quiet", test: (s) => !references[s.name] },
          { key: "pinned", label: "Pinned", tone: "info", test: (s) => Boolean(references[s.name]?.pinned) },
          { key: "unused", label: "No NPCs", tone: "quiet", test: (s) => s.npcCount === 0 },
          { key: "directed", label: "Has a direction", test: directed },
        ];
  const activeFilter = filters.find((each) => each.key === filter) ?? filters[0];
  const needle = query.trim().toLowerCase();
  const matches = (slot: VoiceSlot) =>
    activeFilter.test(slot) &&
    (!needle ||
      slot.name.includes(needle) ||
      (saved[slot.name] ?? "").toLowerCase().includes(needle) ||
      (saved[raceOf(slot)] ?? "").toLowerCase().includes(needle));
  const shown = slots.filter(matches).length;

  /** The clip a row's play button plays: the reference on fish.audio, the first clip otherwise. */
  function previewSrc(slot: VoiceSlot): string | null {
    if (tab === "fish") {
      const reference = references[slot.name];
      return reference
        ? withLang(lang, `/api/voices/${slot.name}/reference/audio?v=${reference.clipHash}`)
        : null;
    }
    const first = (samples[slot.name] ?? [])[0];
    return first ? withLang(lang, `/api/voices/${slot.name}/samples/${first.file}`) : null;
  }

  return (
    <>
      {editing && (
        <div className="vo-editbar">
          <Pencil aria-hidden />
          <span>
            Editing sources. Open a voice to change its clips{tab === "fish" ? " or its reference" : ""}; every
            maintainer&apos;s voices are made from them.
          </span>
          {tab === "elevenlabs" && seedable.length > 0 && (
            <span className="vo-editbar-actions">
              {confirmingSweep ? (
                <>
                  <span className="vo-warn">
                    Replaces the clips and the ElevenLabs voice for all {seedable.length}{" "}
                    {langName(lang)} voices ({cloneName(seedable[0]?.name ?? "dwarf-male-grim", lang)} and
                    the rest). They are deleted and re-created, so they will not sound the same
                    afterwards.
                    {lang !== BASE_LANG && " Other languages' voices are separate clones and are not touched."}
                  </span>
                  <button type="button" className="bs-btn bs-btn-danger vo-sm" onClick={() => seed(seedable)}>
                    Confirm — rebuild all
                  </button>
                  <button type="button" className="bs-btn bs-btn-text vo-sm" onClick={() => setConfirmingSweep(false)}>
                    Cancel
                  </button>
                </>
              ) : (
                <>
                  {/* No confirmation: this only fills gaps, so nothing that exists is destroyed. */}
                  {missing.length > 0 && (
                    <button type="button" className="bs-btn vo-outline vo-sm" disabled={sweeping} onClick={() => seed(missing)}>
                      {sweeping ? <Loader2 className="animate-spin" /> : <Sparkles />}
                      Seed remaining from clips ({missing.length})
                    </button>
                  )}
                  <button
                    type="button"
                    className="bs-btn vo-outline vo-sm"
                    disabled={sweeping}
                    onClick={() => setConfirmingSweep(true)}
                  >
                    {sweeping ? <Loader2 className="animate-spin" /> : <Sparkles />}
                    Seed all from clips
                  </button>
                </>
              )}
              {sweep && !confirmingSweep && (
                <span className="vo-note tabular-nums">
                  {sweep.done} / {sweep.total}
                  {sweep.failed.length > 0 && <span className="vo-bad"> · failed: {sweep.failed.join(", ")}</span>}
                </span>
              )}
            </span>
          )}
        </div>
      )}

      <div className="cat-search">
        <label className="cat-q vo-q">
          <Search aria-hidden />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Voice, race or direction"
            aria-label="Search voices"
          />
          <span className="vo-q-count">
            {shown === slots.length ? plural(slots.length, "voice", "voices") : `${shown} of ${slots.length} voices`}
          </span>
        </label>
        <div className="cat-row" role="group" aria-label="Show">
          {filters.map((each) => {
            const count = slots.filter(each.test).length;
            // An empty chip is a promise of nothing: it shows only while it is the one picked.
            if (count === 0 && each.key !== "all" && each.key !== filter) return null;
            return (
              <button
                key={each.key}
                type="button"
                className="bs-chip"
                aria-pressed={filter === each.key}
                onClick={() => setFilter(each.key)}
              >
                {each.tone && <i className={cn("vo-dot", `vo-tone-${each.tone}`)} aria-hidden />}
                {each.label}
                <span className="cat-count">{count}</span>
              </button>
            );
          })}
        </div>
      </div>

      {tagError && (
        <p role="alert" className="vo-alert">
          {tagError}
        </p>
      )}

      {shown === 0 ? (
        <p className="cat-empty">No voice matches. Clear the search or pick All.</p>
      ) : (
        <div className="cat-list">
          <table className="cat-table vo-table">
            <colgroup>
              <col className="vo-col-play" />
              <col />
              <col className="vo-col-speaks" />
              <col className="vo-col-status" />
              <col className="vo-col-dir" />
              <col className="vo-col-chev" />
            </colgroup>
            <thead>
              <tr>
                <th>
                  <span className="sr-only">Play</span>
                </th>
                <th>Voice</th>
                <th>Speaks</th>
                <th>{tab === "elevenlabs" ? "ElevenLabs" : "fish.audio"}</th>
                <th>Direction</th>
                <th>
                  <span className="sr-only">Open</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {races.map((group) => {
                const rows = group.slots.filter(matches);
                if (rows.length === 0) return null;
                // A race with one voice is its own row: a header over a single row says it twice.
                const solo = group.slots.length === 1;
                const accent = tags[group.race];
                return (
                  <Fragment key={group.race}>
                    {!solo && (
                      <tr className="cat-group">
                        <th colSpan={6}>
                          <div className="vo-group">
                            <span className="cat-group-name">{group.race}</span>
                            <span>
                              {plural(group.slots.length, "voice", "voices")} ·{" "}
                              {plural(group.lineCount, "line", "lines")}
                            </span>
                            <span className="vo-accent">
                              {accentOpen === group.race ? (
                                directionInput(group.race, "no accent direction", true)
                              ) : (
                                <>
                                  {accent ? (
                                    <>
                                      <span className="vo-accent-label">Accent</span>
                                      <span className="vo-accent-text" title={accent}>
                                        {accent}
                                      </span>
                                    </>
                                  ) : (
                                    <span className="vo-faint">No accent</span>
                                  )}
                                  {directs && (
                                    <button
                                      type="button"
                                      className="vo-icon-btn"
                                      title={`Change the accent for ${group.race}`}
                                      aria-label={`Change the accent for ${group.race}`}
                                      onClick={() => setAccentOpen(group.race)}
                                    >
                                      <Pencil />
                                    </button>
                                  )}
                                </>
                              )}
                            </span>
                          </div>
                        </th>
                      </tr>
                    )}
                    {rows.map((slot) => {
                      const clips = samples[slot.name] ?? [];
                      const expanded = open.has(slot.name);
                      const state = status(slot);
                      const src = previewSrc(slot);
                      const playing = player.playing === src && src !== null;
                      const toggle = () => setOpen((current) => toggled(current, slot.name));
                      const own = tags[slot.name];
                      return (
                        <Fragment key={slot.name}>
                          <tr
                            className={cn("cat-tr vo-tr", solo && "vo-solo", expanded && "cat-current")}
                            onClick={toggle}
                          >
                            <td className="cat-cell-play">
                              <button
                                type="button"
                                className="cat-play"
                                disabled={src === null}
                                aria-current={playing ? "true" : undefined}
                                aria-label={playing ? `Stop ${slot.name}` : `Hear ${slot.name}`}
                                title={src === null ? "Nothing to hear yet" : undefined}
                                onClick={(event) => {
                                  event.stopPropagation();
                                  if (src) player.toggle(src);
                                }}
                              >
                                {playing ? <Pause /> : <Play />}
                              </button>
                            </td>
                            <td>
                              <button
                                type="button"
                                className="vo-name"
                                aria-expanded={expanded}
                                onClick={(event) => {
                                  event.stopPropagation();
                                  toggle();
                                }}
                              >
                                {!solo && slot.name.startsWith(`${group.race}-`) ? (
                                  <>
                                    <span className="vo-faint">{group.race}-</span>
                                    {slot.name.slice(group.race.length + 1)}
                                  </>
                                ) : (
                                  slot.name
                                )}
                              </button>
                            </td>
                            <td className={cn("vo-speaks", slot.npcCount === 0 && "vo-faint")}>
                              {slot.npcCount === 0
                                ? "No NPCs"
                                : `${plural(slot.npcCount, "NPC", "NPCs")} · ${plural(slot.lineCount, "line", "lines")}`}
                            </td>
                            <td>
                              <span className={cn("vo-state", `vo-tone-${state.tone}`)}>
                                {state.pinned ? <Pin aria-hidden /> : <i aria-hidden />}
                                {state.label}
                              </span>
                            </td>
                            <td>
                              <span className={cn("vo-dir", !own && "vo-faint")} title={own ?? accent ?? undefined}>
                                {own || (accent ? `↳ ${solo ? accent : "race accent"}` : "—")}
                              </span>
                            </td>
                            <td>
                              <ChevronDown className={cn("vo-chev", expanded && "vo-chev-open")} aria-hidden />
                            </td>
                          </tr>
                          {expanded && (
                            <tr className="vo-open-row">
                              <td colSpan={6}>
                                <div className="vo-panel">
                                  <div className="min-w-0">
                                    {tab === "elevenlabs" && !editing && (
                                      <ClonePanel
                                        voice={slot.name}
                                        samples={clips}
                                        exists={present?.has(slot.name) ?? false}
                                        canClone={canClone && present !== null}
                                        onCloned={() =>
                                          setPresent((current) => new Set(current ?? []).add(slot.name))
                                        }
                                      />
                                    )}
                                    {tab === "fish" && !editing && (
                                      <ReferencePlayer voice={slot.name} reference={references[slot.name] ?? null} />
                                    )}
                                    {tab === "elevenlabs" && editing && (
                                      <VoiceSamples
                                        voice={slot.name}
                                        samples={clips}
                                        hasSeedClips={seedSlots.includes(slot.name)}
                                        exists={present?.has(slot.name) ?? false}
                                        onChange={(next) =>
                                          setSamples((current) => ({ ...current, [slot.name]: next }))
                                        }
                                        onCloned={() =>
                                          setPresent((current) => new Set(current ?? []).add(slot.name))
                                        }
                                      />
                                    )}
                                    {tab === "fish" && editing && (
                                      <FishReference
                                        voice={slot.name}
                                        samples={clips}
                                        hasSeedClips={seedSlots.includes(slot.name)}
                                        onSamples={(next) =>
                                          setSamples((current) => ({ ...current, [slot.name]: next }))
                                        }
                                        initial={references[slot.name] ?? null}
                                        onChange={(next) =>
                                          setReferences((current) => {
                                            const { [slot.name]: _, ...rest } = current;
                                            return next ? { ...rest, [slot.name]: next } : rest;
                                          })
                                        }
                                      />
                                    )}
                                  </div>
                                  <div className="vo-side">
                                    {solo && (
                                      <label className="vo-field">
                                        <span className="bs-label">Accent for {group.race}</span>
                                        {directs ? (
                                          directionInput(group.race, "no accent direction")
                                        ) : (
                                          <span className="vo-mono">{accent || "none"}</span>
                                        )}
                                      </label>
                                    )}
                                    <label className="vo-field">
                                      <span className="bs-label">Direction for this voice</span>
                                      {directs ? (
                                        directionInput(
                                          slot.name,
                                          accent ? `follows the race: ${accent}` : "none — speaks plainly",
                                        )
                                      ) : (
                                        <span className="vo-mono">{own || (accent ? `follows the race: ${accent}` : "none")}</span>
                                      )}
                                    </label>
                                    <p className="vo-note">Sent to ElevenLabs and fish.audio alike.</p>
                                  </div>
                                </div>
                              </td>
                            </tr>
                          )}
                        </Fragment>
                      );
                    })}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

/**
 * One <audio> for the whole list, so starting a voice stops the last one rather than talking
 * over it.
 */
function usePlayer(tab: Provider) {
  const audio = useRef<HTMLAudioElement | null>(null);
  // Which request is current, so a play() an older one lost does not clear the newer one.
  const request = useRef(0);
  const [playing, setPlaying] = useState<string | null>(null);

  // Stopped on a provider switch, which hides the row that could stop it.
  useEffect(
    () => () => {
      request.current++;
      audio.current?.pause();
      setPlaying(null);
    },
    [tab],
  );

  function toggle(src: string) {
    if (!audio.current) {
      audio.current = new Audio();
      audio.current.onended = () => setPlaying(null);
      audio.current.onerror = () => setPlaying(null);
    }
    const mine = ++request.current;
    if (playing === src) {
      audio.current.pause();
      setPlaying(null);
      return;
    }
    audio.current.src = src;
    void audio.current.play().catch(() => {
      if (request.current === mine) setPlaying(null);
    });
    setPlaying(src);
  }

  return { playing, toggle };
}

/**
 * One voice on the ElevenLabs tab: the clips it is cloned from, to listen to, and putting it
 * into the viewer's own account.
 */
function ClonePanel({
  voice,
  samples,
  exists,
  canClone,
  onCloned,
}: {
  voice: string;
  samples: Sample[];
  exists: boolean;
  canClone: boolean;
  onCloned: () => void;
}) {
  const lang = useLang();
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function clone() {
    setConfirming(false);
    setBusy(true);
    setError(null);
    const failure = await cloneVoice(lang, voice, exists);
    setBusy(false);
    if (failure) setError(failure);
    else onCloned();
  }

  if (samples.length === 0) {
    return (
      <div>
        <p className="vo-note">
          No clips for this voice in {langName(lang)} yet, so there is nothing to clone.
        </p>
        {canClone && (
          <div className="vo-actions">
            <AccountVoicePicker voice={voice} exists={exists} onAdopted={onCloned} />
          </div>
        )}
      </div>
    );
  }

  return (
    <div>
      <p className="bs-label">{plural(samples.length, "clip", "clips")}</p>
      <ul className="vo-clips">
        {samples.map((sample) => (
          <li key={sample.file}>
            <audio controls preload="none" src={withLang(lang, `/api/voices/${voice}/samples/${sample.file}`)} />
            <span className="vo-clip-name">{displayName(sample.file)}</span>
          </li>
        ))}
      </ul>

      {canClone && (
        <div className="vo-actions">
          <span className={cn("vo-state", exists ? "vo-tone-good" : "vo-tone-fix")}>
            <i aria-hidden />
            {exists ? (
              <>
                In your account as <span className="vo-mono">{cloneName(voice, lang)}</span>
              </>
            ) : (
              "Not in your account yet"
            )}
          </span>
          <button
            type="button"
            className={cn("bs-btn vo-sm", confirming ? "bs-btn-danger" : exists ? "vo-outline" : "bs-btn-primary")}
            disabled={busy}
            onClick={() => (exists && !confirming ? setConfirming(true) : clone())}
          >
            {busy ? <Loader2 className="animate-spin" /> : <Sparkles />}
            {confirming ? "Confirm replace" : exists ? "Replace in my account" : "Add to my account"}
          </button>
          {!confirming && <AccountVoicePicker voice={voice} exists={exists} disabled={busy} onAdopted={onCloned} />}
          {confirming ? (
            <>
              <span className="vo-warn">
                Deletes <code>{cloneName(voice, lang)}</code> from your ElevenLabs account and clones it
                again from these clips; it will not sound quite the same.
              </span>
              <button type="button" className="bs-btn bs-btn-text vo-sm" onClick={() => setConfirming(false)}>
                Cancel
              </button>
            </>
          ) : (
            !exists && <span className="vo-note">Uses one voice slot.</span>
          )}
        </div>
      )}

      {error && (
        <p role="alert" className="vo-bad vo-note">
          {error}
        </p>
      )}
    </div>
  );
}

/** One voice on the fish.audio tab: the reference it is spoken from, and nothing else. */
function ReferencePlayer({ voice, reference }: { voice: string; reference: ReferenceView | null }) {
  const lang = useLang();
  if (!reference) {
    return <p className="vo-note">No fish.audio reference for this voice in {langName(lang)} yet.</p>;
  }
  return (
    <div>
      <p className="bs-label">Reference</p>
      <audio
        controls
        preload="none"
        // The hash in the URL makes a re-cut clip a new resource, not a cached old one.
        src={withLang(lang, `/api/voices/${voice}/reference/audio?v=${reference.clipHash}`)}
        className="vo-reference"
      />
      {reference.pinned && (
        <p className="vo-note">
          Pinned: every line of this voice is spoken by fish.audio, whichever generator is active.
        </p>
      )}
    </div>
  );
}
