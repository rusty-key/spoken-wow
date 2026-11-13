"use client";

/**
 * The Types tab of /npcs: every type an NPC can be, its genders and flavors, and the voice each
 * combination is read with, one table row per combination. Every edit posts to api/types, which
 * answers with the whole roster, and the tab redraws from that rather than from what it sent. An
 * edit that would split a voice NPCs speak with comes back as a question, asked next to the
 * control that made it.
 */
import { Plus, Trash2 } from "lucide-react";
import { useState, type ReactNode } from "react";

import FilterChip, { type ChipOption } from "@/components/FilterChip";
import { LiteButton, ROW_BUTTON as BUTTON, ROW_LINE as LINE } from "@/components/LiteControls";
import { NewFlavorForm, NewTypeForm, useRosterEdits, type RosterEdits } from "@/components/RosterEdits";
import SearchSelect from "@/components/SearchSelect";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { newVoiceName, type Gender, type RosterData } from "@/lib/voices/roster";
import { GENDERS } from "@/lib/voices/voices";

/**
 * Delete stays out of sight until its row is hovered, as a column of red reads as noise
 * otherwise; a focused one stays visible for the keyboard.
 */
const ON_TYPE_HOVER = "opacity-0 group-hover/type:opacity-100 focus-visible:opacity-100";
const ON_ROW_HOVER = "opacity-0 group-hover/row:opacity-100 focus-visible:opacity-100";

const VOICED_OPTIONS: ChipOption[] = [
  { value: "yes", label: "has a voice" },
  { value: "no", label: "has no voice" },
];

type Group = { gender: Gender | null; flavors: (string | null)[] };

export default function TypesEditor({ initial }: { initial: RosterData }) {
  const edits = useRosterEdits(initial);
  const { roster, busy, send } = edits;
  const data = roster.data;
  const [query, setQuery] = useState("");
  const [voiced, setVoiced] = useState<string | undefined>();

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
      </div>
      <div>
        <AddType at="add-top" edits={edits} />
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
            edits={edits}
          />
        ))}
      </table>
      {shown.length === 0 ? <p className="text-muted-foreground text-xs">Nothing matches.</p> : null}
      {/* Again below a table long enough to scroll the first one away. */}
      <div>
        <AddType at="add-bottom" edits={edits} />
      </div>
    </div>
  );
}

function AddType({ at, edits }: { at: string; edits: RosterEdits }) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <LiteButton className={BUTTON} disabled={edits.busy}>
          <Plus className="size-3.5 shrink-0" />
          type
        </LiteButton>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 p-2">
        <NewTypeForm at={at} edits={edits} onMade={() => setOpen(false)} />
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
  edits,
}: {
  race: RosterData["races"][number];
  groups: Group[];
  edits: RosterEdits;
}) {
  const { roster, busy, refusal, send } = edits;
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
          <AddFlavor race={race.key} gender={gender} edits={edits} />
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
function AddFlavor({ race, gender, edits }: { race: string; gender: Gender | null; edits: RosterEdits }) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <LiteButton className={BUTTON} disabled={edits.busy}>
          <Plus className="size-3.5 shrink-0" />
          flavor
        </LiteButton>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 p-2">
        <NewFlavorForm
          at={`${race}:flavor:${gender ?? ""}`}
          race={race}
          gender={gender}
          edits={edits}
          onMade={() => setOpen(false)}
        />
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
      variant="ghost"
      className={`text-destructive hover:text-destructive size-6 justify-center p-0 ${reveal}`}
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
  roster: RosterEdits["roster"];
  busy: boolean;
  onPick: (voice: string | null) => void;
}) {
  // Only its own assignment, not one it falls back to: a flavor read by its type's voice says so.
  const own =
    roster.data.assignments.find((a) => a.race === race && a.gender === gender && a.flavor === flavor)?.voice ?? null;
  const inherited = own ? null : roster.voiceFor(race, gender, flavor);
  const fresh = newVoiceName(race, gender, flavor);
  return (
    <SearchSelect
      value={own}
      options={roster.voiceNames}
      placeholder="no voice"
      label={own ? undefined : inherited ? `as ${inherited}` : undefined}
      create={roster.isVoice(fresh) ? undefined : { label: `New voice: ${fresh}`, onSelect: () => onPick(null) }}
      disabled={busy}
      className="w-60"
      onChange={onPick}
    />
  );
}
