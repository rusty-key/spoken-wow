"use client";

/**
 * The open-report count on an explorer row, and for a triager the reports themselves.
 *
 * The count is public; the bodies are not. So everyone sees how many open reports a line
 * carries -- "somebody has already said so" is the answer to the question a dissatisfied
 * listener is about to ask -- and a triager can open the chip to read them and close them
 * where the fix happened. The loop this replaces was: re-roll the line, go to /reports,
 * find the row again among every section's, press Fixed. The row is where the line was
 * listened to and regenerated, so it is where the verdict belongs too.
 *
 * Fetched on open rather than shipped with the search: a page of rows carries a count each,
 * and the bodies are wanted for the one row somebody clicks.
 */
import { useLang } from "@/components/LangProvider";
import { withLang } from "@/lib/lang";
import { MessageSquareIcon } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { resolveReport } from "@/lib/reports/client";
import { CATEGORY_COLUMN, STATUS_LABELS, type Report, type Status } from "@/lib/reports/reports";
import type { Source } from "@/lib/sections";
import { cn } from "@/lib/utils";

const CHIP = "flex items-center gap-0.5 rounded bg-amber-500/15 px-1 text-xs text-amber-400";

function plural(count: number): string {
  return `${count} open report${count === 1 ? "" : "s"}`;
}

function when(at: string): string {
  return new Date(at).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

type Props = {
  source: Source;
  lineId: string;
  /** The open count the search returned, until the popover has fetched its own. */
  count: number;
  /** Editor and up: may read the bodies and resolve them. */
  canTriage: boolean;
};

export default function ReportsBadge({ source, lineId, count, canTriage }: Props) {
  const lang = useLang();
  const [open, setOpen] = useState(false);
  /** Undefined until fetched; the reports, open first, once they are. */
  const [reports, setReports] = useState<Report[] | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<number | null>(null);

  // What has been fetched outranks what the search said: resolving from here has to take
  // the chip down without re-running the search the row came from.
  const openCount = reports ? reports.filter((report) => report.status === "open").length : count;

  // Kept on screen while the popover is up even at zero, so closing the last report does not
  // pull the anchor out from under the panel that is showing it.
  if (openCount === 0 && !open) return null;

  if (!canTriage) {
    return (
      <span className={CHIP} title={plural(openCount)}>
        <MessageSquareIcon className="size-3" />
        {openCount}
      </span>
    );
  }

  async function load() {
    setError(null);
    const params = new URLSearchParams({ source, lineId });
    const response = await fetch(withLang(lang, `/api/reports/line?${params}`)).catch(() => null);
    if (!response?.ok) return setError("could not load the reports");
    const body = (await response.json()) as { reports: Report[] };
    setReports(body.reports);
  }

  async function resolve(id: number, status: Status) {
    setBusy(id);
    setError(null);
    const report = await resolveReport(id, status);
    setBusy(null);

    if (!report) return setError("could not change that report");
    setReports((current) => current?.map((known) => (known.id === report.id ? report : known)));
  }

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        // Every open re-reads: a report may have been filed or closed elsewhere since.
        if (next) void load();
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          title={plural(openCount)}
          aria-label={`${plural(openCount)} - read them`}
          className={cn(CHIP, "cursor-pointer hover:bg-amber-500/25", openCount === 0 && "opacity-50")}
        >
          <MessageSquareIcon className="size-3" />
          {openCount}
        </button>
      </PopoverTrigger>
      <PopoverContent
        className="w-96 p-0 text-sm"
        // Portalled, but React still bubbles the click to the row, whose handler toggles it.
        onClick={(event) => event.stopPropagation()}
      >
        <div className="max-h-96 overflow-y-auto">
          {reports === undefined && !error ? (
            <p className="text-muted-foreground px-3 py-3 text-xs">Loading…</p>
          ) : reports?.length === 0 ? (
            <p className="text-muted-foreground px-3 py-3 text-xs">No reports on this line.</p>
          ) : (
            reports?.map((report) => (
              <div
                key={report.id}
                className={cn(
                  "border-border/60 flex flex-col gap-1.5 border-b px-3 py-2.5 last:border-b-0",
                  report.status !== "open" && "opacity-60",
                )}
              >
                <div className="text-muted-foreground flex items-center gap-2 text-xs">
                  <span className="text-foreground font-medium">
                    {CATEGORY_COLUMN[report.category]}
                  </span>
                  <span>{when(report.createdAt)}</span>
                  {report.status !== "open" ? (
                    <span className="ml-auto">{STATUS_LABELS[report.status]}</span>
                  ) : null}
                </div>
                <p className="whitespace-pre-wrap">{report.body}</p>
                {report.name || report.email ? (
                  <p className="text-muted-foreground text-xs">
                    {[report.name, report.email].filter(Boolean).join(" · ")}
                  </p>
                ) : null}
                <div className="flex gap-1.5">
                  {report.status === "open" ? (
                    <>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={busy === report.id}
                        onClick={() => void resolve(report.id, "fixed")}
                      >
                        Fixed
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={busy === report.id}
                        onClick={() => void resolve(report.id, "not_an_issue")}
                      >
                        Not a problem
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={busy === report.id}
                        onClick={() => void resolve(report.id, "minor")}
                      >
                        Minor
                      </Button>
                    </>
                  ) : (
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={busy === report.id}
                      onClick={() => void resolve(report.id, "open")}
                    >
                      Reopen
                    </Button>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
        {error ? (
          <p className="text-destructive border-t px-3 py-2 text-xs">{error}</p>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}
