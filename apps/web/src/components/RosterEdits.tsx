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
import { useUiText } from "@/components/UiTextProvider";
import { fill } from "@/lib/site-text/format";
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
  const t = useUiText();
  const words = t.voices.roster;
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
      setError({ at, message: answer?.error ?? words.notSaved });
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
          {fill(words.reads, {
            voice: choice.voice,
            npcs: choice.npcs === 1 ? t.voices.slots.npcOne : fill(t.voices.slots.npcMany, { n: choice.npcs }),
            lines: choice.lines === 1 ? t.voices.slots.lineOne : fill(t.voices.slots.lineMany, { n: choice.lines }),
          })}
          <LiteButton
            className={ROW_BUTTON}
            disabled={busy}
            onClick={() => void send(at, { ...body, existing: "map" }, done)}
            title={fill(words.takesOver, { voice: choice.voice, race: choice.into })}
          >
            {fill(words.mapTo, { voice: choice.into })}
          </LiteButton>
          <LiteButton
            className={ROW_BUTTON}
            disabled={busy}
            onClick={() => void send(at, { ...body, existing: "discard" }, done)}
            title={fill(words.newVoice, { race: choice.into, voice: choice.voice })}
          >
            {words.discard}
          </LiteButton>
          <LiteButton className={ROW_BUTTON} onClick={() => setPending(null)}>
            {words.cancel}
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
  const t = useUiText();
  const words = t.voices.roster;
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
          placeholder={words.typePlaceholder}
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
            {words.add}
          </LiteButton>
        </div>
        <p className="text-muted-foreground text-xs">{words.noGender}</p>
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
  const words = useUiText().voices.roster;
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-1 text-xs">
        <span className="text-muted-foreground mr-1">{fill(words.gets, { race })}</span>
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
  const words = useUiText().voices.roster;
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
          placeholder={fill(words.flavorOf, { race: [race, gender].filter(Boolean).join(" ") })}
          className="h-7 text-xs"
        />
        <LiteButton type="submit" className={ROW_BUTTON} disabled={edits.busy || !flavor.trim()}>
          {words.add}
        </LiteButton>
      </form>
      {edits.refusal(at)}
    </div>
  );
}
