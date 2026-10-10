"use client";

/**
 * The Types tab of /npcs: every type an NPC can be, its genders and flavors, and the voice each
 * combination is read with, one table row per combination. Every edit posts to api/types, which
 * answers with the whole roster, and the tab redraws from that rather than from what it sent. An
 * edit that would split a voice NPCs speak with comes back as a question, asked next to the
 * control that made it.
 */
import { Check, ChevronsUpDown, Plus, Trash2 } from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";

import FilterChip, { type ChipOption } from "@/components/FilterChip";
import { LiteButton, LiteCheckbox } from "@/components/LiteControls";
import { useLang } from "@/components/LangProvider";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Roster, newVoiceName, type Gender, type RosterData } from "@/lib/voices/roster";

const GENDERS: Gender[] = ["female", "male"];

/** Every button on the tab, so a row of them reads as one set. */
const BUTTON = "h-7 gap-1 px-2 text-xs";
/** Every cell's content sits on one line as tall as a button, so a row's cells line up. */
const LINE = "flex min-h-7 items-center gap-1";
/**
 * Delete stays out of sight until its row is hovered, as a column of red reads as noise
 * otherwise; a focused one stays visible for the keyboard.
 */
const ON_TYPE_HOVER = "opacity-0 group-hover/type:opacity-100 focus-visible:opacity-100";
const ON_ROW_HOVER = "opacity-0 group-hover/row:opacity-100 focus-visible:opacity-100";
/** One width for every voice picker, so the column reads straight down. */
const PICKER_WIDTH = "w-60";

const VOICED_OPTIONS: ChipOption[] = [
  { value: "yes", label: "has a voice" },
  { value: "no", label: "has no voice" },
];

type Choice = { voice: string; into: string; npcs: number; lines: number };
type Send = (at: string, body: Record<string, unknown>) => Promise<boolean>;
type Refusal = (at: string) => ReactNode;
type Group = { gender: Gender | null; flavors: (string | null)[] };

export default function TypesEditor({ initial }: { initial: RosterData }) {
  const lang = useLang();
  const [data, setData] = useState(initial);
  const roster = useMemo(() => new Roster(data), [data]);
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState("");
  const [voiced, setVoiced] = useState<string | undefined>();
  /** The last refusal, and which control it answers. */
  const [error, setError] = useState<{ at: string; message: string } | null>(null);
  /** An edit waiting on what becomes of the voice it splits. */
  const [pending, setPending] = useState<{ at: string; body: Record<string, unknown>; choice: Choice } | null>(null);

  const send: Send = async (at, body) => {
    setBusy(true);
    setError(null);
    setPending(null);
    const response = await fetch(`/api/types?lang=${lang}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }).catch(() => null);
    setBusy(false);
    const answer = (await response?.json().catch(() => null)) as
      | { roster?: RosterData; error?: string; choice?: Choice }
      | null;
    if (response?.status === 409 && answer?.choice) {
      setPending({ at, body, choice: answer.choice });
      return false;
    }
    if (!response?.ok || !answer?.roster) {
      setError({ at, message: answer?.error ?? "Not saved" });
      return false;
    }
    setData(answer.roster);
    return true;
  };

  const refusal: Refusal = (at) => {
    if (pending?.at === at) {
      const { choice, body } = pending;
      return (
        <div className="flex flex-wrap items-center gap-1 py-1 text-xs text-amber-600 dark:text-amber-400">
          {choice.voice} reads {plural(choice.npcs, "NPC")} and {plural(choice.lines, "line")}.
          <LiteButton
            className={BUTTON}
            disabled={busy}
            onClick={() => void send(at, { ...body, existing: "map" })}
            title={`${choice.into} takes ${choice.voice} over, its takes too, and the NPCs move to ${choice.into}`}
          >
            Map to {choice.into}
          </LiteButton>
          <LiteButton
            className={BUTTON}
            disabled={busy}
            onClick={() => void send(at, { ...body, existing: "discard" })}
            title={`${choice.into} gets a new voice; ${choice.voice} and its takes stay on file unused, and the NPCs wait for an answer`}
          >
            Throw away
          </LiteButton>
          <LiteButton className={BUTTON} onClick={() => setPending(null)}>
            Cancel
          </LiteButton>
        </div>
      );
    }
    return error?.at === at ? <div className="text-destructive py-1 text-xs">{error.message}</div> : null;
  };

  // A combination is shown when the search finds its type, gender, flavor or voice in it, and the
  // voice filter agrees; a type is shown with the combinations that are.
  const needle = query.trim().toLowerCase();
  const shown = data.races.flatMap((race) => {
    const groups: Group[] = (race.genders.length ? race.genders : [null]).flatMap((gender) => {
      const all = roster.flavorsOf(race.key, gender);
      const flavors = (all.length ? all : [null]).filter((flavor) => {
        const voice = roster.voiceFor(race.key, gender, flavor);
        if (voiced === "yes" && !voice) return false;
        if (voiced === "no" && voice) return false;
        return !needle || [race.key, gender, flavor, voice].some((part) => part?.includes(needle));
      });
      return flavors.length ? [{ gender, flavors }] : [];
    });
    return groups.length ? [{ race, groups }] : [];
  });

  return (
    <div className="flex flex-col gap-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <Input
          type="search"
          placeholder="Search types, flavors, voices"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          className="h-8 max-w-xs text-sm"
        />
        <FilterChip label="voice" value={voiced} options={VOICED_OPTIONS} onChange={setVoiced} />
        <AddType busy={busy} refusal={refusal} send={send} />
      </div>
      <table className="w-fit border-collapse">
        <thead className="text-muted-foreground text-left text-xs">
          <tr>
            <th className="px-3 py-1 font-normal">Type</th>
            <th className="px-3 py-1 font-normal">Gender</th>
            <th className="px-3 py-1 font-normal">Flavor</th>
            <th className="px-3 py-1 font-normal">Read by</th>
            <th className="px-3 py-1 font-normal">Add</th>
          </tr>
        </thead>
        {shown.map(({ race, groups }) => (
          <TypeRows
            key={race.key}
            race={race}
            groups={groups}
            roster={roster}
            busy={busy}
            refusal={refusal}
            send={send}
          />
        ))}
      </table>
      {shown.length === 0 ? <p className="text-muted-foreground text-xs">Nothing matches.</p> : null}
    </div>
  );
}

function AddType({ busy, refusal, send }: { busy: boolean; refusal: Refusal; send: Send }) {
  const [open, setOpen] = useState(false);
  const [key, setKey] = useState("");
  const [genders, setGenders] = useState<Gender[]>([]);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <LiteButton className={BUTTON} disabled={busy}>
          <Plus className="size-3.5 shrink-0" />
          type
        </LiteButton>
      </PopoverTrigger>
      <PopoverContent align="start" className="flex w-80 flex-col gap-2 p-2">
        <form
          className="flex flex-col gap-2"
          onSubmit={async (event) => {
            event.preventDefault();
            if (await send("add", { action: "add-type", key: key.trim(), genders })) {
              setKey("");
              setGenders([]);
              setOpen(false);
            }
          }}
        >
          <Input
            autoFocus
            value={key}
            onChange={(e) => setKey(e.target.value)}
            placeholder="type, e.g. treant"
            className="h-7 text-xs"
          />
          <div className="flex items-center gap-3">
            {GENDERS.map((gender) => (
              <label key={gender} className="flex items-center gap-1 text-xs">
                <LiteCheckbox
                  checked={genders.includes(gender)}
                  onChange={(e) =>
                    setGenders((current) =>
                      e.target.checked ? [...current, gender] : current.filter((g) => g !== gender),
                    )
                  }
                />
                {gender}
              </label>
            ))}
            <LiteButton type="submit" className={`${BUTTON} ml-auto`} disabled={busy || !key.trim()}>
              Add
            </LiteButton>
          </div>
          <p className="text-muted-foreground text-xs">No gender ticked: a type without one, like a treant.</p>
        </form>
        {refusal("add")}
      </PopoverContent>
    </Popover>
  );
}

/**
 * One type as a run of rows: a row per flavor, or one for a gender read by a bare voice. The type
 * spans all of them; each gender, and the cell to add its flavors from, spans its own. The type's
 * missing genders are added from its first such cell.
 */
function TypeRows({
  race,
  groups,
  roster,
  busy,
  refusal,
  send,
}: {
  race: RosterData["races"][number];
  groups: Group[];
  roster: Roster;
  busy: boolean;
  refusal: Refusal;
  send: Send;
}) {
  const at = (what: string) => `${race.key}:${what}`;
  const missing = GENDERS.filter((g) => !race.genders.includes(g));
  const total = groups.reduce((sum, { flavors }) => sum + flavors.length, 0);
  const cell = "px-3 py-0.5 align-top";

  const rows: ReactNode[] = [];
  groups.forEach(({ gender, flavors }, index) => {
    const group = gender ?? "";
    const typeCell =
      index === 0 ? (
        <td rowSpan={total} className={`${cell} border-r font-mono`}>
          <div className={LINE}>
            {race.key}
            <TrashButton
              title={`Delete ${race.key}`}
              busy={busy}
              reveal={ON_TYPE_HOVER}
              onClick={() => void send(at("delete"), { action: "delete-type", key: race.key })}
            />
          </div>
          {refusal(at("delete"))}
        </td>
      ) : null;
    const genderCell = (
      <td rowSpan={flavors.length} className={`${cell} border-r`}>
        <div className={LINE}>{gender ?? <span className="text-muted-foreground">—</span>}</div>
      </td>
    );
    const addCell = (
      <td rowSpan={flavors.length} className={`${cell} border-l`}>
        <div className={LINE}>
          <AddFlavor race={race.key} gender={gender} busy={busy} refusal={refusal} send={send} />
          {index === 0
            ? missing.map((g) => (
                <LiteButton
                  key={g}
                  className={BUTTON}
                  disabled={busy}
                  onClick={() => void send(at("gender"), { action: "add-gender", race: race.key, gender: g })}
                >
                  <Plus className="size-3.5 shrink-0" />
                  {g}
                </LiteButton>
              ))
            : null}
        </div>
        {index === 0 ? refusal(at("gender")) : null}
      </td>
    );

    flavors.forEach((flavor, n) => {
      const key = at(`voice:${group}:${flavor ?? ""}`);
      rows.push(
        <tr key={key} className={`group/row ${n === 0 ? "border-t" : ""}`}>
          {n === 0 ? typeCell : null}
          {n === 0 ? genderCell : null}
          <td className={cell}>
            <div className={LINE}>
              {flavor ? (
                <>
                  {flavor}
                  <TrashButton
                    title={`Delete ${flavor}`}
                    busy={busy}
                    reveal={ON_ROW_HOVER}
                    onClick={() => void send(key, { action: "delete-flavor", race: race.key, gender, flavor })}
                  />
                </>
              ) : (
                <span className="text-muted-foreground">—</span>
              )}
            </div>
          </td>
          <td className={cell}>
            <div className={LINE}>
              <VoiceSelect
                race={race.key}
                gender={gender}
                flavor={flavor}
                roster={roster}
                busy={busy}
                onPick={(voice) => void send(key, { action: "assign-voice", race: race.key, gender, flavor, voice })}
              />
            </div>
            {refusal(key)}
          </td>
          {n === 0 ? addCell : null}
        </tr>,
      );
    });
  });

  return <tbody className="group/type">{rows}</tbody>;
}

/** The button that opens a flavor form for one gender of a type, or for a type with none. */
function AddFlavor({
  race,
  gender,
  busy,
  refusal,
  send,
}: {
  race: string;
  gender: Gender | null;
  busy: boolean;
  refusal: Refusal;
  send: Send;
}) {
  const [open, setOpen] = useState(false);
  const [flavor, setFlavor] = useState("");
  const at = `${race}:flavor:${gender ?? ""}`;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <LiteButton className={BUTTON} disabled={busy}>
          <Plus className="size-3.5 shrink-0" />
          flavor
        </LiteButton>
      </PopoverTrigger>
      <PopoverContent align="start" className="flex w-72 flex-col gap-2 p-2">
        <form
          className="flex items-center gap-1"
          onSubmit={async (event) => {
            event.preventDefault();
            if (await send(at, { action: "add-flavor", race, gender, flavor: flavor.trim() })) {
              setFlavor("");
              setOpen(false);
            }
          }}
        >
          <Input
            autoFocus
            value={flavor}
            onChange={(e) => setFlavor(e.target.value)}
            placeholder={`flavor of ${[race, gender].filter(Boolean).join(" ")}`}
            className="h-7 text-xs"
          />
          <LiteButton type="submit" className={BUTTON} disabled={busy || !flavor.trim()}>
            Add
          </LiteButton>
        </form>
        {refusal(at)}
      </PopoverContent>
    </Popover>
  );
}

function TrashButton({
  title,
  busy,
  reveal,
  onClick,
}: {
  title: string;
  busy: boolean;
  reveal: string;
  onClick: () => void;
}) {
  return (
    <LiteButton
      className={`text-destructive hover:text-destructive size-7 justify-center p-0 ${reveal}`}
      disabled={busy}
      title={title}
      aria-label={title}
      onClick={onClick}
    >
      <Trash2 className="size-3.5 shrink-0" />
    </LiteButton>
  );
}

/** The voice one combination is read with, or none yet, picked from a searchable list. */
function VoiceSelect({
  race,
  gender,
  flavor,
  roster,
  busy,
  onPick,
}: {
  race: string;
  gender: Gender | null;
  flavor: string | null;
  roster: Roster;
  busy: boolean;
  onPick: (voice: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  // Only its own assignment, not one it falls back to: a flavor read by its type's voice says so.
  const own = roster.data.assignments.find((a) => a.race === race && a.gender === gender && a.flavor === flavor)?.voice;
  const inherited = own ? null : roster.voiceFor(race, gender, flavor);
  const fresh = newVoiceName(race, gender, flavor);
  const pick = (voice: string | null) => {
    setOpen(false);
    if (voice !== (own ?? null)) onPick(voice);
  };
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <LiteButton
          role="combobox"
          aria-expanded={open}
          disabled={busy}
          className={`${BUTTON} justify-between font-normal ${PICKER_WIDTH}`}
        >
          <span className={`truncate ${own ? "" : "text-muted-foreground"}`}>
            {own ?? (inherited ? `as ${inherited}` : "no voice")}
          </span>
          <ChevronsUpDown className="size-3.5 shrink-0 opacity-50" />
        </LiteButton>
      </PopoverTrigger>
      <PopoverContent align="start" className={`p-0 ${PICKER_WIDTH}`}>
        <Command>
          <CommandInput placeholder="Search voices" className="h-8 text-xs" />
          <CommandList>
            <CommandEmpty>No voice.</CommandEmpty>
            {roster.isVoice(fresh) ? null : (
              <CommandGroup>
                <CommandItem value={`new ${fresh}`} onSelect={() => pick(null)} className="text-xs">
                  <Plus className="size-3.5" />
                  New voice: {fresh}
                </CommandItem>
              </CommandGroup>
            )}
            <CommandGroup>
              {roster.voiceNames.map((voice) => (
                <CommandItem key={voice} value={voice} onSelect={() => pick(voice)} className="text-xs">
                  <Check className={`size-3.5 ${voice === own ? "opacity-100" : "opacity-0"}`} />
                  {voice}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}
