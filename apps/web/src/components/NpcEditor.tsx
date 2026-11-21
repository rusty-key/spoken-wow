"use client";

/**
 * /npcs: every NPC on file, one row each, with the triage table's own speaker
 * controls. `initial` is NpcSummary, built server-side (npcSummaryFrom), so nothing from
 * the npc table beyond what is rendered crosses into the client.
 */
import { SearchIcon } from "lucide-react";
import { usePathname, useSearchParams } from "next/navigation";
import { useCallback, useMemo, useState } from "react";

import FilterChip, { type ChipOption } from "@/components/FilterChip";
import { LiteButton, ROW_BUTTON, ROW_LINE } from "@/components/LiteControls";
import { useLang } from "@/components/LangProvider";
import { useHistoryMode } from "@/components/useHistoryMode";
import { useRosterEdits } from "@/components/RosterEdits";
import SortHeader from "@/components/SortHeader";
import SpeakerCell, { type SpeakerAnswer } from "@/components/SpeakerCell";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import Pagination from "@/components/Pagination";
import ClientSelect from "@/components/ClientSelect";
import { clientFilterOf, DEFAULT_CLIENT_FILTER, matchesClient, type ClientFamily, type ClientFilter } from "@/lib/contributions/client";
import { flavorOptionsFor, summaryFromResolution, summaryFromBody } from "@/lib/contributions/speaker";
import type { Roster, RosterData } from "@/lib/voices/roster";
import type { NpcSummary } from "@/lib/contributions/triage";
import { localeHref } from "@/lib/lang";
import { isProvenance, PROVENANCES, sexOf, type NpcRowKind, type Provenance, type Sex } from "@/lib/npc/npc";
import type { NpcResolution, NpcBodyAnswer } from "@/lib/npc/store";
import { wowheadEntityUrl } from "@/lib/wowhead";

function key(npcKind: NpcRowKind | null, npcId: number): string {
  return `${npcKind}:${npcId}`;
}

// ContributionTable's own words for the same five, so a speaker reads the same on both tabs.
const PROVENANCE_LABELS: Record<Provenance, string> = {
  corpus: "Corpus",
  display: "Game data",
  client: "Guessed",
  moderator: "Moderated",
  none: "Unknown",
};

const SPEAKER_CHIP_OPTIONS: ChipOption[] = PROVENANCES.map((option) => ({
  value: option,
  label: PROVENANCE_LABELS[option],
}));

const PAGE_SIZE = 100;

type SortColumn = "id" | "name";
type Sort = { column: SortColumn; direction: "asc" | "desc" };

/** `?sort=name`, `?sort=-id`: the column, descending when signed. By id, ascending, unsaid. */
function sortOf(param: string | null): Sort {
  const direction = param?.startsWith("-") ? "desc" : "asc";
  const column = param?.replace(/^-/, "");
  return { column: column === "name" ? "name" : "id", direction };
}

function sortParam(sort: Sort): string | undefined {
  if (sort.column === "id" && sort.direction === "asc") return undefined;
  return `${sort.direction === "desc" ? "-" : ""}${sort.column}`;
}

/** A click on the column in force flips it; on another, sorts by that one ascending. */
function nextSort(current: Sort, column: SortColumn): Sort {
  if (current.column !== column) return { column, direction: "asc" };
  return { column, direction: current.direction === "asc" ? "desc" : "asc" };
}

/** Unnamed NPCs last either way, as nothing to read. */
function compare(sort: Sort): (a: NpcSummary, b: NpcSummary) => number {
  const sign = sort.direction === "asc" ? 1 : -1;
  if (sort.column === "id") return (a, b) => sign * (a.npcId - b.npcId);
  return (a, b) => {
    if (!a.npcName || !b.npcName) return Number(!a.npcName) - Number(!b.npcName);
    return sign * a.npcName.localeCompare(b.npcName) || a.npcId - b.npcId;
  };
}

const PROGRESSES = ["unfinished", "doubtful", "finished"] as const;
type Progress = (typeof PROGRESSES)[number];

function isProgress(value: unknown): value is Progress {
  return (PROGRESSES as readonly unknown[]).includes(value);
}

const PROGRESS_CHIP_OPTIONS: ChipOption[] = [
  { value: "unfinished", label: "Unfinished" },
  { value: "doubtful", label: "Doubtful" },
  { value: "finished", label: "Finished" },
];

/**
 * Whether this NPC's voice still has a blank to fill: type, gender where the type has genders,
 * or a flavor its type and gender offer. A confirmed row with every field null is settled rather
 * than blank -- someone decided it has no type (see SpeakerCell's speakerNote) -- so it counts
 * as finished.
 */
function unfinished(npc: NpcSummary, roster: Roster): boolean {
  if (npc.confirmed && !npc.race && !npc.gender && !npc.flavor) return false;
  if (!npc.race) return true;
  if (!npc.gender && !roster.isGenderless(npc.race)) return true;
  // The roster as it stands, not npc.flavorOptions from page load: a flavor made since counts.
  return !npc.flavor && flavorOptionsFor(npc.race, npc.gender, roster).length > 0;
}

/**
 * Where an NPC stands for the progress filter. A blank outranks a doubt, being the more
 * pressing thing to fill, and "finished" means neither.
 */
function progressOf(npc: NpcSummary, roster: Roster): Progress {
  if (unfinished(npc, roster)) return "unfinished";
  return npc.doubtful ? "doubtful" : "finished";
}

/**
 * Whether the NPC, or any body it is split into, is of this type or read by this voice. Each
 * filter matches on its own when the other is unset.
 */
function matchesSpeaker(
  npc: NpcSummary,
  bodies: NpcBodyAnswer[],
  roster: Roster,
  type: string | undefined,
  voice: string | undefined,
): boolean {
  if (!type && !voice) return true;
  return [npc, ...bodies].some(
    (answer) =>
      (!type || answer.race === type) &&
      (!voice || roster.voiceFor(answer.race, answer.gender, answer.flavor) === voice),
  );
}

/** A voice answer, or a name: the route saves each on its own. */
type Answer = SpeakerAnswer & { npcName?: string };

/** An NPC's name with a moderator's Edit, which saves over whatever named it. */
function NameCell({
  name,
  busy,
  onSave,
}: {
  name: string | null;
  busy: boolean;
  onSave: (name: string) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  if (draft === null) {
    return (
      <div className={ROW_LINE}>
        <span>{name ?? <span className="text-muted-foreground">unnamed</span>}</span>
        <LiteButton className={ROW_BUTTON} onClick={() => setDraft(name ?? "")}>
          Edit
        </LiteButton>
      </div>
    );
  }
  const trimmed = draft.trim();
  return (
    <form
      className={ROW_LINE}
      onSubmit={(event) => {
        event.preventDefault();
        if (trimmed && trimmed !== name) onSave(trimmed);
        setDraft(null);
      }}
    >
      <input
        aria-label="NPC name"
        autoFocus
        maxLength={200}
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => event.key === "Escape" && setDraft(null)}
        className="border-input bg-background h-7 w-44 rounded-md border px-2"
      />
      <LiteButton type="submit" className={ROW_BUTTON} disabled={busy || !trimmed}>
        Save
      </LiteButton>
    </form>
  );
}

/**
 * Where an NPC's lines can be looked up: the explorer and the contributions. The contributions
 * link carries this page's client filter, since the two pages read it the same way.
 */
function lookups(npcId: number, client: ClientFilter): { label: string; path: string; where: string }[] {
  const search = `q=${npcId}&filter=npc`;
  const contributed = client === DEFAULT_CLIENT_FILTER ? search : `${search}&client=${client}`;
  return [
    { label: "Q", path: `/quests?${search}`, where: "the quests explorer" },
    { label: "CQ", path: `/contributions/quests?${contributed}`, where: "quest contributions" },
  ];
}

const SEX_WORDS: Record<number, string> = { 2: "man", 3: "woman" };

/** "As a gnome woman": what a body row is labelled with. */
function bodyLabel(answer: NpcBodyAnswer): string {
  return `As a ${answer.race} ${SEX_WORDS[answer.sex]}`;
}

/** A body the admin is adding: a type and a sex, then Add. */
function AddBody({ roster, busy, onAdd }: { roster: Roster; busy: boolean; onAdd: (race: string, sex: Sex) => void }) {
  const [race, setRace] = useState("");
  const [sex, setSex] = useState<Sex>(2);
  const races = roster.races.filter((type) => !roster.isGenderless(type));
  return (
    <form className={ROW_LINE} onSubmit={(event) => { event.preventDefault(); if (race) onAdd(race, sex); }}>
      <select aria-label="Body type" value={race} onChange={(event) => setRace(event.target.value)}
        className="border-input bg-background h-7 rounded-md border px-1">
        <option value="">Add a body…</option>
        {races.map((type) => <option key={type} value={type}>{type}</option>)}
      </select>
      <select aria-label="Body sex" value={sex} onChange={(event) => setSex(Number(event.target.value) as Sex)}
        className="border-input bg-background h-7 rounded-md border px-1">
        <option value={2}>man</option>
        <option value={3}>woman</option>
      </select>
      <LiteButton type="submit" className={ROW_BUTTON} disabled={busy || !race}>Add</LiteButton>
    </form>
  );
}

/** A creature's split by body: each body's answer with its own Edit and Remove, Split by sex, Add, Unsplit. */
function BodyCells({
  npc,
  bodies,
  roster,
  edits,
  busy,
  onPost,
}: {
  npc: NpcSummary;
  bodies: NpcBodyAnswer[];
  roster: Roster;
  edits: ReturnType<typeof useRosterEdits>;
  busy: boolean;
  onPost: (body: Record<string, unknown>) => void;
}) {
  if (npc.npcKind !== "creature" || !npc.race || sexOf(npc.gender) === null) return null;
  const add = <AddBody roster={roster} busy={busy} onAdd={(race, sex) => onPost({ action: "add", race, sex })} />;
  if (!bodies.length) {
    return (
      <div className="mt-1 space-y-1">
        <LiteButton className={ROW_BUTTON} disabled={busy} onClick={() => onPost({ action: "split" })}
          title="Voice every line this NPC speaks once as a man and once as a woman">
          Split by sex
        </LiteButton>
        {add}
      </div>
    );
  }
  return (
    <div className="mt-1 space-y-1 border-l pl-2">
      {bodies.map((answer) => (
        <div key={`${answer.race}:${answer.sex}`} className={ROW_LINE}>
          <span className="text-muted-foreground w-36 shrink-0">{bodyLabel(answer)}</span>
          <SpeakerCell
            key={`${answer.provenance}:${answer.flavor}:${answer.doubtful}`}
            npc={summaryFromBody(npc, answer, roster)}
            roster={roster}
            edits={edits}
            readOnly={false}
            busy={busy}
            lockType
            onSave={(next) => onPost({ race: answer.race, sex: answer.sex, flavor: next.flavor ?? answer.flavor, doubtful: next.doubtful ?? false })}
          />
          <LiteButton className={ROW_BUTTON} disabled={busy} onClick={() => onPost({ action: "remove", race: answer.race, sex: answer.sex })}
            title="Stop voicing this body on its own">
            Remove
          </LiteButton>
        </div>
      ))}
      {add}
      <LiteButton className={ROW_BUTTON} disabled={busy} onClick={() => onPost({ action: "unsplit" })}
        title="Voice every line this NPC speaks in its one answer again">
        Unsplit
      </LiteButton>
    </div>
  );
}

export default function NpcEditor({
  initial,
  roster: rosterData,
}: {
  /**
   * Each with the client family whose guess filed it, null for one only the extract names, and
   * its bodies where it is split by body.
   */
  initial: (NpcSummary & { client: ClientFamily | null; bodies: NpcBodyAnswer[] })[];
  /** The roster, for SpeakerCell's pickers, and grown by their "New" entries. */
  roster: RosterData;
}) {
  const lang = useLang();
  const edits = useRosterEdits(rosterData);
  const { roster } = edits;
  const pathname = usePathname();
  const params = useSearchParams();
  // The filters live in the URL, so a reload or a shared link keeps the view. Written with
  // native history calls rather than the router, for places/Explorer.tsx's reason: the rows
  // are all here already, and Next re-renders useSearchParams() from a native history call.
  const query = params.get("q") ?? "";
  const speakerParam = params.get("speaker");
  const provenance = isProvenance(speakerParam) ? speakerParam : undefined;
  const progressParam = params.get("progress");
  const progress = isProgress(progressParam) ? progressParam : undefined;
  // Taken as written rather than checked against the roster: FilterChip shows an unknown value
  // as itself, and it matches nothing.
  const type = params.get("type") || undefined;
  const voice = params.get("voice") || undefined;
  // Absent is the default bin, so "all" is written out.
  const client = clientFilterOf(params.get("client"));
  const sortValue = params.get("sort");
  const sort = useMemo(() => sortOf(sortValue), [sortValue]);
  const historyMode = useHistoryMode();
  const setParam = useCallback(
    (name: string, value: string | undefined) => {
      const search = new URLSearchParams(params.toString());
      if (value) search.set(name, value);
      else search.delete(name);
      // A narrower view starts again from its first page: the one it was on may not exist.
      if (name !== "page") search.delete("page");
      const next = search.toString();
      const url = next ? `${pathname}?${next}` : pathname;
      // The search box writes per keystroke; see useHistoryMode.
      if (historyMode(name === "q") === "push") window.history.pushState(null, "", url);
      else window.history.replaceState(null, "", url);
    },
    [historyMode, params, pathname],
  );
  /** What this session saved, over the server's rows, keyed by NPC. */
  const [saved, setSaved] = useState<Record<string, NpcSummary>>({});
  /** Each split this session saved, over the server's, keyed by NPC. */
  const [savedBodies, setSavedBodies] = useState<Record<string, NpcBodyAnswer[]>>({});
  const initialBodies = useMemo(
    () => new Map(initial.filter((row) => row.bodies.length).map((row) => [key(row.npcKind, row.npcId), row.bodies])),
    [initial],
  );
  const [busy, setBusy] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  /** Rows ticked for the bulk saves, keyed by NPC. */
  const [selected, setSelected] = useState<Set<string>>(new Set());
  /** A bulk run in flight, for its progress line and to hold every other control still meanwhile. */
  const [bulk, setBulk] = useState<{ doubtful: boolean; done: number; total: number } | null>(null);
  /** What the last bulk run came to, until the next one starts. */
  const [bulkOutcome, setBulkOutcome] = useState<string | null>(null);

  /** One answer, posted and taken into `saved`. True when it landed. */
  const post = useCallback(
    async (npc: NpcSummary, answer: Answer): Promise<boolean> => {
      // Every row here came from the npc table, so npcKind is never null and the route's
      // required kind is always the row's own.
      const response = await fetch("/api/npcs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...answer, npcKind: npc.npcKind, npcId: npc.npcId }),
      }).catch(() => null);
      if (!response?.ok) return false;
      const { resolution } = (await response.json()) as { resolution: NpcResolution };
      setSaved((current) => ({
        ...current,
        [key(npc.npcKind, npc.npcId)]: summaryFromResolution(resolution, roster),
      }));
      return true;
    },
    [roster],
  );

  const save = useCallback(
    async (npc: NpcSummary, answer: Answer) => {
      const k = key(npc.npcKind, npc.npcId);
      setBusy(k);
      setFailed(null);
      const ok = await post(npc, answer);
      setBusy(null);
      if (!ok) setFailed(k);
    },
    [post],
  );

  const postBody = useCallback(async (npc: NpcSummary, body: Record<string, unknown>) => {
    const k = key(npc.npcKind, npc.npcId);
    setBusy(k);
    setFailed(null);
    const response = await fetch("/api/npcs/body", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...body, npcKind: npc.npcKind, npcId: npc.npcId }),
    }).catch(() => null);
    setBusy(null);
    if (!response?.ok) {
      setFailed(k);
      return;
    }
    const { bodies } = (await response.json()) as { bodies: NpcBodyAnswer[] };
    setSavedBodies((current) => ({ ...current, [k]: bodies }));
  }, []);

  /**
   * Each ticked NPC's answer as it stands, saved as the moderator's own -- a guess taken as
   * right, or a doubt settled or raised. Only `doubtful` is sent: the route keeps race, gender
   * and flavor for a key left off the POST, so nothing on the row is retyped. One at a time,
   * as the triage table's bulk accept is, so a failure is attributable to its row.
   */
  const saveMany = useCallback(
    async (npcs: NpcSummary[], doubtful: boolean) => {
      setBulkOutcome(null);
      setBulk({ doubtful, done: 0, total: npcs.length });
      const refused: string[] = [];
      for (const [index, npc] of npcs.entries()) {
        if (!(await post(npc, { doubtful }))) refused.push(key(npc.npcKind, npc.npcId));
        setBulk({ doubtful, done: index + 1, total: npcs.length });
      }
      setBulk(null);
      // The failed rows stay ticked, so pressing the same button again is the whole retry.
      setSelected(new Set(refused));
      setBulkOutcome(
        `Saved ${npcs.length - refused.length} of ${npcs.length}` +
          (doubtful ? " as doubtful" : "") +
          (refused.length > 0 ? ` -- ${refused.length} failed and left selected.` : "."),
      );
    },
    [post],
  );

  // Not rebuilt when only `busy` or `failed` changes.
  const rows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return initial
      .filter((npc) => matchesClient(npc.client, client))
      .map((npc) => saved[key(npc.npcKind, npc.npcId)] ?? npc)
      .filter(
        (npc) =>
          !needle || String(npc.npcId).includes(needle) || (npc.npcName ?? "").toLowerCase().includes(needle),
      )
      .filter((npc) => !provenance || npc.provenance === provenance)
      .filter((npc) => !progress || progressOf(npc, roster) === progress)
      .filter((npc) => {
        const k = key(npc.npcKind, npc.npcId);
        return matchesSpeaker(npc, savedBodies[k] ?? initialBodies.get(k) ?? [], roster, type, voice);
      })
      .sort(compare(sort));
  }, [initial, client, saved, savedBodies, initialBodies, query, provenance, progress, type, voice, sort, roster]);
  const typeOptions = useMemo(() => roster.races.map((race) => ({ value: race, label: race })), [roster]);
  const voiceOptions = useMemo(() => roster.voiceNames.map((name) => ({ value: name, label: name })), [roster]);

  // A page at a time: every row is a SpeakerCell with its own selects, and all of them at once
  // made the first load and every tick slow.
  const pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const page = Math.min(Math.max(1, Math.floor(Number(params.get("page")) || 1)), pages);
  const shown = rows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  // The pager sits under the table, so the next page would otherwise open at its last row.
  const goToPage = (next: number) => {
    setParam("page", next > 1 ? String(next) : undefined);
    window.scrollTo({ top: 0 });
  };

  // Only rows still on screen count, as in the triage table: a ticked row a filter now hides
  // must not be saved by a button that no longer shows it.
  const selectedRows = shown.filter((npc) => selected.has(key(npc.npcKind, npc.npcId)));
  // A bulk save keeps each row's own answer, so a row without a race and gender has nothing to
  // keep -- saving it would file "this NPC has no race" as a decision nobody made.
  // A genderless type is a whole answer without one.
  const savable = selectedRows.filter((npc) => npc.race && (npc.gender || roster.isGenderless(npc.race)));
  const allTicked = shown.length > 0 && selectedRows.length === shown.length;
  const toggle = (k: string, on: boolean) =>
    setSelected((current) => {
      const next = new Set(current);
      if (on) next.add(k);
      else next.delete(k);
      return next;
    });

  return (
    <>
      <div className="mb-4 flex items-center gap-3">
        <Input
          type="search"
          placeholder="Filter by id or name"
          value={query}
          onChange={(event) => setParam("q", event.target.value)}
          className="h-8 max-w-xs text-sm"
        />
        <FilterChip
          label="speaker"
          value={provenance}
          options={SPEAKER_CHIP_OPTIONS}
          onChange={(next) => setParam("speaker", next)}
        />
        <FilterChip
          label="progress"
          value={progress}
          options={PROGRESS_CHIP_OPTIONS}
          onChange={(next) => setParam("progress", next)}
        />
        <FilterChip label="type" value={type} options={typeOptions} onChange={(next) => setParam("type", next)} />
        <FilterChip label="voice" value={voice} options={voiceOptions} onChange={(next) => setParam("voice", next)} />
        <span className="text-muted-foreground text-xs">
          {rows.length} of {initial.length}
        </span>
        <ClientSelect
          value={client}
          onChange={(next) => setParam("client", next === DEFAULT_CLIENT_FILTER ? undefined : next)}
        />
      </div>

      {rows.length > 0 ? (
        <div className="mb-3 flex min-h-8 flex-wrap items-center gap-2 text-xs">
          {bulk ? (
            <span className="text-muted-foreground">
              Saving{bulk.doubtful ? " as doubtful" : ""}: {bulk.done} of {bulk.total}…
            </span>
          ) : (
            <>
              {selectedRows.length > 0 ? (
                <>
                  <span className="text-muted-foreground">{selectedRows.length} selected</span>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={savable.length === 0}
                    onClick={() => void saveMany(savable, false)}
                  >
                    Save ({savable.length})
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={savable.length === 0}
                    onClick={() => void saveMany(savable, true)}
                  >
                    Save as doubtful ({savable.length})
                  </Button>
                  {savable.length < selectedRows.length ? (
                    <span className="text-muted-foreground">
                      {selectedRows.length - savable.length} without a race and gender skipped
                    </span>
                  ) : null}
                  <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>
                    Clear
                  </Button>
                </>
              ) : (
                <span className="text-muted-foreground">Tick rows to save their answers in bulk.</span>
              )}
              {bulkOutcome ? <span className="text-muted-foreground ml-2">{bulkOutcome}</span> : null}
            </>
          )}
        </div>
      ) : null}

      {rows.length === 0 ? (
        <p className="text-muted-foreground text-sm">Nothing here.</p>
      ) : (
        <table className="w-fit border-separate border-spacing-0 text-sm">
          <thead className="text-muted-foreground text-left text-xs">
            <tr>
              <th className="border-b py-2 pr-2 align-middle font-normal">
                <Checkbox
                  aria-label="Select every NPC shown"
                  checked={allTicked ? true : selectedRows.length > 0 ? "indeterminate" : false}
                  disabled={bulk !== null}
                  onCheckedChange={(on) =>
                    setSelected(on === true ? new Set(shown.map((npc) => key(npc.npcKind, npc.npcId))) : new Set())
                  }
                />
              </th>
              <SortHeader column="id" sort={sort} onSort={(column) => setParam("sort", sortParam(nextSort(sort, column)))}>
                ID
              </SortHeader>
              <SortHeader column="name" sort={sort} onSort={(column) => setParam("sort", sortParam(nextSort(sort, column)))}>
                Name
              </SortHeader>
              <th className="border-b py-2 pr-3 font-normal">Type / gender / flavor</th>
              <th className="border-b py-2 font-normal" />
            </tr>
          </thead>
          <tbody>
            {shown.map((npc) => {
              const k = key(npc.npcKind, npc.npcId);
              return (
                <tr key={k} className="align-middle [&>td]:border-b [&>td]:py-1.5 [&>td]:leading-5">
                  <td className="pr-2">
                    <Checkbox
                      aria-label={`Select NPC ${npc.npcId}`}
                      checked={selected.has(k)}
                      disabled={bulk !== null}
                      onCheckedChange={(on) => toggle(k, on === true)}
                    />
                  </td>
                  <td className="pr-3 text-xs whitespace-nowrap">
                    <span className="font-mono">{npc.npcId}</span>
                    {npc.npcKind === "gameobject" ? (
                      <span className="text-muted-foreground"> · object</span>
                    ) : null}{" "}
                    <a
                      href={wowheadEntityUrl(npc.npcKind ?? "creature", npc.npcId)}
                      target="_blank"
                      rel="noreferrer"
                      title="Wowhead Forever"
                      className="text-muted-foreground hover:underline"
                    >
                      wh↗
                    </a>
                  </td>
                  <td className="pr-3 text-xs">
                    <NameCell
                      key={npc.npcName ?? ""}
                      name={npc.npcName}
                      busy={busy === k || bulk !== null}
                      onSave={(npcName) => void save(npc, { npcName })}
                    />
                  </td>
                  <td className="pr-3 text-xs">
                    <SpeakerCell
                      // Remount on a save, so the form's own state starts from the new answer.
                      key={`${npc.provenance}:${npc.race}:${npc.gender}:${npc.flavor}:${npc.doubtful}`}
                      npc={npc}
                      roster={roster}
                      edits={edits}
                      readOnly={false}
                      busy={busy === k || bulk !== null}
                      onSave={(answer) => void save(npc, answer)}
                    />
                    <BodyCells
                      npc={npc}
                      bodies={savedBodies[k] ?? initialBodies.get(k) ?? []}
                      roster={roster}
                      edits={edits}
                      busy={busy === k || bulk !== null}
                      onPost={(body) => void postBody(npc, body)}
                    />
                    {failed === k ? (
                      <p className="text-destructive mt-1">That didn&apos;t go through -- try again.</p>
                    ) : null}
                  </td>
                  <td className="text-right whitespace-nowrap">
                    {lookups(npc.npcId, client).map(({ label, path, where }) => (
                      <a
                        key={label}
                        href={localeHref(lang, path)}
                        title={`Find this NPC's lines in ${where}`}
                        aria-label={`Find ${npc.npcName ?? npc.npcId} in ${where}`}
                        className="text-muted-foreground hover:text-foreground inline-flex items-center gap-0.5 p-1 text-xs"
                      >
                        <SearchIcon className="size-3.5" />
                        {label}
                      </a>
                    ))}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      <Pagination page={page} pageCount={pages} onPage={goToPage} />
    </>
  );
}
