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
import { LiteButton } from "@/components/LiteControls";
import { useLang } from "@/components/LangProvider";
import SpeakerCell, { type SpeakerAnswer } from "@/components/SpeakerCell";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import Pagination from "@/components/Pagination";
import { summaryFromResolution } from "@/lib/contributions/speaker";
import { Roster, type RosterData } from "@/lib/voices/roster";
import type { NpcSummary } from "@/lib/contributions/triage";
import { localeHref } from "@/lib/lang";
import { isProvenance, PROVENANCES, type NpcRowKind, type Provenance } from "@/lib/npc/npc";
import type { NpcResolution } from "@/lib/npc/store";
import { wowheadEntityUrl, wowheadForeverUrl } from "@/lib/wowhead";

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
 * Whether this NPC's voice still has a blank to fill: race, gender, or a flavor its race and
 * gender offer. A confirmed row with every field null is settled rather than blank -- someone
 * decided it has no race (see SpeakerCell's speakerNote) -- so it counts as finished.
 */
function unfinished(npc: NpcSummary): boolean {
  if (npc.confirmed && !npc.race && !npc.gender && !npc.flavor) return false;
  return !npc.race || !npc.gender || (npc.flavorOptions.length > 0 && !npc.flavor);
}

/**
 * Where an NPC stands for the progress filter. A blank outranks a doubt, being the more
 * pressing thing to fill, and "finished" means neither.
 */
function progressOf(npc: NpcSummary): Progress {
  if (unfinished(npc)) return "unfinished";
  return npc.doubtful ? "doubtful" : "finished";
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
      <div className="flex items-center gap-1">
        <span>{name ?? <span className="text-muted-foreground">unnamed</span>}</span>
        <LiteButton variant="ghost" className="h-5 px-1.5 py-0 text-xs" onClick={() => setDraft(name ?? "")}>
          Edit
        </LiteButton>
      </div>
    );
  }
  const trimmed = draft.trim();
  return (
    <form
      className="flex items-center gap-1"
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
      <LiteButton type="submit" variant="outline" className="h-7 px-2 text-xs" disabled={busy || !trimmed}>
        Save
      </LiteButton>
    </form>
  );
}

export default function NpcEditor({
  initial,
  roster: rosterData,
}: {
  initial: NpcSummary[];
  /** The roster, for SpeakerCell's selects. */
  roster: RosterData;
}) {
  const lang = useLang();
  const roster = useMemo(() => new Roster(rosterData), [rosterData]);
  const pathname = usePathname();
  const params = useSearchParams();
  // The filters live in the URL, so a reload or a shared link keeps the view. Written with
  // history.replaceState rather than router.replace, for zones/Explorer.tsx's reason: the rows
  // are all here already, and Next re-renders useSearchParams() from a native history call.
  const query = params.get("q") ?? "";
  const speakerParam = params.get("speaker");
  const provenance = isProvenance(speakerParam) ? speakerParam : undefined;
  const progressParam = params.get("progress");
  const progress = isProgress(progressParam) ? progressParam : undefined;
  const setParam = useCallback(
    (name: string, value: string | undefined) => {
      const search = new URLSearchParams(params.toString());
      if (value) search.set(name, value);
      else search.delete(name);
      // A narrower view starts again from its first page: the one it was on may not exist.
      if (name !== "page") search.delete("page");
      const next = search.toString();
      window.history.replaceState(null, "", next ? `${pathname}?${next}` : pathname);
    },
    [params, pathname],
  );
  /** What this session saved, over the server's rows, keyed by NPC. */
  const [saved, setSaved] = useState<Record<string, NpcSummary>>({});
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
      .map((npc) => saved[key(npc.npcKind, npc.npcId)] ?? npc)
      .filter(
        (npc) =>
          !needle || String(npc.npcId).includes(needle) || (npc.npcName ?? "").toLowerCase().includes(needle),
      )
      .filter((npc) => !provenance || npc.provenance === provenance)
      .filter((npc) => !progress || progressOf(npc) === progress);
  }, [initial, saved, query, provenance, progress]);

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
  const savable = selectedRows.filter((npc) => npc.race && npc.gender);
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
        <span className="text-muted-foreground text-xs">
          {rows.length} of {initial.length}
        </span>
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
        <table className="w-full border-separate border-spacing-0 text-sm">
          <thead className="text-muted-foreground text-left text-xs">
            <tr>
              <th className="border-b py-2 pr-2 font-normal">
                <Checkbox
                  aria-label="Select every NPC shown"
                  checked={allTicked ? true : selectedRows.length > 0 ? "indeterminate" : false}
                  disabled={bulk !== null}
                  onCheckedChange={(on) =>
                    setSelected(on === true ? new Set(shown.map((npc) => key(npc.npcKind, npc.npcId))) : new Set())
                  }
                />
              </th>
              <th className="border-b py-2 pr-3 font-normal">ID</th>
              <th className="border-b py-2 pr-3 font-normal">Name</th>
              <th className="border-b py-2 pr-3 font-normal">Race / gender / flavor</th>
              <th className="border-b py-2 font-normal" />
            </tr>
          </thead>
          <tbody>
            {shown.map((npc) => {
              const k = key(npc.npcKind, npc.npcId);
              return (
                <tr key={k} className="align-top [&>td]:border-b [&>td]:py-2 [&>td]:leading-5">
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
                    {/* Both branches: a vanilla NPC is on each, a post-vanilla one only on
                        /forever/ -- see wowhead.ts. */}
                    <a
                      href={wowheadEntityUrl(npc.npcKind ?? "creature", npc.npcId)}
                      target="_blank"
                      rel="noreferrer"
                      title="Wowhead Classic"
                      className="text-muted-foreground hover:underline"
                    >
                      wc↗
                    </a>{" "}
                    <a
                      href={wowheadForeverUrl(npc.npcKind ?? "creature", npc.npcId)}
                      target="_blank"
                      rel="noreferrer"
                      title="Wowhead Anniversary"
                      className="text-muted-foreground hover:underline"
                    >
                      wf↗
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
                      roster={rosterData}
                      readOnly={false}
                      busy={busy === k || bulk !== null}
                      onSave={(answer) => void save(npc, answer)}
                    />
                    {failed === k ? (
                      <p className="text-destructive mt-1">That didn&apos;t go through -- try again.</p>
                    ) : null}
                  </td>
                  <td className="text-right">
                    <a
                      href={localeHref(lang, `/quests?q=${npc.npcId}&filter=npc`)}
                      title="Find this NPC's lines in the quests explorer"
                      aria-label={`Find ${npc.npcName ?? npc.npcId} in the quests explorer`}
                      className="text-muted-foreground hover:text-foreground inline-flex p-1"
                    >
                      <SearchIcon className="size-4" />
                    </a>
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
