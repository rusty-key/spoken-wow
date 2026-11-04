"use client";

import { Pause, Play } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import Avatar from "@/components/Avatar";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useLocalDates } from "@/components/useLocalDates";
import { langName, withLang, type Lang } from "@/lib/lang";
import {
  RELEASE_BUMPS,
  type PendingChange,
  type PendingView,
  type ReleaseBump,
  type ReleaseSection,
} from "@/lib/releases/sections";
import { SOURCE_LABELS } from "@/lib/reports/reports";
import { cn } from "@/lib/utils";

const CLOCK: Intl.DateTimeFormatOptions = { hour: "2-digit", minute: "2-digit" };

const lines = (n: number) => `${n.toLocaleString()} ${n === 1 ? "line" : "lines"}`;

/** "q:123:accept" reads as its moment; ids of the other sections say nothing a reader needs. */
const MOMENTS: Record<string, string> = { accept: "Accept", progress: "Progress", complete: "Complete" };

function momentOf(change: PendingChange): string | null {
  const id = change.lineId ?? "";
  if (id.startsWith("g:")) return "Gossip";
  const moment = /^q:\d+:([a-z]+)/.exec(id)?.[1];
  return moment ? (MOMENTS[moment] ?? moment) : null;
}

/** The version a bump makes of `from`; null when nothing was released from here to count from. */
export function bumped(from: string | null | undefined, bump: ReleaseBump): string | null {
  const parts = from?.split(".").map(Number);
  if (!parts || parts.length !== 3 || parts.some(Number.isNaN)) return null;
  const [major, minor, patch] = parts;
  return bump === "major" ? `${major + 1}.0.0` : bump === "minor" ? `${major}.${minor + 1}.0` : `${major}.${minor}.${patch + 1}`;
}

/** `person` is a user id, null for takes with nobody named, undefined for everyone. */
type Filter = { kind: "all" | "new" | "restored"; person?: string | null; q: string };

/**
 * The step before a release: what goes out, who made it, every line to read and hear, and the
 * version it goes out as. Closing it releases nothing.
 */
export default function ReleaseReview({
  open,
  onOpenChange,
  section,
  lang,
  pending,
  version,
  bumpable,
  onRelease,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  section: ReleaseSection;
  lang: Lang;
  pending: PendingView;
  /**
   * The version the last release from here made, which the preview counts from. An estimate:
   * the release bumps whatever the channel has, and a release from the Manager or a script
   * would have moved that without the site knowing.
   */
  version: string | null | undefined;
  bumpable: boolean;
  onRelease: (bump: ReleaseBump) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {open && (
        <Review
          section={section}
          lang={lang}
          pending={pending}
          version={version}
          bumpable={bumpable}
          onCancel={() => onOpenChange(false)}
          onRelease={(bump) => {
            onOpenChange(false);
            onRelease(bump);
          }}
        />
      )}
    </Dialog>
  );
}

function Review({
  section,
  lang,
  pending: counted,
  version,
  bumpable,
  onCancel,
  onRelease,
}: {
  section: ReleaseSection;
  lang: Lang;
  pending: PendingView;
  version: string | null | undefined;
  bumpable: boolean;
  onCancel: () => void;
  onRelease: (bump: ReleaseBump) => void;
}) {
  const date = useLocalDates();
  // The page's checks carry the counts alone; the lines themselves are asked for here, once.
  const [loaded, setLoaded] = useState<PendingView | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let live = true;
    fetch(`/api/releases?${new URLSearchParams({ lang, section })}`, { cache: "no-store" })
      .then((response) => (response.ok ? (response.json() as Promise<{ pending: PendingView }>) : null))
      .then((body) => live && (body ? setLoaded(body.pending) : setFailed(true)))
      .catch(() => live && setFailed(true));
    return () => {
      live = false;
    };
  }, [lang, section]);
  const pending = loaded ?? counted;
  const [bump, setBump] = useState<ReleaseBump>("patch");
  const [filter, setFilter] = useState<Filter>({ kind: "all", q: "" });
  const [playing, setPlaying] = useState<string | null>(null);
  const audio = useRef<HTMLAudioElement>(null);
  const name = SOURCE_LABELS[section];
  // Without a bump the release keeps the version GitHub's workflow gives it, which nothing here knows.
  const next = bumpable ? bumped(version, bump) : null;
  const created = pending.count - pending.restored;

  const shown = useMemo(() => {
    const needle = filter.q.trim().toLowerCase();
    return pending.changes.filter(
      (change) =>
        (filter.kind === "all" || change.kind === filter.kind) &&
        (filter.person === undefined || change.byId === filter.person) &&
        (!needle || [change.title, change.text, change.lineId].some((field) => field?.toLowerCase().includes(needle))),
    );
  }, [pending.changes, filter]);

  // Consecutive lines of one quest, zone or book under one heading; the list stays newest first.
  const groups = useMemo(() => {
    const out: { title: string; changes: PendingChange[] }[] = [];
    for (const change of shown) {
      const title = change.title ?? "Without text yet";
      const last = out.at(-1);
      if (last && last.title === title) last.changes.push(change);
      else out.push({ title, changes: [change] });
    }
    return out;
  }, [shown]);

  function play(change: PendingChange) {
    const key = `${change.file}:${change.version}`;
    const element = audio.current;
    if (!element) return;
    if (playing === key) {
      element.pause();
      setPlaying(null);
      return;
    }
    element.src = withLang(lang, `/api/takes/audio?${new URLSearchParams({ source: section, file: change.file, version: String(change.version) })}`);
    void element.play().catch(() => setPlaying(null));
    setPlaying(key);
  }

  const chip = (active: boolean) =>
    cn(
      "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs",
      active ? "bg-muted text-foreground border-transparent" : "text-muted-foreground hover:text-foreground",
    );

  return (
    <DialogContent className="grid max-h-[min(52rem,calc(100dvh-2rem))] max-w-[min(50rem,calc(100vw-2rem))] grid-rows-[auto_auto_minmax(0,1fr)_auto] gap-0 overflow-hidden p-0">
      <audio ref={audio} onEnded={() => setPlaying(null)} className="hidden" />
      <header className="pt-4 pr-12 pb-3 pl-5">
        <DialogTitle className="text-lg">
          Release {name} in {langName(lang)}
        </DialogTitle>
        <DialogDescription className="mt-1.5">
          {pending.since ? (
            <>Audio that went live since the last release started, on {date(pending.since)}. </>
          ) : (
            <>Nothing was released from here yet, so this sends every live line. </>
          )}
          Players get it on their next Manager refresh.
        </DialogDescription>
        {pending.count > 0 && (
          <div className="mt-3 grid gap-2 sm:grid-cols-3">
            <Tile highlight value={pending.count.toLocaleString()} label="lines change for players" />
            <Tile
              value={
                <>
                  {created.toLocaleString()} <small className="text-xs font-medium text-emerald-300">new</small>
                  {pending.restored > 0 && (
                    <>
                      {" "}
                      {pending.restored.toLocaleString()} <small className="text-xs font-medium text-sky-300">put back</small>
                    </>
                  )}
                </>
              }
              label={pending.restored > 0 ? "new takes and older versions restored" : "new takes"}
            />
            <Tile
              value={
                <span className="flex gap-1">
                  {pending.people.slice(0, 4).map((person) => (
                    <Avatar key={person.id ?? "nobody"} name={person.name} />
                  ))}
                </span>
              }
              label={pending.people.map((person) => `${person.name ?? "unnamed"} ${person.count}`).join(" · ") || "nobody"}
            />
          </div>
        )}
      </header>

      {pending.count > 0 ? (
        <div className="flex flex-wrap items-center gap-1.5 border-y px-5 py-2.5">
          <button type="button" className={chip(filter.kind === "all")} onClick={() => setFilter({ ...filter, kind: "all" })}>
            All <b className="font-semibold">{pending.count}</b>
          </button>
          <button type="button" className={chip(filter.kind === "new")} onClick={() => setFilter({ ...filter, kind: "new" })}>
            <Kind kind="new" /> <b className="font-semibold">{created}</b>
          </button>
          {pending.restored > 0 && (
            <button
              type="button"
              className={chip(filter.kind === "restored")}
              onClick={() => setFilter({ ...filter, kind: "restored" })}
            >
              <Kind kind="restored" /> <b className="font-semibold">{pending.restored}</b>
            </button>
          )}
          {pending.people.length > 1 &&
            pending.people.map((person) => (
              <button
                key={person.id ?? "nobody"}
                type="button"
                aria-pressed={filter.person === person.id}
                className={chip(filter.person === person.id)}
                onClick={() => setFilter({ ...filter, person: filter.person === person.id ? undefined : person.id })}
              >
                <Avatar name={person.name} small />
                {person.name ?? "unnamed"} <b className="font-semibold">{person.count}</b>
              </button>
            ))}
          <Input
            type="search"
            placeholder="Search title or text"
            aria-label="Search the lines"
            value={filter.q}
            onChange={(event) => setFilter({ ...filter, q: event.target.value })}
            className="ml-auto h-8 w-52 max-w-full"
          />
        </div>
      ) : (
        <div className="border-t" />
      )}

      <div className="min-h-24 overflow-auto">
        {pending.textChanges > 0 && (
          <p className="text-muted-foreground border-b px-5 py-2.5 text-sm">
            {pending.count > 0 ? "Also " : ""}
            <span className="text-foreground font-medium">
              {lines(pending.textChanges)}
            </span>{" "}
            changed in text, name or ignore with no new audio; their text goes out with the release.
          </p>
        )}
        {pending.count === 0 && pending.textChanges === 0 && (
          <p className="text-muted-foreground px-5 py-6 text-sm">
            Nothing counted since the last release. A release now finds out for itself whether anything else
            changed, such as a line folded into another, and releases nothing otherwise.
          </p>
        )}
        {loaded && pending.count > 0 && shown.length === 0 && (
          <p className="text-muted-foreground px-5 py-6 text-sm">No line matches.</p>
        )}
        {groups.map((group, index) => (
          <section key={`${group.title}:${index}`}>
            <h3 className="bg-muted/60 sticky top-0 z-[1] flex justify-between border-b px-5 py-1.5 text-xs font-semibold">
              {group.title}
              <span className="text-muted-foreground font-normal">{lines(group.changes.length)}</span>
            </h3>
            {group.changes.map((change) => {
              const key = `${change.file}:${change.version}`;
              const moment = momentOf(change);
              return (
                <div key={`${key}:${change.kind}`} className="hover:bg-muted/20 grid grid-cols-[2rem_minmax(0,1fr)_auto] items-center gap-3 border-b px-5 py-2.5">
                  <button
                    type="button"
                    onClick={() => play(change)}
                    aria-label={playing === key ? "Pause" : `Play ${change.title ?? change.file}`}
                    className={cn(
                      "bg-muted grid size-7 place-items-center rounded-full border",
                      playing === key ? "border-primary text-primary-ink" : "hover:border-primary hover:text-primary-ink",
                    )}
                  >
                    {playing === key ? <Pause className="size-3" fill="currentColor" /> : <Play className="ml-0.5 size-3" fill="currentColor" />}
                  </button>
                  <div className="min-w-0">
                    <p className="truncate text-sm" title={change.text ?? undefined}>
                      {change.text ? <>“{change.text}”</> : <span className="font-mono text-xs">{change.lineId ?? change.file}</span>}
                    </p>
                    <p className="text-muted-foreground text-xs">
                      {[moment, `v${change.version}`].filter(Boolean).join(" · ")}
                    </p>
                  </div>
                  <div className="flex items-center gap-2.5 text-xs">
                    <Kind kind={change.kind} />
                    <span className="text-muted-foreground hidden items-center gap-1.5 whitespace-nowrap sm:inline-flex">
                      <Avatar name={change.by} small />
                      {change.by ?? "—"}
                    </span>
                    <span className="text-muted-foreground tabular-nums">{date(change.at, CLOCK)}</span>
                  </div>
                </div>
              );
            })}
          </section>
        ))}
        {!loaded && pending.count > 0 && (
          <p className="text-muted-foreground px-5 py-6 text-sm">
            {failed ? "The lines did not load; the counts above still hold." : "Loading the lines…"}
          </p>
        )}
        {loaded && pending.count > pending.changes.length && (
          <p className="text-muted-foreground px-5 py-3 text-xs">
            Showing the newest {pending.changes.length.toLocaleString()} of {lines(pending.count)}; all of them go out.
          </p>
        )}
      </div>

      <footer className="bg-muted/30 border-t">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-5 py-3">
          <span
            className="text-muted-foreground flex-1 text-sm"
            title={next ? "From the last release made here; the release bumps what players have, which may be newer." : undefined}
          >
            Version{" "}
            <span className="text-foreground font-mono">
              {next ? `about ${version} → ${next}` : bumpable ? "set by the pack's first release" : "chosen by the release workflow"}
            </span>
          </span>
          {bumpable && (
            <div role="group" aria-label="Version bump" className="flex overflow-hidden rounded-md border text-sm">
              {RELEASE_BUMPS.map((option) => (
                <button
                  key={option}
                  type="button"
                  aria-pressed={bump === option}
                  onClick={() => setBump(option)}
                  className={cn(
                    "px-3 py-1 capitalize",
                    bump === option ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {option}
                </button>
              ))}
            </div>
          )}
          <Button variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
          <Button onClick={() => onRelease(bump)}>
            {pending.count + pending.textChanges > 0
              ? `Release ${lines(pending.count + pending.textChanges)}`
              : "Release anyway"}
          </Button>
        </div>
        <p className="text-muted-foreground px-5 pb-2.5 text-xs">
          Counted from the live takes. The release compares the built pack with what players have, so its own numbers
          can differ slightly.
        </p>
      </footer>
    </DialogContent>
  );
}

function Tile({ value, label, highlight }: { value: React.ReactNode; label: string; highlight?: boolean }) {
  return (
    <div className={cn("bg-muted/30 rounded-lg border px-3 py-2.5", highlight && "border-primary/35")}>
      <div className="text-xl font-semibold tracking-tight tabular-nums">{value}</div>
      <div className="text-muted-foreground truncate text-xs" title={label}>
        {label}
      </div>
    </div>
  );
}

function Kind({ kind }: { kind: PendingChange["kind"] }) {
  return (
    <span
      className={cn(
        "rounded-full border px-2 py-0.5 text-xs whitespace-nowrap",
        kind === "new" ? "border-emerald-400/30 bg-emerald-400/10 text-emerald-300" : "border-sky-400/30 bg-sky-400/10 text-sky-300",
      )}
    >
      {kind === "new" ? "new" : "put back"}
    </span>
  );
}
