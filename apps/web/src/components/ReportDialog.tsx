"use client";

import { useLang } from "@/components/LangProvider";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import ReportForm from "./ReportForm";
import { detailOf, reportTargetOf, type SourceLine } from "@/lib/reports/detail";
import type { Source } from "@/lib/sections";

/** The line being reported and which corpus it belongs to, or null when the dialog is shut. */
export type ReportSubject = { source: Source; line: SourceLine } | null;

type Props = {
  subject: ReportSubject;
  onClose: () => void;
};

/**
 * Reporting a line from the table, without leaving it.
 *
 * One dialog for all three sections, against the same ReportForm the /r/ landing pages show
 * a player who copied an address out of the game, and the same public endpoint - so a report
 * filed here is indistinguishable from one filed from the game, which is what keeps triage
 * one list rather than three.
 *
 * It was three dialogs and two of them existed: quests carried the lineId as well as the
 * address, because an NPC address names every line that speaker has and a reporter coming
 * from the game picks one by hand, while the places one passed a file path and had a
 * never-used "general" mode. Both of those are the same shape once the address is asked for
 * per source, which is what reportTargetOf does.
 */
export default function ReportDialog({ subject, onClose }: Props) {
  const lang = useLang();
  const target = subject ? reportTargetOf(subject.source, subject.line) : null;

  // No address means no report: a line the addressing scheme cannot name would arrive in
  // triage as a row nobody can resolve. The rows hide the button in the same case, so this
  // is the second half of one decision rather than a case anyone should reach.
  if (!subject || !target) return null;

  const detail = detailOf(subject.source, subject.line, undefined, lang);
  const context = [detail.speaker?.name, detail.aside].filter(Boolean).join(" · ");

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Report this line</DialogTitle>
          <DialogDescription>
            {detail.heading}
            {context ? ` — ${context}` : ""} ({target})
          </DialogDescription>
        </DialogHeader>

        <ReportForm source={subject.source} target={target} lineId={detail.lineId} />
      </DialogContent>
    </Dialog>
  );
}
