"use client";

import { useLang } from "@/components/LangProvider";
import { BASE_LANG, langName, withLang } from "@/lib/lang";
import { cloneName } from "@/lib/voices/clone-name";
import { useState, type Dispatch, type SetStateAction } from "react";
import { ChevronDown, ChevronRight, Loader2, Sparkles } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

import FishReference, { type ReferenceView } from "./FishReference";
import VoiceSamples from "./VoiceSamples";
import AccountVoicePicker from "./voices/AccountVoicePicker";
import { cloneVoice } from "./voices/PopulateDialog";
import { Badge } from "@/components/ui/badge";
import type { Provider } from "@/lib/generation/providers";
import { bareDirection } from "@/lib/generation/narration";
import { cn } from "@/lib/utils";
import { displayName } from "@/lib/voices/names";
import type { Sample } from "@/lib/voices/samples";
import type { VoiceSlot } from "@/lib/voices/slots";

/**
 * The roster: every voice the corpus needs, as one provider sees it.
 *
 * What a row shows depends on the tab. On ElevenLabs it is the clips a voice is cloned from
 * and whether the clone is in the viewer's own account; on fish.audio it is the reference
 * that is sent with every line. Either way the sources are only heard here: changing them is
 * an admin's, behind `editing`, because every collaborator's voices are made from them.
 *
 * Ordered by name (see slots.ts): with a voice per race, gender and flavor the list is long
 * enough that finding one row matters more than knowing which to create first. Any number of
 * rows can be open, to compare two voices' clips side by side; the <audio> elements are
 * preload="none", so an open row costs no request until it is played.
 *
 * Grouped by race, every group open: the races are the headings to scan by, and the voices
 * under them are rows to click into. A race's direction is on its header and a voice's own on
 * its row, the two places they apply.
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
    const race = slot.name.split("-")[0];
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

/** Every direction without its square brackets, as the boxes show and take them. */
function bare(tags: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(tags).map(([key, tag]) => [key, bareDirection(tag)]));
}

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
  /** VoiceStudio profiles matching these slots in the current language. */
  voiceStudioPresent: Set<string> | null;
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
  voiceStudioPresent,
}: Props) {
  const lang = useLang();
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set());
  const [openRaces, setOpenRaces] = useState<ReadonlySet<string>>(
    () => new Set(groups(slots).map((group) => group.race)),
  );
  // Bare, as typed: settings.ts puts the brackets back on save.
  const [tags, setTags] = useState(() => bare(raceTags));
  // The last value written, so a box that was edited and put back does not claim a save.
  const [saved, setSaved] = useState(() => bare(raceTags));
  const [tagError, setTagError] = useState<string | null>(null);
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [sweep, setSweep] = useState<{
    done: number;
    total: number;
    failed: string[];
  } | null>(null);
  const [confirmingSweep, setConfirmingSweep] = useState(false);

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
   * The direction box for a race or one voice: editable for whoever configures the language,
   * read-only otherwise.
   *
   * On both tabs: the language holds one set, and speakers/shape.ts puts it in front of the
   * NPC's words whichever provider speaks them.
   */
  function direction(key: string, placeholder: string) {
    if (!directs) {
      return tags[key] ? (
        <span
          title="Direction"
          className="text-muted-foreground w-56 shrink-0 truncate font-mono text-xs"
        >
          {tags[key]}
        </span>
      ) : (
        <span className="w-56 shrink-0" />
      );
    }
    return (
      <Input
        aria-label={`Direction for ${key}`}
        title="Direction, sent to ElevenLabs and fish.audio alike; a voice's follows its race's"
        value={tags[key] ?? ""}
        // No brackets: they are added on save, and typing them is harmless.
        placeholder={placeholder}
        disabled={savingKey !== null}
        onChange={(event) => setTags((current) => ({ ...current, [key]: event.target.value }))}
        onBlur={() => void saveTags(key)}
        className="h-7 w-56 shrink-0 font-mono text-xs"
      />
    );
  }

  return (
    <>
      {editing && tab === "elevenlabs" && seedable.length > 0 && (
        <div className="mb-3 flex flex-wrap items-center gap-3">
          <Button
            size="xs"
            variant={confirmingSweep ? "destructive" : "outline"}
            disabled={sweeping}
            onClick={() => (confirmingSweep ? seed(seedable) : setConfirmingSweep(true))}
          >
            {sweeping ? <Loader2 className="animate-spin" /> : <Sparkles />}
            {confirmingSweep ? "Confirm — rebuild all" : "Seed all from clips"}
          </Button>

          {/* No confirmation: this only fills gaps, so nothing that exists is destroyed. */}
          {missing.length > 0 && !confirmingSweep && (
            <Button size="xs" variant="outline" disabled={sweeping} onClick={() => seed(missing)}>
              {sweeping ? <Loader2 className="animate-spin" /> : <Sparkles />}
              Seed remaining from clips ({missing.length})
            </Button>
          )}

          {confirmingSweep && (
            <>
              <span className="text-xs text-amber-400">
                This replaces the clips and the ElevenLabs voice for all {seedable.length}{" "}
                {langName(lang)} voices ({cloneName(seedable[0]?.name ?? "dwarf-male-grim", lang)}
                {" "}and the rest). Existing {langName(lang)} voices are deleted and re-created, so
                they will not sound the same afterwards.
                {lang !== BASE_LANG && " Other languages' voices are separate clones and are not touched."}
              </span>
              <Button variant="ghost" size="xs" onClick={() => setConfirmingSweep(false)}>
                Cancel
              </Button>
            </>
          )}

          {sweep && !confirmingSweep && (
            <span className="text-muted-foreground text-xs tabular-nums">
              {sweep.done} / {sweep.total}
              {sweep.failed.length > 0 && (
                <span className="text-destructive"> · failed: {sweep.failed.join(", ")}</span>
              )}
            </span>
          )}
        </div>
      )}

      {tagError && (
        <div
          role="alert"
          className="border-destructive/40 bg-destructive/10 text-destructive mb-3 rounded-md border px-3 py-2 text-sm"
        >
          {tagError}
        </div>
      )}

      <div className="divide-y overflow-hidden rounded-md border">
        {races.map((group) => {
          const openGroup = openRaces.has(group.race);

          return (
            <div key={group.race}>
              {/* Not a <button>: the accent box lives on this row, and a text input inside a
                  button is neither valid nor focusable the way anyone expects. */}
              <div
                className={cn(
                  "flex w-full items-center gap-3 px-3 py-2 text-sm",
                  openGroup && "bg-muted/50",
                )}
              >
                <button
                  onClick={() => setOpenRaces((current) => toggled(current, group.race))}
                  aria-expanded={openGroup}
                  className={cn(
                    "hover:text-foreground flex min-w-0 flex-1 items-center gap-3 text-left",
                    "focus-visible:ring-ring/50 focus-visible:ring-[3px] focus-visible:outline-none",
                  )}
                >
                  {openGroup ? (
                    <ChevronDown className="size-4 shrink-0" />
                  ) : (
                    <ChevronRight className="text-muted-foreground size-4 shrink-0" />
                  )}
                  <span className="min-w-0 flex-1 font-medium">{group.race}</span>
                  <span className="text-muted-foreground shrink-0 text-xs tabular-nums">
                    {group.slots.length} {group.slots.length === 1 ? "voice" : "voices"} ·{" "}
                    {group.npcCount.toLocaleString()} NPCs · {group.lineCount.toLocaleString()}{" "}
                    lines
                  </span>
                </button>

                {direction(group.race, "no accent direction")}
              </div>

              {openGroup &&
                group.slots.map((slot) => {
                  const clips = samples[slot.name] ?? [];
                  const expanded = open.has(slot.name);

                  return (
                    <div key={slot.name} className="border-t">
                      {/* Not one <button>, for the same reason as the race header: the
                          voice's own direction box lives on this row. */}
                      <div
                        className={cn(
                          "hover:bg-muted/50 flex w-full items-center gap-3 py-2 pr-3 pl-9 text-sm",
                          expanded && "bg-muted/50",
                        )}
                      >
                        <button
                          onClick={() => setOpen((current) => toggled(current, slot.name))}
                          aria-expanded={expanded}
                          className={cn(
                            "flex min-w-0 flex-1 items-center gap-3 text-left",
                            "focus-visible:ring-ring/50 focus-visible:ring-[3px] focus-visible:outline-none",
                          )}
                        >
                          {expanded ? (
                            <ChevronDown className="size-4 shrink-0" />
                          ) : (
                            <ChevronRight className="text-muted-foreground size-4 shrink-0" />
                          )}
                          <span className="min-w-0 flex-1 font-medium">{slot.name}</span>
                          <span className="text-muted-foreground shrink-0 text-xs tabular-nums">
                            {slot.npcCount.toLocaleString()} NPCs ·{" "}
                            {slot.lineCount.toLocaleString()} lines
                          </span>
                          <span className="w-36 shrink-0 text-right">
                            {tab === "fish" ? (
                              references[slot.name] ? (
                                <Badge variant="outline" className="text-sky-400">
                                  reference
                                </Badge>
                              ) : (
                                <span className="text-muted-foreground text-xs">no reference</span>
                              )
                            ) : (tab === "voicestudio"
                                ? voiceStudioPresent?.has(slot.name)
                                : present?.has(slot.name)) ? (
                              // Before the clips: a voice adopted from the account has none.
                              <Badge variant="outline" className="text-emerald-400">
                                {tab === "voicestudio" ? "profile available" : "in your account"}
                              </Badge>
                            ) : tab === "voicestudio" && voiceStudioPresent === null ? (
                              <span className="text-muted-foreground text-xs">unknown</span>
                            ) : tab === "voicestudio" ? (
                              <span className="text-muted-foreground text-xs">profile missing</span>
                            ) : clips.length === 0 ? (
                              <span className="text-muted-foreground text-xs">no clips</span>
                            ) : present === null ? (
                              <span className="text-muted-foreground text-xs">unknown</span>
                            ) : (
                              <span className="text-muted-foreground text-xs">not in your account</span>
                            )}
                          </span>
                        </button>
                        {direction(slot.name, "only the race's")}
                      </div>

                      {expanded && tab === "elevenlabs" && !editing && (
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
                      {expanded && tab === "fish" && !editing && (
                        <ReferencePlayer voice={slot.name} reference={references[slot.name] ?? null} />
                      )}
                      {expanded && tab === "elevenlabs" && editing && (
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
                      {expanded && tab === "fish" && editing && (
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
                      {expanded && tab === "voicestudio" && !editing && (
                        <p className="text-muted-foreground border-t py-3 pr-3 pl-9 text-xs">
                          VoiceStudio uses the profile named <code>{cloneName(slot.name, lang)}</code>.
                          Create or rename that profile in VoiceStudio, then reload this page.
                        </p>
                      )}
                    </div>
                  );
                })}
            </div>
          );
        })}
      </div>
    </>
  );
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
      <div className="border-t py-3 pr-3 pl-9 text-xs">
        <p className="text-muted-foreground">
          No clips for this voice in {langName(lang)} yet, so there is nothing to clone.
        </p>
        {canClone && (
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <AccountVoicePicker voice={voice} exists={exists} onAdopted={onCloned} />
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="border-t py-3 pr-3 pl-9 text-sm">
      <ul className="mb-3 space-y-1">
        {samples.map((sample) => (
          <li key={sample.file} className="flex items-center gap-3">
            <audio
              controls
              preload="none"
              src={withLang(lang, `/api/voices/${voice}/samples/${sample.file}`)}
              className="h-8 max-w-[16rem] flex-1"
            />
            <span className="text-muted-foreground min-w-0 flex-1 truncate text-xs">
              {displayName(sample.file)}
            </span>
          </li>
        ))}
      </ul>

      {canClone && (
        <div className="flex flex-wrap items-center gap-3">
          <Button
            size="xs"
            variant={confirming ? "destructive" : exists ? "outline" : "default"}
            disabled={busy}
            onClick={() => (exists && !confirming ? setConfirming(true) : clone())}
          >
            {busy ? <Loader2 className="animate-spin" /> : <Sparkles />}
            {confirming ? "Confirm replace" : exists ? "Replace in my account" : "Add to my account"}
          </Button>
          {!confirming && (
            <AccountVoicePicker voice={voice} exists={exists} disabled={busy} onAdopted={onCloned} />
          )}
          {confirming ? (
            <>
              <span className="text-xs text-amber-400">
                Deletes <code>{cloneName(voice, lang)}</code> from your ElevenLabs account and
                clones it again from these clips; it will not sound quite the same.
              </span>
              <Button variant="ghost" size="xs" onClick={() => setConfirming(false)}>
                Cancel
              </Button>
            </>
          ) : (
            !exists && (
              <span className="text-muted-foreground text-xs">Uses one voice slot.</span>
            )
          )}
        </div>
      )}

      {error && (
        <p role="alert" className="text-destructive mt-2 text-xs">
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
    return (
      <p className="text-muted-foreground border-t py-3 pr-3 pl-9 text-xs">
        No fish.audio reference for this voice in {langName(lang)} yet.
      </p>
    );
  }
  return (
    <div className="border-t py-3 pr-3 pl-9">
      <audio
        controls
        preload="none"
        // The hash in the URL makes a re-cut clip a new resource, not a cached old one.
        src={withLang(lang, `/api/voices/${voice}/reference/audio?v=${reference.clipHash}`)}
        className="h-8 w-full max-w-md"
      />
      {reference.pinned && (
        <p className="text-muted-foreground mt-2 text-xs">
          Pinned: every line of this voice is spoken by fish.audio, whichever generator is active.
        </p>
      )}
    </div>
  );
}
