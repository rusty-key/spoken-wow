"use client";

/**
 * Who voices an NPC, and the controls that answer it -- shared by the triage table
 * (ContributionTable) and the NPC editor (NpcEditor), which both write through api/npcs.
 */
import { useMemo, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { LiteButton, LiteCheckbox } from "@/components/LiteControls";
// `import type`: triage.ts is server-only (it pulls in corpus.ts), see ContributionTable.
import type { NpcSummary } from "@/lib/contributions/triage";
import { flavorOptionsFor } from "@/lib/contributions/speaker";
import { NPC_KINDS, type NpcKind, type Provenance } from "@/lib/npc/npc";
import { Roster, type Gender, type RosterData } from "@/lib/voices/roster";

const GENDERS: Gender[] = ["female", "male"];

/** What a saved answer posts: see SpeakerCell's own docstring for why every key is optional. */
export type SpeakerAnswer = Partial<{
  npcKind: NpcKind;
  race: string;
  gender: string;
  flavor: string;
  doubtful: boolean;
}>;

// A speaker's provenance as a pill: a letter or two, so the answer and its Edit fit on one
// line, with what it means on hover.
const PROVENANCE_PILLS: Record<Provenance, { short: string; title: string }> = {
  corpus: { short: "C", title: "Corpus: the game's own data for this NPC" },
  display: { short: "D", title: "Display: the game's voice set for the appearance the client saw" },
  client: { short: "G", title: "Guess: from the model the client reported" },
  moderator: { short: "M", title: "Moderator: set by hand" },
  none: { short: "?", title: "No race: nothing known about this NPC" },
};

export function ProvenanceBadge({ provenance }: { provenance: Provenance }) {
  const pill = PROVENANCE_PILLS[provenance];
  return (
    <Badge variant="outline" className="cursor-help px-1.5 py-0 leading-5" title={pill.title}>
      {pill.short}
    </Badge>
  );
}

/**
 * A moderator's answer they are not sure of (migration 0054): voiced like any other, flagged so
 * /npcs can find it again for a second look.
 */
function DoubtBadge() {
  return (
    <Badge
      variant="outline"
      className="cursor-help border-amber-500/60 px-1.5 py-0 leading-5 text-amber-600 dark:text-amber-400"
      title="Doubtful: a best answer, saved to be checked later"
    >
      doubt
    </Badge>
  );
}

/** "type-gender-flavor", or as much of it as is known -- an admin can fill in the rest. */
function speaker(npc: NpcSummary): string {
  // A type with no flavor is a whole answer -- one voice reads it -- not a flavor still to be
  // decided; nor is a genderless type's missing gender.
  if (npc.race) return [npc.race, npc.gender, npc.flavor].filter(Boolean).join("-");
  return [npc.race, npc.gender, npc.flavor].map((part) => part ?? "?").join("-");
}

/**
 * A row's speaker column must never read as a confident answer when it isn't one: `confirmed`
 * is the one column resolveNpc and the override route agree means "trust this", so it -- not
 * provenance alone -- is what this table shows plainly versus flags.
 *
 * A confirmed row with every field null is still a decision, not an absence -- a moderator (or
 * the corpus, for a narrator-style pseudo-race) looked and there is no race to assign. Left
 * unlabelled, "?-?-?" next to a "moderator" badge would be one small badge away from looking
 * identical to a genuinely unresolved "?-?-?"/"none" row, which defeats the point of this column
 * being a skimmable "still needs a human" signal.
 *
 * Null (no note at all) for an unconfirmed row with no provenance opinion: the nothing-known
 * form rendered right below already says "nobody has answered this" as plainly as a caption
 * could -- a redundant "not identified" used to sit here saying the same thing a third time,
 * after the missing provenance badge (see the `none` branch below) already dropped it once.
 */
function speakerNote(npc: NpcSummary): string | null {
  if (npc.confirmed) {
    return npc.race || npc.gender || npc.flavor ? null : "confirmed: no race";
  }
  return null;
}

/**
 * Who voices an NPC, in three states keyed on `confirmed`, not `provenance` alone, for the
 * reason speakerNote already draws that distinction: `confirmed` is the column resolveNpc and
 * the override route agree means "trust this" (migrations 0031 and 0055 only ever set it for
 * "corpus", "display" or "moderator"), so a settled answer renders plainly.
 *
 *   - confirmed: plain text; a moderator's own answer adds an Edit that reopens the form.
 *   - unconfirmed, race and gender known ("client"): race-gender as text, a flavor select
 *     narrowed to flavorsFor(race, gender) -- npc.flavorOptions, computed server-side.
 *   - unconfirmed, nothing known ("none"): race and gender selects from the voiced list
 *     (the roster), gender narrowed to the chosen type and hidden for a genderless one, and a
 *     flavor select that fills in once both are chosen.
 *
 * Saving never resends a field the moderator didn't touch: the route's own orExisting is what
 * makes that safe, and doing it here too is what lets "this is a tauren male" (no flavor
 * opinion) and "just the flavor" (client row, race/gender already right) both post a partial
 * answer instead of a full one.
 */
export default function SpeakerCell({
  npc,
  roster: rosterData,
  readOnly,
  busy,
  onSave,
}: {
  npc: NpcSummary;
  roster: RosterData;
  readOnly: boolean;
  busy: boolean;
  onSave: (answer: SpeakerAnswer) => void;
}) {
  const roster = useMemo(() => new Roster(rosterData), [rosterData]);
  const [race, setRace] = useState(npc.race ?? "");
  const [gender, setGender] = useState(npc.gender ?? "");
  const [flavor, setFlavor] = useState(npc.flavor ?? "");
  const [doubtful, setDoubtful] = useState(npc.doubtful);
  // Only ever read for a kind-less row (npc.npcKind === null): NPC_KINDS's own values, "creature"
  // or "gameobject", picked by the moderator rather than guessed -- see NpcSummary's own
  // docstring for why resolveNpc refuses to make this guess itself.
  const [kind, setKind] = useState<NpcKind | "">("");
  // Reachable for a `moderator` row and a `client` guess (see below) -- a moderator's own
  // settled answer stays plain until they ask to change it, so an always-present form isn't one
  // stray click away from silently overwriting a considered "no race" with an empty save.
  const [editing, setEditing] = useState(false);

  // An NPC the game gives a race and gender but no flavor (the extract's corpus row) has no
  // voice until somebody picks one, so it opens on the flavor select, as a guess does.
  const needsFlavor = Boolean(npc.race && !npc.flavor && npc.flavorOptions.length > 0);

  // Read-only for somebody api/contributions/npc would refuse: the answer as it stands, with no
  // form that could only end in a 403.
  if (readOnly) {
    return (
      <div>
        <div className="flex items-center gap-1 whitespace-nowrap">
          <span>{speaker(npc)}</span>
          <ProvenanceBadge provenance={npc.provenance} />
          {npc.doubtful ? <DoubtBadge /> : null}
        </div>
        {speakerNote(npc) ? <p className="text-muted-foreground mt-0.5">{speakerNote(npc)}</p> : null}
      </div>
    );
  }

  if (npc.confirmed && !editing && !needsFlavor) {
    // A settled answer: the corpus's, a moderator's or a `display` one (migrations 0031 and
    // 0055). Each can still be wrong -- the extract reads a display, and the addon's rolls can
    // miss the appearance the player saw -- and an answer here voices every line the NPC
    // speaks, so each keeps an Edit. Shown plainly like the corpus, but with a small edit control that reopens the form
    // below, preselected with the current values via the same useState initialisers above. The
    // store already lets a moderator write over a moderator row -- upsertResolution's `where`
    // compares ranks with `<=`, so an equal rank still updates (store.test.ts's "lets a
    // moderator write over a moderator row update") -- so nothing there needs to change for
    // this to work.
    return (
      <div>
        <div className="flex items-center gap-1 whitespace-nowrap">
          <span>{speaker(npc)}</span>
          <ProvenanceBadge provenance={npc.provenance} />
          {npc.doubtful ? <DoubtBadge /> : null}
          <LiteButton
            variant="ghost"
            className="h-5 px-1.5 py-0 text-xs"
            onClick={() => setEditing(true)}
          >
            Edit
          </LiteButton>
        </div>
        {speakerNote(npc) ? <p className="text-muted-foreground mt-0.5">{speakerNote(npc)}</p> : null}
      </div>
    );
  }

  // `known` (race and gender taken as right, only the flavor is a guess) is specifically the
  // `client` provenance's own shape -- a moderator reopening their own row via Edit gets the
  // full race/gender/flavor selects below instead, since a moderator revising their own answer
  // may want to correct any of the three, not just the flavor. So does a guess the moderator
  // has said is wrong (its own Edit, below): the model the client reported is only a guess,
  // and a guessed bloodelf can be a human captain.
  const known = (npc.provenance === "client" || needsFlavor) && !editing;
  // The "nothing known" state's own flavor options: flavorScopes is the whole corpus, so this
  // narrows to whatever race and gender were just picked, the same shape flavorOptions already
  // is for the "client" state -- npc.flavorOptions answers for the race-gender on file, not
  // the one being picked.
  const flavorOptions = known
    ? npc.flavorOptions
    : flavorOptionsFor(race, gender, roster);
  const genderless = Boolean(race) && roster.isGenderless(race);

  return (
    <div className="flex flex-col gap-1 py-1">
      <div className="flex flex-wrap items-center gap-1">
        {known ? (
          <span className="font-mono">
            {[npc.race, npc.gender].filter(Boolean).join("-")}
            {flavorOptions.length > 0 ? "-" : null}
          </span>
        ) : (
          <>
            {npc.npcKind === null ? (
              <select
                value={kind}
                onChange={(event) => setKind(event.target.value as NpcKind | "")}
                className="h-7 rounded border bg-transparent text-xs"
              >
                <option value="">kind?</option>
                {NPC_KINDS.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            ) : null}
            {/* No separator spans between these -- each select already reads as its own field
                (a border, a "race?"/"gender?" placeholder), and a bare `·`/`-` between them was
                clutter, not information, once the gap the flex row already gives them separates
                them just as clearly. */}
            <select
              value={race}
              onChange={(event) => {
                setRace(event.target.value);
                // A gender the new type does not have would post a pair nothing can speak.
                if (event.target.value && !roster.gendersOf(event.target.value).includes(gender as Gender)) setGender("");
                setFlavor("");
              }}
              className="h-7 rounded border bg-transparent text-xs"
            >
              <option value="">type?</option>
              {roster.races.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
            {genderless ? null : (
              <select
                value={gender}
                onChange={(event) => {
                  setGender(event.target.value);
                  setFlavor("");
                }}
                className="h-7 rounded border bg-transparent text-xs"
              >
                <option value="">gender?</option>
                {(race ? roster.gendersOf(race) : GENDERS).map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            )}
          </>
        )}
        {/* A race-gender with no flavors in the corpus yet (bloodelf, skybourneelf) is voiced as
            bare race-gender, so there is nothing to pick and the answer saves without one. */}
        {(known || (race && (gender || genderless))) && flavorOptions.length > 0 ? (
          <select
            value={flavor}
            onChange={(event) => setFlavor(event.target.value)}
            className="h-7 rounded border bg-transparent text-xs"
          >
            <option value="">flavor?</option>
            {flavorOptions.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        ) : null}
        {/* `none` gets no badge: it is the provenance's own way of saying "we tried and learned
            nothing", which the form sitting right here already says. `client`
            still earns one, since "a guess came from somewhere" is real information the form
            alone doesn't carry. */}
        {npc.provenance !== "none" ? (
          <ProvenanceBadge provenance={npc.provenance} />
        ) : null}
        {known ? (
          <LiteButton
            variant="ghost"
            className="h-7 px-2 text-xs"
            onClick={() => setEditing(true)}
          >
            Edit
          </LiteButton>
        ) : null}
        {/* Unticked by default and resent on every save: the flag is part of the answer, so a
            save made without it is one the moderator now stands by. */}
        <label
          className="text-muted-foreground flex items-center gap-1"
          title="Save as a best answer, to be checked later -- lines still voice from it"
        >
          <LiteCheckbox checked={doubtful} onChange={(event) => setDoubtful(event.target.checked)} />
          doubt
        </label>
        <LiteButton
          variant="outline"
          className="h-7 px-2 text-xs"
          // A kind-less row with no kind picked yet has nothing valid to POST -- the route
          // requires npcKind and would 400 -- so the button waits rather than silently failing.
          disabled={busy || (npc.npcKind === null && !kind)}
          onClick={() => {
            // The "client" state never sends race/gender at all: leaving those keys off is what
            // tells the route to keep what the client already reported, rather than resending
            // (and risking retyping wrong) values this form doesn't even offer as inputs there.
            onSave(
              known
                ? { flavor, doubtful }
                : { npcKind: kind || undefined, race, gender, flavor, doubtful },
            );
            // Collapses back to the plain, settled view either way: the caller owns the request,
            // and a failed save leaves `npc` exactly as it was, so this re-shows that answer
            // rather than a form now out of sync with it.
            setEditing(false);
          }}
        >
          Save
        </LiteButton>
      </div>
      {speakerNote(npc) ? <p className="text-muted-foreground">{speakerNote(npc)}</p> : null}
    </div>
  );
}
