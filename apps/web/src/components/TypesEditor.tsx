"use client";

/**
 * The Types tab of /npcs: every type an NPC can be, its genders and flavors, and the voice each
 * combination is read with, one table row per combination. Every edit posts to api/types, which
 * answers with the whole roster, and the tab redraws from that rather than from what it sent. An
 * edit that would split a voice NPCs speak with comes back as a question, asked next to the
 * control that made it.
 */
import { Plus, Trash2 } from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";

import { LiteButton, LiteCheckbox } from "@/components/LiteControls";
import { useLang } from "@/components/LangProvider";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Roster, newVoiceName, type Gender, type RosterData } from "@/lib/voices/roster";

const GENDERS: Gender[] = ["female", "male"];
/** The voice select's value for "a voice of the combination's own". */
const NEW_VOICE = "";

type Choice = { voice: string; into: string; npcs: number; lines: number };
type Send = (at: string, body: Record<string, unknown>) => Promise<boolean>;
type Refusal = (at: string) => ReactNode;

export default function TypesEditor({ initial }: { initial: RosterData }) {
  const lang = useLang();
  const [data, setData] = useState(initial);
  const roster = useMemo(() => new Roster(data), [data]);
  const [busy, setBusy] = useState(false);
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
        <div className="flex flex-wrap items-center gap-1 text-xs text-amber-600 dark:text-amber-400">
          {choice.voice} reads {plural(choice.npcs, "NPC")} and {plural(choice.lines, "line")}.
          <LiteButton
            className="h-6 px-1.5 text-xs"
            disabled={busy}
            onClick={() => void send(at, { ...body, existing: "map" })}
            title={`${choice.into} takes ${choice.voice} over, its takes too, and the NPCs move to ${choice.into}`}
          >
            Map to {choice.into}
          </LiteButton>
          <LiteButton
            className="h-6 px-1.5 text-xs"
            disabled={busy}
            onClick={() => void send(at, { ...body, existing: "discard" })}
            title={`${choice.into} gets a new voice; ${choice.voice} and its takes stay on file unused, and the NPCs wait for an answer`}
          >
            Throw away
          </LiteButton>
          <LiteButton variant="ghost" className="h-6 px-1.5 text-xs" onClick={() => setPending(null)}>
            Cancel
          </LiteButton>
        </div>
      );
    }
    return error?.at === at ? <div className="text-destructive text-xs">{error.message}</div> : null;
  };

  return (
    <div className="flex flex-col gap-4 text-sm">
      <AddType busy={busy} refusal={refusal("add")} send={send} />
      <table className="w-fit border-collapse">
        <thead className="text-muted-foreground text-left text-xs">
          <tr>
            <th className="px-3 py-1 font-normal">Type</th>
            <th className="px-3 py-1 font-normal">Gender</th>
            <th className="px-3 py-1 font-normal">Flavor</th>
            <th className="px-3 py-1 font-normal">Read by</th>
          </tr>
        </thead>
        {data.races.map((race) => (
          <TypeRows key={race.key} race={race} roster={roster} busy={busy} refusal={refusal} send={send} />
        ))}
      </table>
    </div>
  );
}

function AddType({ busy, refusal, send }: { busy: boolean; refusal: ReactNode; send: Send }) {
  const [key, setKey] = useState("");
  const [genders, setGenders] = useState<Gender[]>([]);
  return (
    <form
      className="flex flex-wrap items-center gap-2"
      onSubmit={async (event) => {
        event.preventDefault();
        if (await send("add", { action: "add-type", key: key.trim(), genders })) {
          setKey("");
          setGenders([]);
        }
      }}
    >
      <Input value={key} onChange={(e) => setKey(e.target.value)} placeholder="new type, e.g. treant" className="h-7 w-44 text-xs" />
      {GENDERS.map((gender) => (
        <label key={gender} className="flex items-center gap-1 text-xs">
          <LiteCheckbox
            checked={genders.includes(gender)}
            onChange={(e) =>
              setGenders((current) => (e.target.checked ? [...current, gender] : current.filter((g) => g !== gender)))
            }
          />
          {gender}
        </label>
      ))}
      <LiteButton type="submit" className="h-7 px-2 text-xs" disabled={busy || !key.trim()}>
        Add type
      </LiteButton>
      <span className="text-muted-foreground text-xs">No gender ticked: a type without one, like a treant.</span>
      {refusal}
    </form>
  );
}

/**
 * One type as a run of rows: a row per flavor (or one for a gender read by a bare voice), a row
 * per gender to add a flavor from, and a last row to add a gender from. The type and each gender
 * span the rows that are theirs.
 */
function TypeRows({
  race,
  roster,
  busy,
  refusal,
  send,
}: {
  race: RosterData["races"][number];
  roster: Roster;
  busy: boolean;
  refusal: Refusal;
  send: Send;
}) {
  const at = (what: string) => `${race.key}:${what}`;
  const groups = (race.genders.length ? race.genders : [null]).map((gender) => ({
    gender,
    flavors: roster.flavorsOf(race.key, gender),
  }));
  // A gender's own rows: its flavors, or its bare voice, then the row to add a flavor from.
  const rowsOf = (flavors: string[]) => Math.max(flavors.length, 1) + 1;
  const missing = GENDERS.filter((g) => !race.genders.includes(g));
  const total = groups.reduce((sum, { flavors }) => sum + rowsOf(flavors), 0) + (missing.length ? 1 : 0);
  const cell = "py-1 px-3 align-top";

  const rows: ReactNode[] = [];
  groups.forEach(({ gender, flavors }, index) => {
    const group = gender ?? "";
    const typeCell =
      index === 0 ? (
        <td rowSpan={total} className={`${cell} border-r font-mono`}>
          <div className="flex items-center gap-1">
            {race.key}
            <TrashButton
              title={`Delete ${race.key}`}
              busy={busy}
              onClick={() => void send(at("delete"), { action: "delete-type", key: race.key })}
            />
          </div>
          {refusal(at("delete"))}
        </td>
      ) : null;
    const genderCell = (
      <td rowSpan={rowsOf(flavors)} className={`${cell} border-r`}>
        {gender ?? <span className="text-muted-foreground">—</span>}
      </td>
    );

    if (flavors.length) {
      flavors.forEach((flavor, n) => {
        const key = at(`voice:${group}:${flavor}`);
        rows.push(
          <tr key={key} className={n === 0 ? "border-t" : ""}>
            {n === 0 ? typeCell : null}
            {n === 0 ? genderCell : null}
            <td className={cell}>
              <div className="flex items-center gap-1">
                {flavor}
                <TrashButton
                  title={`Delete ${flavor}`}
                  busy={busy}
                  onClick={() => void send(key, { action: "delete-flavor", race: race.key, gender, flavor })}
                />
              </div>
            </td>
            <td className={cell}>
              <VoiceSelect
                race={race.key}
                gender={gender}
                flavor={flavor}
                roster={roster}
                busy={busy}
                onPick={(voice) => void send(key, { action: "assign-voice", race: race.key, gender, flavor, voice })}
              />
              {refusal(key)}
            </td>
          </tr>,
        );
      });
    } else {
      const key = at(`voice:${group}:`);
      rows.push(
        <tr key={key} className="border-t">
          {typeCell}
          {genderCell}
          <td className={cell}>
            <span className="text-muted-foreground">—</span>
          </td>
          <td className={cell}>
            <VoiceSelect
              race={race.key}
              gender={gender}
              flavor={null}
              roster={roster}
              busy={busy}
              onPick={(voice) => void send(key, { action: "assign-voice", race: race.key, gender, flavor: null, voice })}
            />
            {refusal(key)}
          </td>
        </tr>,
      );
    }

    rows.push(
      <tr key={at(`flavor:${group}`)}>
        <td className={cell}>
          <AddFlavor race={race.key} gender={gender} busy={busy} refusal={refusal} send={send} />
        </td>
        <td className={cell} />
      </tr>,
    );
  });

  if (missing.length) {
    rows.push(
      <tr key={at("gender")}>
        <td className={`${cell} border-r`}>
          <div className="flex flex-wrap gap-1">
            {missing.map((g) => (
              <LiteButton
                key={g}
                variant="ghost"
                className="h-6 gap-0.5 px-1.5 text-xs"
                disabled={busy}
                onClick={() => void send(at("gender"), { action: "add-gender", race: race.key, gender: g })}
              >
                <Plus className="size-3" />
                {g}
              </LiteButton>
            ))}
          </div>
          {refusal(at("gender"))}
        </td>
        <td className={cell} />
        <td className={cell} />
      </tr>,
    );
  }

  return <tbody>{rows}</tbody>;
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
        <LiteButton variant="ghost" className="h-6 gap-0.5 px-1.5 text-xs" disabled={busy}>
          <Plus className="size-3" />
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
          <LiteButton type="submit" className="h-7 px-2 text-xs" disabled={busy || !flavor.trim()}>
            Add
          </LiteButton>
        </form>
        {refusal(at)}
      </PopoverContent>
    </Popover>
  );
}

function TrashButton({ title, busy, onClick }: { title: string; busy: boolean; onClick: () => void }) {
  return (
    <LiteButton
      variant="ghost"
      className="text-destructive hover:text-destructive h-6 w-6 p-0"
      disabled={busy}
      title={title}
      aria-label={title}
      onClick={onClick}
    >
      <Trash2 className="size-3.5" />
    </LiteButton>
  );
}

/** The voice one combination is read with, or none yet. */
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
  // Only its own assignment, not one it falls back to: a flavor read by its type's voice says so.
  const own = roster.data.assignments.find((a) => a.race === race && a.gender === gender && a.flavor === flavor)?.voice;
  const inherited = own ? null : roster.voiceFor(race, gender, flavor);
  return (
    <select
      value={own ?? "-"}
      disabled={busy}
      onChange={(event) => onPick(event.target.value === NEW_VOICE ? null : event.target.value)}
      className="h-7 rounded border bg-transparent text-xs"
    >
      {own ? null : <option value="-">{inherited ? `as ${inherited}` : "no voice"}</option>}
      <option value={NEW_VOICE}>new voice: {newVoiceName(race, gender, flavor)}</option>
      {roster.voiceNames.map((voice) => (
        <option key={voice} value={voice}>
          {voice}
        </option>
      ))}
    </select>
  );
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}
