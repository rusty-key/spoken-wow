"use client";

/**
 * A report's text as the contributions page would show it (lib/reports/contribute.ts): a
 * contribution where the corpus lacks the moment, a correction -- the moment's wordings and the
 * player's text, their differences marked -- where it speaks other text, and nothing to accept
 * where it already speaks this.
 *
 * The accepts are the matching tab's own: a contribution's Accept, or a correction's Accept (a
 * fix of the wording picked, the closest until another is) and Accept as new line (another
 * wording beside them). Each stores the text as a contribution, and the report is answered
 * Fixed with it.
 */
import Link from "@/components/LocaleLink";
import { useEffect, useState } from "react";

import { Marked } from "@/components/CorrectionTable";
import { LiteButton } from "@/components/LiteControls";
import { wordDiff } from "@/lib/contributions/compare";
import { explorerHref } from "@/lib/links";
import type { CorrectionAccept, ReportContribution as Answer } from "@/lib/reports/contribute";
import { contributeReport, reportContribution } from "@/lib/reports/client";
import type { Report } from "@/lib/reports/reports";
import { cn } from "@/lib/utils";

export default function ReportContribution({
  report,
  onFixed,
}: {
  report: Report;
  onFixed: (report: Report) => void;
}) {
  const [answer, setAnswer] = useState<Answer | { error: string } | null>(null);
  /** The wording a correction is set against, where one other than the closest was picked. */
  const [picked, setPicked] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    void reportContribution(report.id).then((next) => live && setAnswer(next));
    return () => {
      live = false;
    };
  }, [report.id]);

  if (!answer) return <p className="text-muted-foreground mt-2">Comparing with the corpus…</p>;
  if ("error" in answer) return <p className="text-muted-foreground mt-2">{answer.error}</p>;

  async function accept(how: CorrectionAccept) {
    setBusy(true);
    const outcome = await contributeReport(report.id, how);
    setBusy(false);
    if ("error" in outcome) {
      setRefusal(outcome.error);
      return;
    }
    setRefusal(null);
    const { id, status } = outcome.contribution;
    setAnswer((current) => (current && !("error" in current) ? { ...current, stored: { id, status } } : current));
    onFixed(outcome.report);
  }

  const { state, stored } = answer;
  const accepted = stored?.status === "accepted";
  const chosen = state.kind === "changed" ? (picked ?? state.closest) : 0;
  const wording = state.kind === "changed" ? state.wordings[chosen] : null;
  const diff = wording ? wordDiff(wording.before, answer.text) : null;

  return (
    <div className="mt-2 flex flex-col gap-2 rounded border p-2">
      <p className="text-muted-foreground font-medium">
        {state.kind === "missing"
          ? "As a contribution: the corpus has no line for this."
          : state.kind === "changed"
            ? "As a correction: the line speaks other text."
            : "The line already speaks this text; there is nothing to contribute."}
        {stored ? ` Stored as contribution #${stored.id}, ${stored.status}.` : null}
      </p>

      {diff && state.kind === "changed" ? (
        <div className="grid grid-cols-2 gap-3 text-sm">
          <div>
            <p className="text-muted-foreground text-xs">Line speaks</p>
            {state.wordings.length > 1 ? (
              <ul className="space-y-2">
                {state.wordings.map((line, index) => (
                  <li
                    key={`${line.lineId}|${line.variant}`}
                    className={cn("border-l-2 pl-2", index === chosen ? "border-red-500/60" : "border-transparent")}
                  >
                    {index === chosen ? (
                      <Marked parts={diff.before} tone="removed" />
                    ) : (
                      <button
                        type="button"
                        title="Set the player's text against this wording"
                        className="text-muted-foreground hover:text-foreground text-left whitespace-pre-wrap"
                        onClick={() => setPicked(index)}
                      >
                        {line.before}
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            ) : (
              <Marked parts={diff.before} tone="removed" />
            )}
          </div>
          <div>
            <p className="text-muted-foreground text-xs">Player saw</p>
            <Marked parts={diff.after} tone="added" />
          </div>
        </div>
      ) : null}

      {state.kind !== "known" ? (
        <div className="flex items-center gap-1">
          {wording ? (
            <Link
              href={explorerHref(report.source, wording.lineId)}
              className="border-border bg-background hover:bg-muted inline-flex h-7 items-center rounded-md border px-2.5 text-[0.8rem] font-medium whitespace-nowrap"
            >
              {report.source === "readables" ? "Edit page" : "Edit line"}
            </Link>
          ) : null}
          {accepted ? null : (
            <>
              <LiteButton
                variant="accept"
                disabled={busy}
                title={
                  wording
                    ? "Take the player's text as what this line speaks, and answer the report Fixed"
                    : "Add the player's text as a new line, and answer the report Fixed"
                }
                onClick={() => void accept(wording ? { pick: { lineId: wording.lineId, variant: wording.variant } } : {})}
              >
                Accept
              </LiteButton>
              {wording && report.source === "quests" ? (
                <LiteButton
                  variant="accept"
                  disabled={busy}
                  title="Keep the corpus text and add the player's as another wording of this moment, and answer the report Fixed"
                  onClick={() => void accept({ as: "wording" })}
                >
                  Accept as new line
                </LiteButton>
              ) : null}
            </>
          )}
        </div>
      ) : null}

      {refusal ? <p className="text-destructive">{refusal}</p> : null}
    </div>
  );
}
