"use client";

import { useCallback, useEffect, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { langName, type Lang } from "@/lib/lang";
import { RELEASE_SECTIONS, type ReleaseView, type RunView } from "@/lib/releases/sections";

const POLL_MS = 15_000;

const SHOWN: Record<RunView["state"], string> = {
  dispatching: "Starting",
  running: "Running",
  done: "Done",
  failed: "Failed",
};

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

export default function ReleasePanel({ lang, initial }: { lang: Lang; initial: ReleaseView }) {
  const [view, setView] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [pressing, setPressing] = useState(false);
  const running = view.active !== null;

  const refresh = useCallback(async () => {
    const response = await fetch(`/api/releases?lang=${lang}`, { cache: "no-store" }).catch(() => null);
    if (response?.ok) setView((await response.json()) as ReleaseView);
  }, [lang]);

  useEffect(() => {
    if (!running) return;
    // A hidden tab asking every 15 s could last the hours a release takes.
    const timer = setInterval(() => {
      if (!document.hidden) void refresh();
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [running, refresh]);

  async function release(section: string) {
    setPressing(true);
    setError(null);
    const response = await fetch(`/api/releases?lang=${lang}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ section }),
    }).catch(() => null);
    if (!response) setError("Could not reach the server.");
    else if (!response.ok) {
      const { error: message } = (await response.json().catch(() => ({}))) as { error?: string };
      setError(message ?? "Something went wrong.");
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
          const last = view.recent.find((run) => run.section === section && (run.state === "done" || run.state === "failed"));
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
                    <Badge variant={last.state === "done" ? "secondary" : "destructive"}>{SHOWN[last.state]}</Badge>
                    {last.state === "failed" && last.error && <span className="ml-2">{last.error}</span>}
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
              <Button disabled={running || pressing} onClick={() => void release(section)}>
                Release
              </Button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
