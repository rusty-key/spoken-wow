"use client";

/**
 * Edits to the roster through api/types, shared by the Types tab and the NPC rows' "New" entries.
 * Every edit is answered with the whole roster, and the page redraws from that rather than from
 * what it sent. An edit that would split a voice NPCs speak with comes back as a question, asked
 * by `refusal` next to the control that made it.
 */
import { useMemo, useState, type ReactNode } from "react";

import { useLang } from "@/components/LangProvider";
import { LiteButton, LiteCheckbox, ROW_BUTTON } from "@/components/LiteControls";
import { Input } from "@/components/ui/input";
import { Roster, type Gender, type RosterData } from "@/lib/voices/roster";
import type { NeedsChoice } from "@/lib/voices/types-store";
import { GENDERS } from "@/lib/voices/voices";

type Choice = NeedsChoice["choice"];

export type RosterEdits = {
  roster: Roster;
  busy: boolean;
  /**
   * Posts one edit; `at` names the control it came from. True when it landed. `done` runs once
   * it lands, also when that is only after the question it raised is answered.
   */
  send: (at: string, body: Record<string, unknown>, done?: () => void) => Promise<boolean>;
  /** The last refusal or question, if it answers the control at `at`. */
  refusal: (at: string) => ReactNode;
};

export function useRosterEdits(initial: RosterData): RosterEdits {
  const lang = useLang();
  const [data, setData] = useState(initial);
  const roster = useMemo(() => new Roster(data), [data]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ at: string; message: string } | null>(null);
  /** An edit waiting on what becomes of the voice it splits. */
  const [pending, setPending] = useState<{
    at: string;
    body: Record<string, unknown>;
    choice: Choice;
    done?: () => void;
  } | null>(null);

  const send: RosterEdits["send"] = async (at, body, done) => {
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
      setPending({ at, body, choice: answer.choice, done });
      return false;
    }
    if (!response?.ok || !answer?.roster) {
      setError({ at, message: answer?.error ?? "Not saved" });
      return false;
    }
    setData(answer.roster);
    done?.();
    return true;
  };

  const refusal: RosterEdits["refusal"] = (at) => {
    if (pending?.at === at) {
      const { choice, body, done } = pending;
      return (
        <div className="flex flex-wrap items-center gap-1 py-1 text-xs text-amber-600 dark:text-amber-400">
          {choice.voice} reads {plural(choice.npcs, "NPC")} and {plural(choice.lines, "line")}.
          <LiteButton
            className={ROW_BUTTON}
            disabled={busy}
            onClick={() => void send(at, { ...body, existing: "map" }, done)}
            title={`${choice.into} takes ${choice.voice} over, its takes too, and the NPCs move to ${choice.into}`}
          >
            Map to {choice.into}
          </LiteButton>
          <LiteButton
            className={ROW_BUTTON}
            disabled={busy}
            onClick={() => void send(at, { ...body, existing: "discard" }, done)}
            title={`${choice.into} gets a new voice; ${choice.voice} and its takes stay on file unused, and the NPCs wait for an answer`}
          >
            Throw away
          </LiteButton>
          <LiteButton className={ROW_BUTTON} onClick={() => setPending(null)}>
            Cancel
          </LiteButton>
        </div>
      );
    }
    return error?.at === at ? <div className="text-destructive py-1 text-xs">{error.message}</div> : null;
  };

  return { roster, busy, send, refusal };
}

/** A new type: its key, and the genders it splits by, none for one like a treant. */
export function NewTypeForm({
  at,
  edits,
  onMade,
}: {
  at: string;
  edits: RosterEdits;
  /** With the genders it was made with: the roster this render holds does not have it yet. */
  onMade: (key: string, genders: Gender[]) => void;
}) {
  const [key, setKey] = useState("");
  const [genders, setGenders] = useState<Gender[]>([]);
  return (
    <div className="flex flex-col gap-2">
      <form
        className="flex flex-col gap-2"
        onSubmit={async (event) => {
          event.preventDefault();
          const made = key.trim();
          await edits.send(at, { action: "add-type", key: made, genders }, () => {
            setKey("");
            setGenders([]);
            onMade(made, genders);
          });
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
          <LiteButton type="submit" className={`${ROW_BUTTON} ml-auto`} disabled={edits.busy || !key.trim()}>
            Add
          </LiteButton>
        </div>
        <p className="text-muted-foreground text-xs">No gender ticked: a type without one, like a treant.</p>
      </form>
      {edits.refusal(at)}
    </div>
  );
}

/** A gender a type does not split by yet. */
export function NewGenderForm({
  at,
  race,
  edits,
  onMade,
}: {
  at: string;
  race: string;
  edits: RosterEdits;
  onMade: (gender: Gender) => void;
}) {
  const missing = GENDERS.filter((g) => !edits.roster.gendersOf(race).includes(g));
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-1 text-xs">
        <span className="text-muted-foreground mr-1">{race} gets</span>
        {missing.map((gender) => (
          <LiteButton
            key={gender}
            className={ROW_BUTTON}
            disabled={edits.busy}
            onClick={async () => {
              await edits.send(at, { action: "add-gender", race, gender }, () => onMade(gender));
            }}
          >
            {gender}
          </LiteButton>
        ))}
      </div>
      {edits.refusal(at)}
    </div>
  );
}

/** A new flavor of one gender of a type, or of a type with none. */
export function NewFlavorForm({
  at,
  race,
  gender,
  edits,
  onMade,
}: {
  at: string;
  race: string;
  gender: Gender | null;
  edits: RosterEdits;
  onMade: (flavor: string) => void;
}) {
  const [flavor, setFlavor] = useState("");
  return (
    <div className="flex flex-col gap-2">
      <form
        className="flex items-center gap-1"
        onSubmit={async (event) => {
          event.preventDefault();
          const made = flavor.trim();
          await edits.send(at, { action: "add-flavor", race, gender, flavor: made }, () => {
            setFlavor("");
            onMade(made);
          });
        }}
      >
        <Input
          autoFocus
          value={flavor}
          onChange={(e) => setFlavor(e.target.value)}
          placeholder={`flavor of ${[race, gender].filter(Boolean).join(" ")}`}
          className="h-7 text-xs"
        />
        <LiteButton type="submit" className={ROW_BUTTON} disabled={edits.busy || !flavor.trim()}>
          Add
        </LiteButton>
      </form>
      {edits.refusal(at)}
    </div>
  );
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}
