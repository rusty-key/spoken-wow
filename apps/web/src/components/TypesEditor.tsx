"use client";

/**
 * The Types tab of /npcs: every type an NPC can be, its genders and flavors, and the voice each
 * combination is read with. Every edit posts to api/types, which answers with the whole roster,
 * and the tab redraws from that rather than from what it sent.
 */
import { useMemo, useState } from "react";

import { LiteButton, LiteCheckbox } from "@/components/LiteControls";
import { useLang } from "@/components/LangProvider";
import { Input } from "@/components/ui/input";
import { Roster, newVoiceName, type Gender, type RosterData } from "@/lib/voices/roster";

const GENDERS: Gender[] = ["female", "male"];
/** The voice select's value for "a voice of the combination's own". */
const NEW_VOICE = "";

type Combination = { race: string; gender: Gender | null; flavor: string | null };

export default function TypesEditor({ initial }: { initial: RosterData }) {
  const lang = useLang();
  const [data, setData] = useState(initial);
  const roster = useMemo(() => new Roster(data), [data]);
  const [busy, setBusy] = useState(false);
  /** The last refusal, and which control it answers. */
  const [error, setError] = useState<{ at: string; message: string } | null>(null);

  async function send(at: string, body: Record<string, unknown>): Promise<boolean> {
    setBusy(true);
    setError(null);
    const response = await fetch(`/api/types?lang=${lang}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }).catch(() => null);
    setBusy(false);
    const answer = (await response?.json().catch(() => null)) as { roster?: RosterData; error?: string } | null;
    if (!response?.ok || !answer?.roster) {
      setError({ at, message: answer?.error ?? "Not saved" });
      return false;
    }
    setData(answer.roster);
    return true;
  }

  const refusal = (at: string) =>
    error?.at === at ? <span className="text-destructive text-xs">{error.message}</span> : null;

  return (
    <div className="flex flex-col gap-4 text-sm">
      <AddType busy={busy} refusal={refusal("add")} onAdd={(body) => send("add", { action: "add-type", ...body })} />
      <table className="w-full border-collapse">
        <thead className="text-muted-foreground text-left text-xs">
          <tr>
            <th className="py-1 pr-3 font-normal">Type</th>
            <th className="py-1 pr-3 font-normal">Label</th>
            <th className="py-1 pr-3 font-normal">Read by</th>
          </tr>
        </thead>
        <tbody>
          {data.races.map((race) => (
            <TypeRow
              key={race.key}
              race={race}
              roster={roster}
              busy={busy}
              refusal={refusal}
              send={send}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function AddType({
  busy,
  refusal,
  onAdd,
}: {
  busy: boolean;
  refusal: React.ReactNode;
  onAdd: (body: { key: string; label: string; genders: Gender[] }) => Promise<boolean>;
}) {
  const [key, setKey] = useState("");
  const [label, setLabel] = useState("");
  const [genders, setGenders] = useState<Gender[]>([]);
  return (
    <form
      className="flex flex-wrap items-center gap-2"
      onSubmit={async (event) => {
        event.preventDefault();
        if (await onAdd({ key: key.trim(), label, genders })) {
          setKey("");
          setLabel("");
          setGenders([]);
        }
      }}
    >
      <Input value={key} onChange={(e) => setKey(e.target.value)} placeholder="key, e.g. treant" className="h-7 w-40 text-xs" />
      <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="label" className="h-7 w-40 text-xs" />
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

function TypeRow({
  race,
  roster,
  busy,
  refusal,
  send,
}: {
  race: RosterData["races"][number];
  roster: Roster;
  busy: boolean;
  refusal: (at: string) => React.ReactNode;
  send: (at: string, body: Record<string, unknown>) => Promise<boolean>;
}) {
  const [label, setLabel] = useState(race.label ?? "");
  const [flavor, setFlavor] = useState<Record<string, string>>({});
  const at = (what: string) => `${race.key}:${what}`;
  // The type alone when it has no gender, else each gender; each with its flavors under it.
  const groups: (Gender | null)[] = race.genders.length ? race.genders : [null];

  return (
    <tr className="border-t align-top">
      <td className="py-2 pr-3 font-mono">
        {race.key}
        <div className="mt-1 flex flex-wrap gap-1">
          {GENDERS.filter((g) => !race.genders.includes(g)).map((g) => (
            <LiteButton
              key={g}
              variant="ghost"
              className="h-6 px-1.5 text-xs"
              disabled={busy}
              onClick={() => void send(at("gender"), { action: "add-gender", race: race.key, gender: g })}
            >
              + {g}
            </LiteButton>
          ))}
          <LiteButton
            variant="ghost"
            className="h-6 px-1.5 text-xs"
            disabled={busy}
            onClick={() => void send(at("delete"), { action: "delete-type", key: race.key })}
          >
            Delete
          </LiteButton>
        </div>
        {refusal(at("gender"))}
        {refusal(at("delete"))}
      </td>
      <td className="py-2 pr-3">
        <Input
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          onBlur={() => {
            if (label !== (race.label ?? "")) void send(at("label"), { action: "label-type", key: race.key, label });
          }}
          className="h-7 w-36 text-xs"
        />
        {refusal(at("label"))}
      </td>
      <td className="py-2 pr-3">
        <div className="flex flex-col gap-2">
          {groups.map((gender) => {
            const group = gender ?? "";
            return (
              <div key={group} className="flex flex-col gap-1">
                <VoiceRow
                  combination={{ race: race.key, gender, flavor: null }}
                  roster={roster}
                  busy={busy}
                  refusal={refusal(at(`voice:${group}:`))}
                  onPick={(voice) =>
                    void send(at(`voice:${group}:`), { action: "assign-voice", race: race.key, gender, flavor: null, voice })
                  }
                />
                {roster.flavorsOf(race.key, gender).map((f) => (
                  <VoiceRow
                    key={f}
                    combination={{ race: race.key, gender, flavor: f }}
                    roster={roster}
                    busy={busy}
                    refusal={refusal(at(`voice:${group}:${f}`))}
                    onPick={(voice) =>
                      void send(at(`voice:${group}:${f}`), { action: "assign-voice", race: race.key, gender, flavor: f, voice })
                    }
                    onDelete={() =>
                      void send(at(`voice:${group}:${f}`), { action: "delete-flavor", race: race.key, gender, flavor: f })
                    }
                  />
                ))}
                <form
                  className="flex items-center gap-1 pl-4"
                  onSubmit={async (event) => {
                    event.preventDefault();
                    const name = (flavor[group] ?? "").trim();
                    if (await send(at(`flavor:${group}`), { action: "add-flavor", race: race.key, gender, flavor: name })) {
                      setFlavor((current) => ({ ...current, [group]: "" }));
                    }
                  }}
                >
                  <Input
                    value={flavor[group] ?? ""}
                    onChange={(e) => setFlavor((current) => ({ ...current, [group]: e.target.value }))}
                    placeholder="new flavor"
                    className="h-6 w-28 text-xs"
                  />
                  <LiteButton type="submit" variant="ghost" className="h-6 px-1.5 text-xs" disabled={busy || !(flavor[group] ?? "").trim()}>
                    Add
                  </LiteButton>
                  {refusal(at(`flavor:${group}`))}
                </form>
              </div>
            );
          })}
        </div>
      </td>
    </tr>
  );
}

/** One combination and the voice that reads it, or none yet. */
function VoiceRow({
  combination,
  roster,
  busy,
  refusal,
  onPick,
  onDelete,
}: {
  combination: Combination;
  roster: Roster;
  busy: boolean;
  refusal: React.ReactNode;
  onPick: (voice: string | null) => void;
  onDelete?: () => void;
}) {
  const { race, gender, flavor } = combination;
  // Only its own assignment, not one it falls back to: a flavor read by its type's voice says so.
  const own = roster.data.assignments.find(
    (a) => a.race === race && a.gender === gender && a.flavor === flavor,
  )?.voice;
  const inherited = own ? null : roster.voiceFor(race, gender, flavor);
  const name = [gender, flavor].filter(Boolean).join(" ") || "any";

  return (
    <div className={`flex flex-wrap items-center gap-1 ${flavor ? "pl-4" : ""}`}>
      <span className="text-muted-foreground w-28 text-xs">{name}</span>
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
      {onDelete ? (
        <LiteButton variant="ghost" className="h-6 px-1.5 text-xs" disabled={busy} onClick={onDelete}>
          Delete
        </LiteButton>
      ) : null}
      {refusal}
    </div>
  );
}
