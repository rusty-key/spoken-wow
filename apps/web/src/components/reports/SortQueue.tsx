"use client";

/**
 * The sorting queue: one line with open reports at a time, everything needed to decide on
 * it, and the three answers pinned under the thumb.
 *
 * Walks the list the server sorted without navigating, so answering a card costs one
 * request and no page load, and the next card's line is fetched while this one is read.
 */
import { ArrowLeft, Pause, Pencil, Play, RefreshCw, Undo2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

import { useLang } from "@/components/LangProvider";
import { ACCEPT_TONE, LiteButton, REJECT_TONE } from "@/components/LiteControls";
import Link from "@/components/LocaleLink";
import OverrideDialog from "@/components/OverrideDialog";
import OutdatedNote from "@/components/OutdatedNote";
import LineHeading from "@/components/reports/LineHeading";
import QuestsPlayer from "@/components/Player";
import TakeSelector from "@/components/TakeSelector";
import { lineTextSubject, TranslateDialog } from "@/components/TranslateDialog";
import { PageTextDialog } from "@/components/readables/PageTextDialog";
import { Player as ReadablesPlayer } from "@/components/readables/Player";
import { ReportContextNote } from "@/components/reports/ReportContextFacts";
import { Button } from "@/components/ui/button";
import { LoreDialog } from "@/components/places/LoreDialog";
import { Player as PlacesPlayer } from "@/components/places/Player";
import type { ResultLine as BookLine } from "@/lib/readables/search";
import { isTypingTarget } from "@/lib/keyboard";
import { BASE_LANG, withLang, type Lang } from "@/lib/lang";
import { explorerHref } from "@/lib/links";
import { resolveReport } from "@/lib/reports/client";
import { detailOf, fileOf, regenerateLine, searchPath, type SourceLine } from "@/lib/reports/detail";
import { CATEGORY_COLUMN, SOURCE_LABELS, STATUS_LABELS, type Report, type Status } from "@/lib/reports/reports";
import type { ReportGroup } from "@/lib/reports/rows";
import type { ResultLine as QuestLine } from "@/lib/search";
import type { Source } from "@/lib/sections";
import { cn, endsSelection } from "@/lib/utils";
import type { ResultLine as ZoneLine } from "@/lib/places/search";
import type { ResultLine as BossLine } from "@/lib/bosses/search";
import { placesSection } from "@/components/places/sections";
import { bossesSection } from "@/components/bosses/sections";

// No facets: the card shows one line, with nothing to narrow.
const PLACES = placesSection();
const BOSSES = bossesSection();

/** Enough to read a typical complaint whole without pushing the actions off a phone screen. */
const PREVIEW = 3;
/** Longer than this and the line's text is clamped until the card is expanded. */
const LONG_TEXT = 280;

type Answer = Exclude<Status, "open"> | "skip";
type Busy = Answer | "regenerate" | null;

/** The completion row, left to right, with each answer's key. */
const ANSWERS: { answer: Answer; label: string; done: string; busy: string; key: string; tone?: string }[] = [
  { answer: "fixed", label: STATUS_LABELS.fixed, done: STATUS_LABELS.fixed, busy: "Saving…", key: "f", tone: ACCEPT_TONE },
  {
    answer: "not_an_issue",
    label: STATUS_LABELS.not_an_issue,
    done: STATUS_LABELS.not_an_issue,
    busy: "Saving…",
    key: "n",
    tone: REJECT_TONE,
  },
  { answer: "minor", label: STATUS_LABELS.minor, done: STATUS_LABELS.minor, busy: "Saving…", key: "m" },
  { answer: "skip", label: "Skip", done: "Skipped", busy: "Skipping…", key: "s" },
];

/** A line not fetched yet is absent; null is a line the corpus no longer has. */
type Looked = SourceLine | null | "error";

function ago(at: string): string {
  const minutes = Math.round((Date.now() - Date.parse(at)) / 60_000);
  if (minutes < 60) return `${Math.max(minutes, 1)}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

/** Resolving a report already resolved is allowed, which is what lets Previous change an answer. */
async function failedToSet(reports: Report[], status: Status): Promise<number> {
  const results = await Promise.all(reports.map((report) => resolveReport(report.id, status)));
  return results.filter((report) => report === null).length;
}

export default function SortQueue({
  source,
  groups: initial,
  canRegenerate,
  canEditText,
  showNpcPage,
}: {
  source: Source;
  /** The queue as the server sorted it, open reports only, skipped lines already left out. */
  groups: ReportGroup[];
  canRegenerate: boolean;
  canEditText: boolean;
  /** Whether the speaker's name opens the NPC page. See LineHeading. */
  showNpcPage: boolean;
}) {
  const lang = useLang();
  // Held from the first render: a refresh while sorting brings back a list without the lines
  // already answered, and the position would then point past the card on screen.
  const [groups] = useState(initial);
  const [index, setIndex] = useState(0);
  /** What was answered on each card this visit, by position, so Previous can show and change it. */
  const [answers, setAnswers] = useState<Record<number, Answer>>({});
  const [lines, setLines] = useState<Record<string, Looked>>({});
  /** Takes written here, so the player plays the new one rather than the browser's cache. */
  const [versions, setVersions] = useState<Record<string, number>>({});
  const [busy, setBusy] = useState<Busy>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  /** Everything on the card unclamped: the line's whole text and every report in full. */
  const [expanded, setExpanded] = useState(false);
  const [playing, setPlaying] = useState(false);
  const audio = useRef<HTMLAudioElement>(null);
  /** Lines asked for, so a re-render while one is in flight does not ask again. */
  const requested = useRef(new Set<string>());
  /** Set by a regeneration: play the new take as soon as its line is back. */
  const playWhenReady = useRef(false);

  const group = groups[index] as ReportGroup | undefined;
  const lineId = group?.reports[0].lineId ?? null;
  const looked = lineId === null ? undefined : lines[lineId];
  const line = looked && looked !== "error" ? looked : null;
  // The take this session made or restored, else the live one: either way a cache buster, since
  // a new take keeps its path and the browser would replay the one it replaced.
  const version = line ? (versions[lineId!] ?? line.take?.version) : undefined;
  const detail = line ? detailOf(source, line, version, lang) : null;
  const answer = answers[index];

  const load = useCallback(
    async (id: string) => {
      requested.current.add(id);
      const response = await fetch(searchPath(source, id, lang)).catch(() => null);
      const body = response?.ok
        ? ((await response.json().catch(() => null)) as { lines?: SourceLine[] } | null)
        : null;
      setLines((current) => ({ ...current, [id]: body ? (body.lines?.[0] ?? null) : "error" }));
    },
    [source, lang],
  );

  useEffect(() => {
    for (const next of groups.slice(index, index + 2)) {
      const id = next.reports[0].lineId;
      if (id && !requested.current.has(id)) void load(id);
    }
  }, [groups, index, load]);

  useEffect(() => {
    if (!playWhenReady.current || !detail?.audioSrc) return;
    playWhenReady.current = false;
    void audio.current?.play().catch(() => {});
  }, [detail?.audioSrc]);

  function goTo(next: number) {
    audio.current?.pause();
    playWhenReady.current = false;
    setIndex(next);
    setError(null);
    setNotice(null);
    setEditing(false);
    setExpanded(false);
    setPlaying(false);
  }

  async function give(next: Answer) {
    if (!group || busy) return;
    if (answer === next) return goTo(index + 1);
    setBusy(next);
    setError(null);
    const problem = next === "skip" ? await skip(group) : await resolve(group, next);
    setBusy(null);
    if (problem) return setError(problem);
    setAnswers((current) => ({ ...current, [index]: next }));
    goTo(index + 1);
  }

  async function resolve(current: ReportGroup, status: Exclude<Status, "open">): Promise<string | null> {
    const failed = await failedToSet(current.reports, status);
    return failed ? `${failed} of ${current.reports.length} didn't save. Try again.` : null;
  }

  async function skip(current: ReportGroup): Promise<string | null> {
    // A line answered earlier is reopened first: only open reports can be skipped, and a
    // skipped line is one still waiting for somebody.
    if (answer && (await failedToSet(current.reports, "open"))) return "Couldn't reopen the reports. Try again.";
    const response = await fetch(withLang(lang, "/api/reports/skip"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ids: current.reports.map((report) => report.id) }),
    }).catch(() => null);
    return response?.ok ? null : "Couldn't skip. Try again.";
  }

  async function regenerate() {
    if (!lineId || busy) return;
    setBusy("regenerate");
    setError(null);
    setNotice(null);
    const result = await regenerateLine(source, lineId, lang);
    setBusy(null);
    if ("error" in result) return setError(`Regenerate failed: ${result.error}`);

    setVersions((current) => ({ ...current, [lineId]: result.version }));
    setNotice("New take saved.");
    playWhenReady.current = true;
    // Refetched rather than patched: a line that had no take until now only gains its audio
    // path from the search.
    void load(lineId);
  }

  function togglePlay() {
    const element = audio.current;
    if (!element || !detail?.audioSrc) return;
    if (element.paused) void element.play().catch(() => {});
    else element.pause();
  }

  function previous() {
    if (index > 0 && !busy) goTo(index - 1);
  }

  const canEdit = canEditText && line !== null;
  // An unwritten boss has nothing to voice, and the server would refuse it.
  const canRegenerateLine = canRegenerate && line !== null && detail?.text !== null;

  const keys: Record<string, () => void> = {
    " ": togglePlay,
    e: () => canEdit && !busy && setEditing(true),
    r: () => canRegenerateLine && void regenerate(),
    x: () => setExpanded((current) => !current),
    p: previous,
    ...Object.fromEntries(ANSWERS.map((each) => [each.key, () => void give(each.answer)])),
  };
  // Read through a ref so the listener, added once, always calls this render's handlers.
  const keysRef = useRef(keys);
  keysRef.current = keys;

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.metaKey || event.ctrlKey || event.altKey || isTypingTarget(event.target)) return;
      // A dialog is portalled outside the focused element's tree, so it is checked for here too.
      if (document.querySelector('[role="dialog"]')) return;
      const act = keysRef.current[event.key];
      if (!act) return;
      if (event.key === " ") event.preventDefault();
      act();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const previousButton = (
    <Button
      variant="ghost"
      size="sm"
      onClick={previous}
      disabled={index === 0 || busy !== null}
      title="Go back to the last line and change its answer"
    >
      <Undo2 />
      Previous
      <Hint>[P]</Hint>
    </Button>
  );

  if (!group) {
    return (
      <main className="mx-auto flex max-w-xl flex-col items-center px-4 pt-16 pb-24 text-center">
        <p className="text-2xl font-semibold">All sorted</p>
        <p className="text-muted-foreground mt-2 text-sm">
          No open {SOURCE_LABELS[source].toLowerCase()} reports left in your queue.
        </p>
        <div className="mt-6 flex items-center gap-4 text-sm">
          {index > 0 ? previousButton : null}
          <Link href="/reports/sort" className="underline underline-offset-2">
            Back to sections
          </Link>
        </div>
      </main>
    );
  }

  const total = groups.length;
  const reports = expanded ? group.reports : group.reports.slice(0, PREVIEW);
  const text = detail?.text ?? "";
  const unwritten = detail !== null && detail.text === null;

  return (
    <main className="mx-auto flex max-w-xl flex-col gap-4 px-4 pt-4 pb-56">
      <header className="flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <Link href="/reports/sort" aria-label="Back to sections" className="hover:bg-muted -ml-2 rounded-md p-2">
            <ArrowLeft className="size-5" />
          </Link>
          <span className="flex-1 font-medium">{SOURCE_LABELS[source]}</span>
          {previousButton}
          <span className="text-muted-foreground text-sm tabular-nums">
            {index + 1} / {total}
          </span>
        </div>
        <div className="bg-muted h-1 overflow-hidden rounded-full">
          <div className="bg-primary-ink h-full transition-[width]" style={{ width: `${(index / total) * 100}%` }} />
        </div>
      </header>

      {answer ? (
        <p className="bg-muted rounded-lg px-3 py-2 text-sm">
          Answered <span className="font-medium">{ANSWERS.find((each) => each.answer === answer)!.done}</span>.
          Pick another answer below to change it.
        </p>
      ) : null}

      <section className="bg-card flex flex-col gap-2 rounded-xl border p-4">
        {lineId === null ? (
          <>
            <p className="font-medium">{group.reports[0].target ? "No line picked" : "About the project"}</p>
            {group.reports[0].target ? (
              <p className="text-muted-foreground font-mono text-xs break-all">{group.reports[0].target}</p>
            ) : null}
          </>
        ) : looked === undefined ? (
          <p className="text-muted-foreground text-sm">Looking up the line…</p>
        ) : looked === "error" ? (
          <p className="text-sm">
            Couldn&apos;t load the line.{" "}
            <button type="button" className="underline underline-offset-2" onClick={() => void load(lineId)}>
              Retry
            </button>
          </p>
        ) : line === null || detail === null ? (
          <p className="text-muted-foreground text-sm">
            No line in the corpus carries <span className="font-mono">{lineId}</span> any more.
          </p>
        ) : (
          <>
            <div className="flex flex-col">
              <LineHeading
                detail={detail}
                showNpcPage={showNpcPage}
                className="leading-snug"
                asideClassName="mt-0.5"
              />
            </div>
            {/* The text is the expand control, as each report below is: [X] does the same from
                the keyboard. */}
            {unwritten ? (
              <p className="text-muted-foreground text-sm italic">No story in this language yet.</p>
            ) : (
              <p
                className={cn(
                  "cursor-pointer text-sm whitespace-pre-wrap",
                  !expanded && text.length > LONG_TEXT && "line-clamp-5",
                )}
                aria-expanded={expanded}
                onClick={() => !endsSelection() && setExpanded(!expanded)}
              >
                {text}
              </p>
            )}
            <div className="text-muted-foreground flex items-center gap-3 text-xs">
              <Link href={explorerHref(source, lineId)} className="font-mono underline-offset-2 hover:underline">
                {lineId}
              </Link>
              <TakeSelector
                source={source}
                file={fileOf(source, line)}
                version={version ?? null}
                takes={line.take?.takes ?? 0}
                canRestore={canRegenerate}
                onRestored={(restored) => {
                  setVersions((current) => ({ ...current, [lineId]: restored }));
                  void load(lineId);
                }}
              />
              {detail.stale ? <OutdatedNote /> : null}
            </div>
          </>
        )}

        <div className="mt-1 grid grid-cols-3 gap-2">
          <Button variant="outline" className="h-11" disabled={!detail?.audioSrc} onClick={togglePlay}>
            {playing ? <Pause /> : <Play />}
            {playing ? "Pause" : "Play"}
            <Hint>[Space]</Hint>
          </Button>
          <Button
            variant="outline"
            className="h-11"
            disabled={!canEdit || busy !== null}
            onClick={() => setEditing(true)}
          >
            <Pencil />
            Edit
            <Hint>[E]</Hint>
          </Button>
          <Button
            variant="outline"
            className="h-11"
            disabled={!canRegenerateLine || busy !== null}
            onClick={() => void regenerate()}
            title={
              !canRegenerate
                ? "You can't regenerate in this language"
                : unwritten
                  ? "No story in this language to voice"
                  : "Regenerate this line"
            }
          >
            <RefreshCw className={cn(busy === "regenerate" && "animate-spin")} />
            {busy === "regenerate" ? "Working…" : "Regenerate"}
            <Hint>[R]</Hint>
          </Button>
        </div>
        {detail && !detail.audioSrc ? <p className="text-muted-foreground text-xs">No audio on file.</p> : null}
        {notice ? <p className="text-xs text-emerald-500">{notice}</p> : null}
      </section>

      <section className="flex flex-col gap-2">
        <p className="text-sm font-medium">
          {group.reports.length} {group.reports.length === 1 ? "report" : "reports"}
        </p>
        {reports.map((report) => (
          <ReportPreview key={report.id} report={report} expanded={expanded} />
        ))}
        {!expanded && group.reports.length > PREVIEW ? (
          <button
            type="button"
            className="text-muted-foreground self-start text-sm underline underline-offset-2"
            onClick={() => setExpanded(true)}
          >
            {group.reports.length - PREVIEW} more
          </button>
        ) : null}
      </section>

      {error ? <p className="text-destructive text-sm">{error}</p> : null}

      {/* Media events reach React handlers on ancestors, so the Play button mirrors the
          player's element from here without a listener of its own. */}
      <nav
        className="bg-background/95 fixed inset-x-0 bottom-0 z-20 backdrop-blur"
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
      >
        {/* The explorers' transport, for scrubbing through the line and downloading it. */}
        <SourcePlayer source={source} line={detail?.audioSrc ? line : null} version={version} audio={audio} />
        <div className="mx-auto grid max-w-xl grid-cols-3 gap-2 px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
          {ANSWERS.map((each) => (
            <LiteButton
              key={each.answer}
              className={cn(
                "h-12 justify-center gap-1.5 text-sm",
                each.tone,
                answer === each.answer && "ring-foreground/60 ring-2",
              )}
              disabled={busy !== null}
              onClick={() => void give(each.answer)}
            >
              {busy === each.answer ? each.busy : each.label}
              <Hint>[{each.key.toUpperCase()}]</Hint>
            </LiteButton>
          ))}
        </div>
      </nav>

      {editing && line && lineId ? (
        <EditDialog
          source={source}
          lang={lang}
          line={line}
          onClose={() => setEditing(false)}
          onSaved={() => void load(lineId)}
        />
      ) : null}
    </main>
  );
}

function SourcePlayer({
  source,
  line,
  version,
  audio,
}: {
  source: Source;
  line: SourceLine | null;
  version: number | undefined;
  audio: React.RefObject<HTMLAudioElement | null>;
}) {
  if (source === "quests") return <QuestsPlayer ref={audio} line={line as QuestLine | null} version={version} />;
  if (source === "places") {
    return <PlacesPlayer section={PLACES} audioRef={audio} line={line as ZoneLine | null} version={version} />;
  }
  if (source === "bosses") {
    return <PlacesPlayer section={BOSSES} audioRef={audio} line={line as BossLine | null} version={version} />;
  }
  return <ReadablesPlayer audioRef={audio} line={line as BookLine | null} version={version} />;
}

/** Each section's own editor: English quest text is an override, other quest text a translation. */
function EditDialog({
  source,
  lang,
  line,
  onClose,
  onSaved,
}: {
  source: Source;
  lang: Lang;
  line: SourceLine;
  onClose: () => void;
  onSaved: () => void;
}) {
  if (source === "places") {
    return <LoreDialog section={PLACES} line={line as ZoneLine} onClose={onClose} onSaved={onSaved} />;
  }
  if (source === "bosses") {
    return <LoreDialog section={BOSSES} line={line as BossLine} onClose={onClose} onSaved={onSaved} />;
  }
  if (source === "readables") return <PageTextDialog line={line as BookLine} onClose={onClose} onSaved={onSaved} />;
  if (lang !== BASE_LANG) {
    return <TranslateDialog subject={lineTextSubject(line as QuestLine)} onClose={onClose} onSaved={onSaved} />;
  }
  const done = () => {
    onClose();
    onSaved();
  };
  return (
    <OverrideDialog
      line={line as QuestLine}
      onSaved={done}
      // A `$G` text went to the moment's lines; this one's text changed with them.
      onRewritten={done}
      onCancel={onClose}
    />
  );
}

/** Only where there is a keyboard to press it with: a phone has no use for the hint. */
function Hint({ children }: { children: ReactNode }) {
  return <span className="hidden opacity-60 pointer-fine:inline">{children}</span>;
}

/** Never shows the reporter's email or address: who they are is not what triage weighs. */
function ReportPreview({ report, expanded }: { report: Report; expanded: boolean }) {
  const [opened, setOpened] = useState(false);
  return (
    <article className="bg-card cursor-pointer rounded-lg border px-3 py-2.5" onClick={() => !endsSelection() && setOpened(!opened)}>
      <div className="text-muted-foreground flex items-center gap-2 text-xs">
        <span className="bg-muted text-foreground rounded px-1.5 py-0.5 font-medium">
          {CATEGORY_COLUMN[report.category]}
        </span>
        <span className="truncate">{report.name ?? "anonymous"}</span>
        <span className="ml-auto shrink-0">{ago(report.createdAt)}</span>
      </div>
      <p
        className={cn(
          "mt-1.5 text-sm break-words whitespace-pre-wrap",
          !expanded && !opened && "line-clamp-3",
        )}
      >
        {report.body}
      </p>
      <ReportContextNote context={report.context} />
    </article>
  );
}
