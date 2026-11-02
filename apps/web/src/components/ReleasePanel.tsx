"use client";

import { ChevronDown } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Toaster, useToast } from "@/components/ui/toast";
import { langName, type Lang } from "@/lib/lang";
import { isSettled, RELEASE_SECTIONS, type ReleaseBump, type ReleaseView, type RunView } from "@/lib/releases/sections";

const POLL_MS = 15_000;

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

function RunLog({ run }: { run: RunView }) {
  if (!run.log) return null;
  return (
    <details className="ml-2 inline-block align-top">
      <summary className="cursor-pointer underline underline-offset-4">Log</summary>
      <pre className="bg-muted mt-2 max-h-80 max-w-3xl overflow-auto rounded p-3 text-xs whitespace-pre-wrap">{run.log}</pre>
    </details>
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
  const running = view.active !== null;
  const watching = useRef(initial.active?.own && initial.active.lang === lang ? initial.active.section : null);

  const refresh = useCallback(async () => {
    const response = await fetch(`/api/releases?lang=${lang}`, { cache: "no-store" }).catch(() => null);
    if (!response?.ok) return;
    const next = (await response.json()) as ReleaseView;
    setView(next);
    const section = watching.current;
    const now = next.active?.own && next.active.lang === lang ? next.active.section : null;
    watching.current = now;
    if (section && !now) {
      const settled = next.recent.find((run) => run.section === section && isSettled(run.state));
      if (settled) {
        toast({
          tone: settled.state === "failed" ? "error" : "info",
          title: `${section[0].toUpperCase()}${section.slice(1)} in ${langName(lang)}`,
          detail: outcomeText(settled),
        });
      }
    }
  }, [lang, toast]);

  useEffect(() => {
    if (!running) return;
    // A hidden tab asking every 15 s could last the hours a release takes.
    const timer = setInterval(() => {
      if (!document.hidden) void refresh();
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [running, refresh]);

  async function release(section: string, bump: ReleaseBump) {
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
    // A refused press may still leave a run to show, and a good one starts the polling.
    await refresh();
    setPressing(false);
  }

  const { active } = view;
  return (
    <div>
      {error && (
        <p role="alert" className="text-destructive mb-3 text-sm">
          {error}
        </p>
      )}
      {/* The team's own run in this language shows on its section's row. */}
      {active && !(active.own && active.lang === lang) && (
        <p className="mb-3 text-sm">
          {active.own ? (
            <RunLink run={active}>
              {active.section} in {langName(active.lang)}: {active.step ?? SHOWN[active.state]}
            </RunLink>
          ) : (
            <>A release is running: {active.section} in {langName(active.lang)}.</>
          )}
        </p>
      )}
      <ul className="divide-y">
        {RELEASE_SECTIONS.map((section) => {
          const last = view.recent.find((run) => run.section === section && isSettled(run.state));
          const current = active?.own && active.section === section && active.lang === lang ? active : null;
          return (
            <li key={section} className="flex items-center gap-4 py-3">
              <span className="w-28 font-medium capitalize">{section}</span>
              <span className="text-muted-foreground flex-1 text-sm">
                {current ? (
                  <>
                    <RunLink run={current}>{current.step ?? SHOWN[current.state]}</RunLink>
                    <RunLog run={current} />
                  </>
                ) : last ? (
                  <>
                    <Badge variant={last.state === "failed" ? "destructive" : "secondary"}>{SHOWN[last.state]}</Badge>
                    <span className="ml-2">{outcomeText(last)}</span>
                    {last.githubUrl && (
                      <span className="ml-2">
                        <RunLink run={last}>Run</RunLink>
                      </span>
                    )}
                    <RunLog run={last} />
                  </>
                ) : (
                  "Not released from here yet"
                )}
              </span>
              <ReleaseButton disabled={running || pressing} onRelease={(bump) => void release(section, bump)} />
            </li>
          );
        })}
      </ul>
    </div>
  );
}
