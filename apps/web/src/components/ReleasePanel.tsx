"use client";

import { ChevronDown } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import ReleaseLog from "@/components/ReleaseLog";
import { Toaster, useToast } from "@/components/ui/toast";
import { useLocalDates } from "@/components/useLocalDates";
import { langName, type Lang } from "@/lib/lang";
import { cn } from "@/lib/utils";
import {
  isSettled,
  RELEASE_SECTIONS,
  type ReleaseBump,
  type ReleaseSection,
  type ReleaseView,
  type RunView,
} from "@/lib/releases/sections";
import { SOURCE_LABELS } from "@/lib/reports/reports";

const POLL_MS = 15_000;
const FOCUS_MIN_MS = 10_000;

const SINCE: Intl.DateTimeFormatOptions = { hour: "2-digit", minute: "2-digit" };
const WHEN: Intl.DateTimeFormatOptions = { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" };

const SHOWN: Record<RunView["state"], string> = {
  dispatching: "Starting",
  running: "Running",
  done: "Done",
  unchanged: "Nothing changed",
  failed: "Failed",
};

/** What came of a settled run. */
function outcomeText(run: RunView): string {
  if (run.state === "done") return run.version ? `Released ${run.version}.` : "Released.";
  return run.error ? `Nothing was released: ${run.error}` : "Nothing was released.";
}

function RunLink({ run, children }: { run: RunView; children: React.ReactNode }) {
  if (!run.githubUrl) return <>{children}</>;
  return (
    <a href={run.githubUrl} target="_blank" rel="noreferrer" className="underline underline-offset-4">
      {children}
    </a>
  );
}

function ReleaseButton({ disabled, onRelease }: { disabled: boolean; onRelease: (bump: ReleaseBump) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="flex">
      <Button disabled={disabled} className="rounded-r-none" onClick={() => onRelease("patch")}>
        Patch release
      </Button>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button disabled={disabled} size="icon" aria-label="Other releases" className="border-background rounded-l-none border-l">
            <ChevronDown className={open ? "size-4 rotate-180" : "size-4"} />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-44 p-1">
          {(["minor", "major"] as const).map((bump) => (
            <button
              key={bump}
              type="button"
              className="hover:bg-muted w-full cursor-pointer rounded px-2 py-1.5 text-left text-sm capitalize"
              onClick={() => {
                setOpen(false);
                onRelease(bump);
              }}
            >
              {bump} release
            </button>
          ))}
        </PopoverContent>
      </Popover>
    </div>
  );
}

const ownRun = (view: ReleaseView, lang: Lang) => (view.active?.own && view.active.lang === lang ? view.active : null);

const lastSettled = (view: ReleaseView, section: ReleaseSection) =>
  view.recent.find((run) => run.section === section && isSettled(run.state));

// A shell, because useToast has to find a provider above the component that calls it.
export default function ReleasePanel(props: { lang: Lang; initial: ReleaseView }) {
  return (
    <Toaster>
      <Panel {...props} />
    </Toaster>
  );
}

function Panel({ lang, initial }: { lang: Lang; initial: ReleaseView }) {
  const toast = useToast();
  const [view, setView] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [pressing, setPressing] = useState(false);
  // Checks in a row that got no answer; without it a stale "running" looks like a live one.
  const [missed, setMissed] = useState(0);
  const running = view.active !== null;
  const watching = useRef(ownRun(initial, lang)?.section ?? null);
  const asked = useRef(0);
  // Which ask an answer belongs to: a focus check still out when a press asks again must not land
  // after the press's answer and take its run back off the page.
  const asks = useRef(0);

  const refresh = useCallback(async (): Promise<boolean> => {
    asked.current = Date.now();
    const ask = ++asks.current;
    const response = await fetch(`/api/releases?lang=${lang}`, { cache: "no-store" }).catch(() => null);
    const next = response?.ok ? ((await response.json().catch(() => null)) as ReleaseView | null) : null;
    if (ask !== asks.current) return true;
    if (!next) {
      setMissed((count) => count + 1);
      return false;
    }
    setMissed(0);
    setView(next);
    const section = watching.current;
    const now = ownRun(next, lang)?.section ?? null;
    watching.current = now;
    if (section && !now) {
      const settled = lastSettled(next, section);
      if (settled) {
        toast({
          tone: settled.state === "failed" ? "error" : "info",
          title: `${SOURCE_LABELS[section]} in ${langName(lang)}`,
          detail: outcomeText(settled),
        });
      }
    }
    return true;
  }, [lang, toast]);

  useEffect(() => {
    if (!running) return;
    // A hidden tab asking every 15 s could last the hours a release takes.
    const timer = setInterval(() => {
      if (!document.hidden) void refresh();
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [running, refresh]);

  // The interval skips a hidden tab, and a release lasts long enough to switch away from, so
  // coming back asks at once instead of showing a finished run as running until the next tick.
  // It also catches a run another admin started from their browser.
  useEffect(() => {
    // Switching windows back and forth asks at most once in a while; a poll in progress already
    // keeps a running release current.
    const look = () => {
      if (!document.hidden && Date.now() - asked.current > FOCUS_MIN_MS) void refresh();
    };
    document.addEventListener("visibilitychange", look);
    window.addEventListener("focus", look);
    return () => {
      document.removeEventListener("visibilitychange", look);
      window.removeEventListener("focus", look);
    };
  }, [refresh]);

  const ours = ownRun(view, lang);

  async function release(section: ReleaseSection, bump: ReleaseBump) {
    setPressing(true);
    setError(null);
    const response = await fetch(`/api/releases?lang=${lang}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ section, bump }),
    }).catch(() => null);
    let refused: string | null = null;
    if (!response) refused = "Could not reach the server.";
    else if (!response.ok) {
      const { error: message } = (await response.json().catch(() => ({}))) as { error?: string };
      refused = message ?? "Something went wrong.";
    }
    if (refused) {
      setError(`Nothing was released: ${refused}`);
      toast({ tone: "error", title: "Nothing was released", detail: refused });
    }
    // A refused press may still leave a run to show, and a good one starts the polling. Polling
    // runs only while the page knows of a run, so a lost answer here is asked once more.
    if (!(await refresh()) && !refused) setTimeout(() => void refresh(), 5_000);
    setPressing(false);
  }

  const { active } = view;
  const elsewhere = active && !ours ? active : null;
  const holdUp = active ? `${SOURCE_LABELS[active.section]} in ${langName(active.lang)}` : null;
  return (
    <div>
      {error && (
        <p role="alert" className="text-destructive mb-3 text-sm">
          {error}
        </p>
      )}
      {running && missed >= 2 && (
        <p role="status" className="text-muted-foreground mb-3 text-sm">
          The site has not answered the last {missed} checks, so this may be out of date. Still
          trying; reloading the page also works.
        </p>
      )}
      {/* The team's own run in this language shows on its section's card. */}
      {elsewhere && (
        <div className="border-primary/35 bg-primary/10 mb-5 flex items-center gap-3 rounded-lg border px-4 py-3 text-sm">
          <span aria-hidden className="bg-primary size-2 shrink-0 animate-pulse rounded-full motion-reduce:animate-none" />
          <p>
            {elsewhere.own ? (
              <RunLink run={elsewhere}>
                <span className="font-medium capitalize">{elsewhere.section}</span> in {langName(elsewhere.lang)}:{" "}
                {elsewhere.step ?? SHOWN[elsewhere.state]}
              </RunLink>
            ) : (
              <>
                <span className="font-medium capitalize">{elsewhere.section}</span> in {langName(elsewhere.lang)} is
                releasing for another team.
              </>
            )}{" "}
            <span className="text-muted-foreground">Only one release runs at a time; yours can start once it ends.</span>
          </p>
        </div>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        {RELEASE_SECTIONS.map((section) => (
          <SectionCard
            key={section}
            section={section}
            last={lastSettled(view, section)}
            released={view.released[section]}
            current={ours?.section === section ? ours : null}
            disabled={running || pressing}
            waitingFor={running && ours?.section !== section ? holdUp : null}
            onRelease={(bump) => void release(section, bump)}
          />
        ))}
      </div>
    </div>
  );
}

/** One section's pack: the version last released from here, who released it when, and the button. */
function SectionCard({
  section,
  last,
  released,
  current,
  disabled,
  waitingFor,
  onRelease,
}: {
  section: ReleaseSection;
  /** Its newest settled run. */
  last: RunView | undefined;
  /** Its newest run that released, however far back. */
  released: RunView | undefined;
  current: RunView | null;
  disabled: boolean;
  /** The run this card's button waits on, when it is another section's or language's. */
  waitingFor: string | null;
  onRelease: (bump: ReleaseBump) => void;
}) {
  const date = useLocalDates();
  const logRun = current ?? last;
  return (
    <article className="bg-card flex flex-col gap-3 rounded-lg border p-4">
      <header className="flex items-baseline justify-between gap-3">
        <h2 className="font-semibold capitalize">{section}</h2>
        <span className="text-muted-foreground font-mono text-sm">
          {released?.version ? `v${released.version}` : "no version yet"}
        </span>
      </header>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
        <dt className="text-muted-foreground">Last release</dt>
        <dd className="tabular-nums">
          {released?.startedAt ? (
            <>
              <time dateTime={released.finishedAt ?? released.startedAt}>
                {date(released.finishedAt ?? released.startedAt, WHEN)}
              </time>
              {released.by && <span className="text-muted-foreground"> · {released.by}</span>}
            </>
          ) : (
            <span className="text-muted-foreground">Not released from here yet</span>
          )}
        </dd>
        <dt className="text-muted-foreground">Status</dt>
        <dd className="min-w-0">
          {current ? (
            <span className="inline-flex flex-wrap items-center gap-x-2">
              <span aria-hidden className="bg-primary size-2 animate-pulse rounded-full motion-reduce:animate-none" />
              <RunLink run={current}>{current.step ?? SHOWN[current.state]}</RunLink>
              {current.startedAt && (
                <span className="text-muted-foreground tabular-nums">since {date(current.startedAt, SINCE)}</span>
              )}
            </span>
          ) : last ? (
            <span className={cn("inline-flex flex-wrap items-center gap-x-2", last.state === "failed" && "text-destructive")}>
              <span
                aria-hidden
                className={cn(
                  "size-2 rounded-full",
                  last.state === "done" ? "bg-emerald-400" : last.state === "failed" ? "bg-destructive" : "bg-muted-foreground",
                )}
              />
              {outcomeText(last)}
              {last.githubUrl && <RunLink run={last}>Run</RunLink>}
            </span>
          ) : (
            <span className="text-muted-foreground">Ready</span>
          )}
        </dd>
      </dl>
      {current && <Progress run={current} />}
      <div className="mt-auto flex flex-wrap items-center justify-end gap-x-3 gap-y-2 border-t pt-3">
        <div className="mr-auto flex min-w-0 flex-wrap items-center gap-x-3">
          {logRun && <ReleaseLog run={logRun} />}
          {current ? (
            <p className="text-muted-foreground text-xs">Releasing now. You can leave this page.</p>
          ) : (
            waitingFor && <p className="text-muted-foreground text-xs">Waits for {waitingFor} to finish.</p>
          )}
        </div>
        <ReleaseButton disabled={disabled} onRelease={onRelease} />
      </div>
    </article>
  );
}

/**
 * How far a run is, from what release.mjs announces: its "step 2 of 5", and within the upload
 * the "100/415 blobs" it counts. A run that announces neither shows no bar rather than a guess.
 */
function Progress({ run }: { run: RunView }) {
  const step = /step (\d+) of (\d+)/.exec(run.step ?? "");
  if (!step) return null;
  const [at, of] = [Number(step[1]), Number(step[2])];
  const blobs = [...(run.log ?? "").matchAll(/^\s*(\d+)\/(\d+) blobs$/gm)].at(-1);
  const within = blobs ? Number(blobs[1]) / Number(blobs[2]) : 0;
  const share = Math.min(1, (at - 1 + within) / of);
  return (
    <div>
      <div
        role="progressbar"
        aria-label="Release progress"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(share * 100)}
        className="bg-muted h-1.5 overflow-hidden rounded-full"
      >
        <div
          className="bg-primary h-full rounded-full transition-[width] duration-700 ease-out"
          style={{ width: `${Math.max(4, share * 100)}%` }}
        />
      </div>
      <p className="text-muted-foreground mt-1.5 flex justify-between text-xs tabular-nums">
        <span>
          Step {at} of {of}
        </span>
        {blobs && (
          <span>
            {blobs[1]} of {blobs[2]} files uploaded
          </span>
        )}
      </p>
    </div>
  );
}
