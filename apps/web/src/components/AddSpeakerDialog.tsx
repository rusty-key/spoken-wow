"use client";

import { useMemo, useState } from "react";

import { useLang } from "@/components/LangProvider";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { flavorOptionsFor, noVoice } from "@/lib/contributions/speaker";
import { withLang } from "@/lib/lang";
import { NPC_ROW_KINDS, type NpcRowKind } from "@/lib/npc/npc";
import type { ResultLine } from "@/lib/search";
import { Roster, type RosterData } from "@/lib/voices/roster";

type Props = {
  /** The line gaining a speaker, or null when the dialog is closed. */
  line: ResultLine | null;
  /** Whether the NPC found takes the place of the line's speaker rather than joining it. */
  replace?: boolean;
  onSaved: () => void;
  onCancel: () => void;
};

type Found = {
  npc: { npcName: string | null; race: string | null; gender: string | null; flavor: string | null; voice: string | null } | null;
  /** Only while the NPC has no voice, to answer it with. */
  roster: RosterData | null;
};

const FIELD =
  "border-input bg-transparent focus-visible:ring-ring/50 rounded-md border px-3 py-2 text-sm focus-visible:ring-[3px] focus-visible:outline-none";

function Choice({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: readonly string[];
  onChange: (value: string) => void;
}) {
  return (
    <select aria-label={label} value={value} onChange={(event) => onChange(event.target.value)} className={FIELD}>
      <option value="">{label.toLowerCase()}</option>
      {options.map((option) => (
        <option key={option} value={option}>
          {option}
        </option>
      ))}
    </select>
  );
}

/**
 * Adding an NPC as one more speaker of a line: a quest two givers offer, a greeting several
 * guards share. Or, with `replace`, putting it in the place of a speaker the game data got
 * wrong. The NPC is looked up first; one already answered speaks in its own voice, and one
 * nobody has answered is answered here, as /npcs would, since a speaker needs a voice.
 */
export default function AddSpeakerDialog({ line, replace = false, onSaved, onCancel }: Props) {
  const lang = useLang();
  const [npcType, setNpcType] = useState<NpcRowKind>("creature");
  const [npcId, setNpcId] = useState("");
  const [found, setFound] = useState<Found | null>(null);
  const [npcName, setNpcName] = useState("");
  const [race, setRace] = useState("");
  const [gender, setGender] = useState("");
  const [flavor, setFlavor] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Which line the form belongs to, so opening another row starts it over (as IgnoreDialog).
  const [seeded, setSeeded] = useState<string | null>(null);
  const roster = useMemo(() => (found?.roster ? new Roster(found.roster) : null), [found]);

  if (!line) return null;

  if (seeded !== line.key) {
    setSeeded(line.key);
    setNpcType(line.npcType === "gameobject" || line.npcType === "item" ? line.npcType : "creature");
    setNpcId("");
    setFound(null);
    setError(null);
    return null;
  }

  const answered = Boolean(found?.npc?.voice);
  const genders = roster && race ? roster.gendersOf(race) : [];
  const flavors = roster ? flavorOptionsFor(race || null, gender || null, roster) : [];
  const answerReady = Boolean(race && (gender || roster?.isGenderless(race)) && npcName.trim());

  /** A request's body, or null once its error is shown. */
  async function request<T>(url: string, init?: RequestInit): Promise<T | null> {
    const response = await fetch(withLang(lang, url), init);
    const body = (await response.json().catch(() => ({}))) as T & { error?: string };
    if (response.ok) return body;
    setError(body.error ?? `request failed (${response.status})`);
    return null;
  }

  function post(url: string, body: Record<string, unknown>) {
    return request(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  async function lookUp() {
    if (!/^\d+$/.test(npcId.trim())) {
      setError("An NPC id is a number");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const body = await request<Found>(
        `/api/quests/lines/speakers?npcType=${npcType}&npcId=${encodeURIComponent(npcId.trim())}`,
      );
      if (!body) return;
      setFound(body);
      setNpcName(body.npc?.npcName ?? "");
      setRace(body.npc?.race ?? "");
      setGender(body.npc?.gender ?? "");
      setFlavor(body.npc?.flavor ?? "");
    } catch (problem) {
      setError(String(problem));
    } finally {
      setBusy(false);
    }
  }

  async function add() {
    if (!line) return;
    setBusy(true);
    setError(null);
    const npc = { npcId: Number(npcId.trim()) };
    try {
      // An NPC nobody has answered is answered first, as /npcs would: a speaker needs a voice.
      if (!answered && !(await post("/api/npcs", { ...npc, npcKind: npcType, npcName, race, gender, flavor }))) return;
      const replaces = replace ? { replaces: { npcType: line.npcType, npcId: line.npcId } } : {};
      if (await post("/api/quests/lines/speakers", { ...npc, lineId: line.lineId, npcType, ...replaces })) onSaved();
    } catch (problem) {
      setError(String(problem));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onCancel()}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{replace ? "Replace the speaker" : "Add a speaker"}</DialogTitle>
          <DialogDescription>
            {replace
              ? `The NPC who really says this line, in place of ${line.npcName}. The line is spoken in the new NPC’s voice and shows as missing until it is generated again; the addon plays the old audio until then. ${line.npcName} stays off the line across imports.`
              : "Another NPC who says this line. It is spoken in that NPC’s own voice: one whose voice differs gets a line of its own here, with no audio until it is generated. Kept across imports until the game data lists the NPC too."}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-3">
          <span className="text-muted-foreground text-xs">
            {line.npcName} · {line.lineId}
          </span>
          <p className="text-muted-foreground bg-muted/40 max-h-24 overflow-y-auto rounded-md px-3 py-2 text-xs whitespace-pre-wrap">
            {line.override ?? line.text}
          </p>

          <form
            className="flex gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              void lookUp();
            }}
          >
            <select
              aria-label="Kind"
              value={npcType}
              onChange={(event) => {
                setNpcType(event.target.value as NpcRowKind);
                setFound(null);
              }}
              className={FIELD}
            >
              {NPC_ROW_KINDS.map((kind) => (
                <option key={kind} value={kind}>
                  {kind}
                </option>
              ))}
            </select>
            <input
              aria-label="Id"
              autoFocus
              inputMode="numeric"
              value={npcId}
              onChange={(event) => {
                setNpcId(event.target.value);
                setFound(null);
              }}
              placeholder="id"
              className={`${FIELD} w-32`}
            />
            <Button type="submit" variant="outline" disabled={busy || !npcId.trim()}>
              Look up
            </Button>
          </form>

          {found && answered && (
            <p className="text-sm">
              {found.npc?.npcName ?? `${npcType} ${npcId}`}{" "}
              <span className="text-muted-foreground">speaks as {found.npc?.voice}</span>
            </p>
          )}

          {found && !answered && roster && (
            <div className="grid gap-2">
              <p className="text-muted-foreground text-xs">
                {found.npc?.race
                  ? `${noVoice(found.npc)}: answer who this NPC is.`
                  : "Nobody has said who this NPC is yet. The answer holds for every line it speaks."}
              </p>
              <input
                aria-label="Name"
                value={npcName}
                onChange={(event) => setNpcName(event.target.value)}
                maxLength={200}
                placeholder="Name, as the game shows it"
                className={FIELD}
              />
              <div className="flex gap-2">
                <Choice
                  label="Type"
                  value={race}
                  options={roster.races}
                  onChange={(value) => {
                    setRace(value);
                    setGender("");
                    setFlavor("");
                  }}
                />
                {genders.length > 0 && (
                  <Choice
                    label="Gender"
                    value={gender}
                    options={genders}
                    onChange={(value) => {
                      setGender(value);
                      setFlavor("");
                    }}
                  />
                )}
                {flavors.length > 0 && <Choice label="Flavor" value={flavor} options={flavors} onChange={setFlavor} />}
              </div>
            </div>
          )}
        </div>

        {error && (
          <p role="alert" className="text-destructive text-xs">
            {error}
          </p>
        )}

        <DialogFooter>
          <Button variant="ghost" disabled={busy} onClick={onCancel}>
            Cancel
          </Button>
          <Button disabled={busy || !found || (!answered && !answerReady)} onClick={() => void add()}>
            {replace ? "Replace speaker" : "Add speaker"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
