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
import { useUiText } from "@/components/UiTextProvider";
import Pagination from "@/components/Pagination";
import ClientSelect from "@/components/ClientSelect";
import { clientFilterOf, DEFAULT_CLIENT_FILTER, matchesClient, type ClientFamily, type ClientFilter } from "@/lib/contributions/client";
import { flavorOptionsFor, summaryFromResolution, summaryFromBody } from "@/lib/contributions/speaker";
import { bareDirection } from "@/lib/generation/narration";
import { fill } from "@/lib/site-text/format";
import type { Roster, RosterData } from "@/lib/voices/roster";
import type { NpcSummary } from "@/lib/contributions/triage";
import { langName, localeHref } from "@/lib/lang";
import { isProvenance, PROVENANCES, sexOf, type NpcRowKind, type Provenance, type Sex } from "@/lib/npc/npc";
import type { NpcResolution, NpcBodyAnswer } from "@/lib/npc/store";
import type { UiText } from "@/lib/ui-text/en";
import { wowheadEntityUrl } from "@/lib/wowhead";

function key(npcKind: NpcRowKind | null, npcId: number): string {
  return `${npcKind}:${npcId}`;
}

function directionKey(npcKey: string, inLanguage: boolean): string {
  return `${inLanguage ? "lang" : "global"}:${npcKey}`;
}

// ContributionTable's own words for the same five, so a speaker reads the same on both tabs.
const provenanceOptions = (words: UiText["npc"]): ChipOption[] =>
  PROVENANCES.map((option) => ({ value: option, label: words.provenance[option] }));

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

const PROGRESS_CHIP_OPTIONS = (words: UiText["npc"]): ChipOption[] => [
  { value: "unfinished", label: words.progress.unfinished },
  { value: "doubtful", label: words.progress.doubtful },
  { value: "finished", label: words.progress.finished },
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
  readOnly,
  busy,
  onSave,
}: {
  name: string | null;
  readOnly: boolean;
  busy: boolean;
  onSave: (name: string) => void;
}) {
  const t = useUiText();
  const words = t.npc;
  const [draft, setDraft] = useState<string | null>(null);
  if (draft === null) {
    return (
      <div className={ROW_LINE}>
        <span>{name ?? <span className="text-muted-foreground">{t.dashboard.unnamed}</span>}</span>
        {readOnly ? null : (
          <LiteButton className={ROW_BUTTON} onClick={() => setDraft(name ?? "")}>
            {words.edit}
          </LiteButton>
        )}
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
        aria-label={words.nameLabel}
        autoFocus
        maxLength={200}
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => event.key === "Escape" && setDraft(null)}
        className="border-input bg-background h-7 w-44 rounded-md border px-2"
      />
      <LiteButton type="submit" className={ROW_BUTTON} disabled={busy || !trimmed}>
        {words.save}
      </LiteButton>
    </form>
  );
}

/**
 * Where an NPC's lines can be looked up: the explorer and the contributions. The contributions
 * link carries this page's client filter, since the two pages read it the same way.
 */
function lookups(npcId: number, client: ClientFilter, words: UiText["npc"]): { label: string; path: string; where: string }[] {
  const search = `q=${npcId}&filter=npc`;
  const contributed = client === DEFAULT_CLIENT_FILTER ? search : `${search}&client=${client}`;
  return [
    { label: "Q", path: `/quests?${search}`, where: words.questsExplorer },
    { label: "CQ", path: `/contributions/quests?${contributed}`, where: words.questContributions },
  ];
}

const SEX_WORDS: Record<number, string> = { 2: "man", 3: "woman" };

/** An NPC's direction, typed bare; the route stores it bracketed. Without `onSave`, only shown. */
function DirectionCell({
  direction,
  busy,
  label,
  title,
  onSave,
}: {
  direction: string | null;
  busy: boolean;
  label: string;
  title: string;
  /** Resolves to the server's reason when the save was refused, null when it went through. */
  onSave?: (direction: string) => Promise<string | null>;
}) {
  const t = useUiText();
  const words = t.npc;
  const [draft, setDraft] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const bare = direction ? bareDirection(direction) : "";
  const shown = bare ? <span>[{bare}]</span> : null;
  if (!onSave) return shown;
  if (draft === null) {
    return (
      <div className={ROW_LINE}>
        {shown}
        <LiteButton className={ROW_BUTTON} onClick={() => setDraft(bare)} title={title}>
          {bare ? words.edit : words.add}
        </LiteButton>
      </div>
    );
  }
  const trimmed = draft.trim();
  const close = () => {
    setDraft(null);
    setError(null);
  };
  return (
    <form
      onSubmit={async (event) => {
        event.preventDefault();
        if (trimmed === bare) return close();
        // Open until the save lands, so a refused direction is still there to fix.
        const refused = await onSave(trimmed);
        if (refused) setError(refused);
        else close();
      }}
    >
      <div className={ROW_LINE}>
        <input
          aria-label={label}
          autoFocus
          maxLength={200}
          placeholder={words.directionPlaceholder}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => event.key === "Escape" && close()}
          className="border-input bg-background h-7 w-44 rounded-md border px-2"
        />
        <LiteButton type="submit" className={ROW_BUTTON} disabled={busy}>
          {trimmed || !bare ? words.directionSave : words.directionClear}
        </LiteButton>
      </div>
      {error ? <p className="text-destructive mt-1">{error}</p> : null}
    </form>
  );
}

/** "As a gnome woman": what a body row is labelled with. */
function bodyLabel(answer: NpcBodyAnswer, words: UiText["npc"]): string {
  return fill(words.asBody, { race: answer.race, sex: answer.sex === 2 ? words.man : words.woman });
}

/** A body the admin is adding: a type and a sex, then Add. */
function AddBody({ roster, busy, onAdd }: { roster: Roster; busy: boolean; onAdd: (race: string, sex: Sex) => void }) {
  const words = useUiText().npc;
  const [race, setRace] = useState("");
  const [sex, setSex] = useState<Sex>(2);
  const races = roster.races.filter((type) => !roster.isGenderless(type));
  return (
    <form className={ROW_LINE} onSubmit={(event) => { event.preventDefault(); if (race) onAdd(race, sex); }}>
      <select aria-label={words.bodyType} value={race} onChange={(event) => setRace(event.target.value)}
        className="border-input bg-background h-7 rounded-md border px-1">
        <option value="">{words.addBody}</option>
        {races.map((type) => <option key={type} value={type}>{type}</option>)}
      </select>
      <select aria-label={words.bodySex} value={sex} onChange={(event) => setSex(Number(event.target.value) as Sex)}
        className="border-input bg-background h-7 rounded-md border px-1">
        <option value={2}>{words.man}</option>
        <option value={3}>{words.woman}</option>
      </select>
      <LiteButton type="submit" className={ROW_BUTTON} disabled={busy || !race}>{words.add}</LiteButton>
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
  /** Absent when read-only. */
  onPost?: (body: Record<string, unknown>) => void;
}) {
  const words = useUiText().npc;
  if (npc.npcKind !== "creature" || !npc.race || sexOf(npc.gender) === null) return null;
  if (!bodies.length && !onPost) return null;
  const add = onPost ? <AddBody roster={roster} busy={busy} onAdd={(race, sex) => onPost({ action: "add", race, sex })} /> : null;
  if (!bodies.length && onPost) {
    return (
      <div className="mt-1 space-y-1">
        <LiteButton className={ROW_BUTTON} disabled={busy} onClick={() => onPost({ action: "split" })}
          title={words.splitTitle}>
          {words.split}
        </LiteButton>
        {add}
      </div>
    );
  }
  return (
    <div className="mt-1 space-y-1 border-l pl-2">
      {bodies.map((answer) => (
        <div key={`${answer.race}:${answer.sex}`} className={ROW_LINE}>
          <span className="text-muted-foreground w-36 shrink-0">{bodyLabel(answer, words)}</span>
          <SpeakerCell
            key={`${answer.provenance}:${answer.flavor}:${answer.doubtful}`}
            npc={summaryFromBody(npc, answer, roster)}
            roster={roster}
            edits={edits}
            readOnly={!onPost}
            busy={busy}
            lockType
            onSave={(next) => onPost?.({ race: answer.race, sex: answer.sex, flavor: next.flavor ?? answer.flavor, doubtful: next.doubtful ?? false })}
          />
          {onPost ? (
            <LiteButton className={ROW_BUTTON} disabled={busy} onClick={() => onPost({ action: "remove", race: answer.race, sex: answer.sex })}
              title={words.removeBodyTitle}>
              {words.remove}
            </LiteButton>
          ) : null}
        </div>
      ))}
      {add}
      {onPost ? (
        <LiteButton className={ROW_BUTTON} disabled={busy} onClick={() => onPost({ action: "unsplit" })}
          title={words.unsplitTitle}>
          {words.unsplit}
        </LiteButton>
      ) : null}
    </div>
  );
}

export default function NpcEditor({
  initial,
  roster: rosterData,
  readOnly,
  ownDirections,
}: {
  /**
   * Each with the client family whose guess filed it, null for one only the extract names, its
   * bodies where it is split by body, its global direction and the page language's own.
   */
  initial: (NpcSummary & {
    client: ClientFamily | null;
    bodies: NpcBodyAnswer[];
    direction: string | null;
    languageDirection: string | null;
  })[];
  /** The roster, for SpeakerCell's pickers, and grown by their "New" entries. */
  roster: RosterData;
  /** No controls but the language's own directions: who an NPC is is the admin's to answer. */
  readOnly: boolean;
  /** Whether to show and set the page language's own directions. */
  ownDirections: boolean;
}) {
  const lang = useLang();
  const t = useUiText();
  const words = t.npc;
  const language = langName(lang);
  const languageDirectionLabel = fill(words.languageDirectionLabel, { lang: language });
  const languageDirectionTitle = fill(words.languageDirectionTitle, { lang: language });
  const speakerChips = useMemo(() => provenanceOptions(words), [words]);
  const progressChips = useMemo(() => PROGRESS_CHIP_OPTIONS(words), [words]);
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
  /** Each direction this session saved, over the server's, keyed by directionKey. */
  const [savedDirections, setSavedDirections] = useState<Record<string, string | null>>({});
  const initialDirections = useMemo(
    () =>
      new Map(
        initial.flatMap((row) => {
          const k = key(row.npcKind, row.npcId);
          return [
            [directionKey(k, false), row.direction],
            [directionKey(k, true), row.languageDirection],
          ] as const;
        }),
      ),
    [initial],
  );
  const directionOf = (k: string, inLanguage: boolean) => {
    const dk = directionKey(k, inLanguage);
    return dk in savedDirections ? savedDirections[dk] : (initialDirections.get(dk) ?? null);
  };
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

  const postDirection = useCallback(
    async (npc: NpcSummary, direction: string, inLanguage: boolean): Promise<string | null> => {
      const k = key(npc.npcKind, npc.npcId);
      setBusy(k);
      const url = inLanguage ? `/api/npcs/language-direction?lang=${lang}` : "/api/npcs/direction";
      const response = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ direction, npcKind: npc.npcKind, npcId: npc.npcId }),
      }).catch(() => null);
      setBusy(null);
      const saved = (await response?.json().catch(() => null)) as { direction?: string | null; error?: string } | null;
      if (!response?.ok) return saved?.error ?? words.failed;
      setSavedDirections((current) => ({ ...current, [directionKey(k, inLanguage)]: saved?.direction ?? null }));
      return null;
    },
    [lang, words.failed],
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
        fill(words.savedOf, { saved: npcs.length - refused.length, all: npcs.length }) +
          (doubtful ? words.asDoubtful : "") +
          (refused.length > 0 ? fill(words.failedLeft, { n: refused.length }) : "."),
      );
    },
    [post, words],
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
          placeholder={words.searchPlaceholder}
          value={query}
          onChange={(event) => setParam("q", event.target.value)}
          className="h-8 max-w-xs text-sm"
        />
        <FilterChip
          label={words.speaker}
          value={provenance}
          options={speakerChips}
          onChange={(next) => setParam("speaker", next)}
        />
        <FilterChip
          label={words.progressLabel}
          value={progress}
          options={progressChips}
          onChange={(next) => setParam("progress", next)}
        />
        <FilterChip label={words.type} value={type} options={typeOptions} onChange={(next) => setParam("type", next)} />
        <FilterChip label={words.voice} value={voice} options={voiceOptions} onChange={(next) => setParam("voice", next)} />
        <span className="text-muted-foreground text-xs">
          {fill(words.shownOf, { n: rows.length, all: initial.length })}
        </span>
        <ClientSelect
          value={client}
          onChange={(next) => setParam("client", next === DEFAULT_CLIENT_FILTER ? undefined : next)}
        />
      </div>

      {rows.length > 0 && !readOnly ? (
        <div className="mb-3 flex min-h-8 flex-wrap items-center gap-2 text-xs">
          {bulk ? (
            <span className="text-muted-foreground">
              {fill(bulk.doubtful ? words.savingDoubtful : words.saving, {
                done: bulk.done,
                total: bulk.total,
              })}
            </span>
          ) : (
            <>
              {selectedRows.length > 0 ? (
                <>
                  <span className="text-muted-foreground">{fill(words.selected, { n: selectedRows.length })}</span>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={savable.length === 0}
                    onClick={() => void saveMany(savable, false)}
                  >
                    {fill(words.saveCount, { n: savable.length })}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={savable.length === 0}
                    onClick={() => void saveMany(savable, true)}
                  >
                    {fill(words.saveDoubtfulCount, { n: savable.length })}
                  </Button>
                  {savable.length < selectedRows.length ? (
                    <span className="text-muted-foreground">
                      {fill(words.skipped, { n: selectedRows.length - savable.length })}
                    </span>
                  ) : null}
                  <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>
                    {words.clear}
                  </Button>
                </>
              ) : (
                <span className="text-muted-foreground">{words.tickRows}</span>
              )}
              {bulkOutcome ? <span className="text-muted-foreground ml-2">{bulkOutcome}</span> : null}
            </>
          )}
        </div>
      ) : null}

      {rows.length === 0 ? (
        <p className="text-muted-foreground text-sm">{words.nothing}</p>
      ) : (
        <table className="w-fit border-separate border-spacing-0 text-sm">
          <thead className="text-muted-foreground text-left text-xs">
            <tr>
              {readOnly ? null : (
                <th className="border-b py-2 pr-2 align-middle font-normal">
                  <Checkbox
                    aria-label={words.selectAll}
                    checked={allTicked ? true : selectedRows.length > 0 ? "indeterminate" : false}
                    disabled={bulk !== null}
                    onCheckedChange={(on) =>
                      setSelected(on === true ? new Set(shown.map((npc) => key(npc.npcKind, npc.npcId))) : new Set())
                    }
                  />
                </th>
              )}
              <SortHeader column="id" sort={sort} onSort={(column) => setParam("sort", sortParam(nextSort(sort, column)))}>
                {words.columnId}
              </SortHeader>
              <SortHeader column="name" sort={sort} onSort={(column) => setParam("sort", sortParam(nextSort(sort, column)))}>
                {words.columnName}
              </SortHeader>
              <th className="border-b py-2 pr-3 font-normal">{words.columnSpeaker}</th>
              <th className="border-b py-2 pr-3 font-normal">{words.columnDirection}</th>
              {ownDirections ? (
                <th className="border-b py-2 pr-3 font-normal">{fill(words.columnLanguageDirection, { lang: language })}</th>
              ) : null}
              <th className="border-b py-2 font-normal" />
            </tr>
          </thead>
          <tbody>
            {shown.map((npc) => {
              const k = key(npc.npcKind, npc.npcId);
              return (
                <tr key={k} className="align-middle [&>td]:border-b [&>td]:py-1.5 [&>td]:leading-5">
                  {readOnly ? null : (
                    <td className="pr-2">
                      <Checkbox
                        aria-label={fill(words.selectFor, { id: npc.npcId })}
                        checked={selected.has(k)}
                        disabled={bulk !== null}
                        onCheckedChange={(on) => toggle(k, on === true)}
                      />
                    </td>
                  )}
                  <td className="pr-3 text-xs whitespace-nowrap">
                    <span className="font-mono">{npc.npcId}</span>
                    {npc.npcKind === "gameobject" ? (
                      <span className="text-muted-foreground">{words.object}</span>
                    ) : null}{" "}
                    <a
                      href={wowheadEntityUrl(lang, npc.npcKind ?? "creature", npc.npcId)}
                      target="_blank"
                      rel="noreferrer"
                      title={words.wowhead}
                      className="text-muted-foreground hover:underline"
                    >
                      wh↗
                    </a>
                  </td>
                  <td className="pr-3 text-xs">
                    <NameCell
                      key={npc.npcName ?? ""}
                      name={npc.npcName}
                      readOnly={readOnly}
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
                      readOnly={readOnly}
                      busy={busy === k || bulk !== null}
                      onSave={(answer) => void save(npc, answer)}
                    />
                    <BodyCells
                      npc={npc}
                      bodies={savedBodies[k] ?? initialBodies.get(k) ?? []}
                      roster={roster}
                      edits={edits}
                      busy={busy === k || bulk !== null}
                      onPost={readOnly ? undefined : (body) => void postBody(npc, body)}
                    />
                    {failed === k ? (
                      <p className="text-destructive mt-1">{words.failed}</p>
                    ) : null}
                  </td>
                  <td className="pr-3 text-xs">
                    <DirectionCell
                      direction={directionOf(k, false)}
                      busy={busy === k || bulk !== null}
                      label={words.directionLabel}
                      title={words.directionAdd}
                      onSave={readOnly ? undefined : (direction) => postDirection(npc, direction, false)}
                    />
                  </td>
                  {ownDirections ? (
                    <td className="pr-3 text-xs">
                      <DirectionCell
                        direction={directionOf(k, true)}
                        busy={busy === k || bulk !== null}
                        label={languageDirectionLabel}
                        title={languageDirectionTitle}
                        onSave={(direction) => postDirection(npc, direction, true)}
                      />
                    </td>
                  ) : null}
                  <td className="text-right whitespace-nowrap">
                    {lookups(npc.npcId, client, words).map(({ label, path, where }) => (
                      <a
                        key={label}
                        href={localeHref(lang, path)}
                        title={fill(words.findLines, { where })}
                        aria-label={fill(words.findIn, { name: npc.npcName ?? npc.npcId, where })}
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
