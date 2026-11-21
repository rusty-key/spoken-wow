"use client";

import { Check, Copy, Download, ScrollText, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { useLocalDates } from "@/components/useLocalDates";
import { langName } from "@/lib/lang";
import { parseLog, type LogLine, type Tone } from "@/lib/releases/log";
import { isSettled, type RunView } from "@/lib/releases/sections";
import { SOURCE_LABELS } from "@/lib/reports/reports";
import { cn } from "@/lib/utils";

const TONES: Record<Tone, string> = {
  plain: "",
  pack: "text-sky-300",
  add: "text-emerald-300",
  change: "text-amber-300",
  remove: "text-rose-300",
  version: "bg-muted text-foreground rounded px-1",
  dim: "text-muted-foreground",
};

const CLOCK: Intl.DateTimeFormatOptions = { hour: "2-digit", minute: "2-digit" };

function minutes(from: string, to: string): string {
  const seconds = Math.max(0, Math.round((Date.parse(to) - Date.parse(from)) / 1000));
  return seconds < 60 ? `${seconds} s` : `${Math.floor(seconds / 60)} min ${seconds % 60} s`;
}

/**
 * A run's output, in a dialog large enough to read it: coloured, numbered, with its steps to
 * jump between. While the run is going, `run` is replaced on every check and the view follows
 * the new lines unless the reader turned that off or scrolled up to read.
 */
export default function ReleaseLog({ run }: { run: RunView }) {
  const [open, setOpen] = useState(false);
  if (!run.log) return null;
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button variant="ghost" size="sm" className="text-muted-foreground -ml-2" onClick={() => setOpen(true)}>
        <ScrollText className="size-4" aria-hidden />
        View log
      </Button>
      {open && <LogDialog run={run} />}
    </Dialog>
  );
}

function LogDialog({ run }: { run: RunView }) {
  const date = useLocalDates();
  const lines = useMemo(() => parseLog(run.log ?? ""), [run.log]);
  const steps = lines.filter((line) => line.step);
  const cut = run.logCut;
  const settled = isSettled(run.state);
  const [follow, setFollow] = useState(!settled);
  const [errorsOnly, setErrorsOnly] = useState(false);
  const [copied, setCopied] = useState(false);
  const body = useRef<HTMLDivElement>(null);
  const errors = lines.filter((line) => line.kind === "error");
  const shown = errorsOnly ? errors : lines;

  useEffect(() => {
    if (follow && body.current) body.current.scrollTop = body.current.scrollHeight;
    // On the text, not the line count: once the kept tail is full it slides at the same length.
  }, [follow, run.log]);

  const section = SOURCE_LABELS[run.section];
  const text = run.log ?? "";

  function jump(no: number) {
    setErrorsOnly(false);
    setFollow(false);
    // After the full log is back in place, if it had been filtered.
    requestAnimationFrame(() => body.current?.querySelector(`[data-line="${no}"]`)?.scrollIntoView({ block: "start" }));
  }

  async function copy() {
    const ok = await navigator.clipboard.writeText(text).then(
      () => true,
      () => false,
    );
    if (!ok) return;
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  function download() {
    const url = URL.createObjectURL(new Blob([text], { type: "text/plain" }));
    const link = Object.assign(document.createElement("a"), {
      href: url,
      download: `release-${run.section}-${run.lang}-${(run.startedAt ?? "").slice(0, 16).replace(/[:T]/g, "")}.txt`,
    });
    link.click();
    // After the click has been handled: revoked at once, some browsers drop the download.
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }

  return (
    <DialogContent
      className="grid max-h-[min(48rem,calc(100dvh-2rem))] max-w-[min(62rem,calc(100vw-2rem))] grid-rows-[auto_auto_minmax(0,1fr)_auto] gap-0 overflow-hidden p-0"
    >
      <header className="flex flex-wrap items-start gap-x-4 gap-y-2 border-b pt-4 pr-12 pb-3 pl-5">
        <div className="min-w-0 flex-1">
          <DialogTitle className="flex flex-wrap items-center gap-2.5 text-base">
            {section} in {langName(run.lang)}
            <StatePill run={run} />
          </DialogTitle>
          <DialogDescription className="mt-1.5 tabular-nums">
            {run.startedAt && <>Started {date(run.startedAt, CLOCK)}</>}
            {run.by && <> by {run.by}</>}
            {run.startedAt && run.finishedAt && (
              <>
                {" "}
                · finished {date(run.finishedAt, CLOCK)} · took {minutes(run.startedAt, run.finishedAt)}
              </>
            )}
          </DialogDescription>
        </div>
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="sm" onClick={() => void copy()}>
            {copied ? <Check className="size-4" aria-hidden /> : <Copy className="size-4" aria-hidden />}
            {copied ? "Copied" : "Copy"}
          </Button>
          <Button variant="ghost" size="sm" onClick={download}>
            <Download className="size-4" aria-hidden />
            .txt
          </Button>
        </div>
      </header>

      {steps.length > 0 ? (
        <nav aria-label="Steps" className="flex items-center gap-1 overflow-x-auto border-b px-4 py-2">
          {steps.map((line, index) => {
            const last = index === steps.length - 1;
            const state = !last ? "done" : settled ? (run.state === "failed" ? "failed" : "done") : "current";
            return (
              <span key={line.no} className="flex shrink-0 items-center gap-1">
                {index > 0 && <span aria-hidden className="bg-border h-px w-4" />}
                <button
                  type="button"
                  onClick={() => jump(line.no)}
                  aria-current={state === "current" ? "step" : undefined}
                  className={cn(
                    "hover:bg-muted flex items-center gap-1.5 rounded-md px-2 py-1 text-xs whitespace-nowrap",
                    state === "current" ? "text-foreground" : "text-muted-foreground",
                  )}
                >
                  <StepMark state={state} at={line.step!.at} />
                  {line.step!.name}
                </button>
              </span>
            );
          })}
        </nav>
      ) : (
        <div />
      )}

      <div
        ref={body}
        onScroll={(event) => {
          // Any way of scrolling up to read stops following: wheel, scrollbar, keys or touch. The
          // effect's own scroll to the end lands at the bottom, so it never trips this.
          const box = event.currentTarget;
          if (box.scrollHeight - box.scrollTop - box.clientHeight > 8) setFollow(false);
        }}
        className="min-h-48 overflow-auto bg-[oklch(0.115_0.004_260)] py-2 font-mono text-[12.5px] leading-[1.7]"
      >
        {cut && !errorsOnly && (
          <p className="text-muted-foreground px-4 pb-1 font-sans text-xs">
            Earlier output is cut off: the site keeps the last 8 KB of each run.
          </p>
        )}
        {shown.length === 0 && (
          <p className="text-muted-foreground px-4 py-2 font-sans text-sm">
            {errorsOnly ? "No errors in this output." : "Nothing written yet."}
          </p>
        )}
        {shown.map((line) => (
          <Line key={line.no} line={line} />
        ))}
      </div>

      <footer className="text-muted-foreground flex flex-wrap items-center gap-x-4 gap-y-2 border-t px-5 py-2.5 text-xs">
        {!settled && (
          <label className="flex cursor-pointer items-center gap-2">
            <input
              type="checkbox"
              checked={follow}
              onChange={(event) => setFollow(event.target.checked)}
              className="accent-primary size-3.5"
            />
            Follow new lines
          </label>
        )}
        <span className="flex-1" />
        <Button
          variant="ghost"
          size="xs"
          aria-pressed={errorsOnly}
          disabled={errors.length === 0}
          onClick={() => setErrorsOnly((on) => !on)}
          className={cn(errorsOnly && "bg-muted text-foreground")}
        >
          Errors only{errors.length > 0 && ` (${errors.length})`}
        </Button>
        <span className="tabular-nums">
          {lines.length} {lines.length === 1 ? "line" : "lines"}
        </span>
      </footer>
    </DialogContent>
  );
}

function Line({ line }: { line: LogLine }) {
  return (
    <div
      data-line={line.no}
      className={cn(
        "grid scroll-mt-2 grid-cols-[3.25rem_minmax(0,1fr)] gap-x-3 pr-4 hover:bg-white/[0.03]",
        line.kind === "step" && "bg-primary/[0.06] mt-2 first:mt-0",
        line.kind === "error" && "bg-destructive/10",
      )}
    >
      <span aria-hidden className="text-muted-foreground/60 text-right select-none">
        {line.no}
      </span>
      <span
        className={cn(
          "break-words whitespace-pre-wrap",
          line.kind === "step" && "text-primary-ink font-semibold",
          line.kind === "final" && "font-semibold text-emerald-300",
          line.kind === "error" && "text-destructive",
        )}
      >
        {line.segments.map((segment, index) => (
          <span key={index} className={line.kind === "plain" ? TONES[segment.tone] : undefined}>
            {segment.text}
          </span>
        ))}
      </span>
    </div>
  );
}

function StepMark({ state, at }: { state: "done" | "current" | "failed"; at: number }) {
  return (
    <span
      aria-hidden
      className={cn(
        "grid size-[18px] place-items-center rounded-full border text-[10px]",
        state === "done" && "border-emerald-400/40 bg-emerald-400/15 text-emerald-300",
        state === "current" && "border-primary text-primary-ink",
        state === "failed" && "border-destructive/50 bg-destructive/15 text-destructive",
      )}
    >
      {state === "done" ? <Check className="size-3" strokeWidth={3} /> : state === "failed" ? <X className="size-3" strokeWidth={3} /> : at}
    </span>
  );
}

function StatePill({ run }: { run: RunView }) {
  const [label, tone] =
    run.state === "done"
      ? [run.version ? `Released ${run.version}` : "Released", "border-emerald-400/30 bg-emerald-400/10 text-emerald-300"]
      : run.state === "failed"
        ? ["Failed", "border-destructive/30 bg-destructive/10 text-destructive"]
        : run.state === "unchanged"
          ? ["Nothing changed", "bg-muted text-muted-foreground"]
          : ["Running", "border-primary/35 bg-primary/10 text-primary-ink"];
  return <span className={cn("rounded-full border px-2 py-px text-xs font-medium", tone)}>{label}</span>;
}
