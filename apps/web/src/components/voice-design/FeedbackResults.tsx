"use client";

import { X } from "lucide-react";

import { useUiText } from "@/components/UiTextProvider";
import { fill } from "@/lib/site-text/format";
import type { Design, Verdict } from "@/lib/voice-design/types";

const day = (iso: string) => iso.slice(0, 10);

/** What players said about each showing of a version, newest showing first. */
export default function FeedbackResults({
  design,
  can,
  disabled,
  onHide,
}: {
  design: Design;
  can: boolean;
  disabled: boolean;
  onHide: (showingId: number, voter: string) => void;
}) {
  const t = useUiText().voiceDesign;
  if (design.showings.length === 0) return null;
  const verdict: Record<Verdict, string> = { fits: t.verdictFits, close: t.verdictClose, off: t.verdictOff, skip: t.verdictSkip };
  return (
    <section className="vd-feedback" aria-label={t.feedbackLabel}>
      <p className="bs-label">{t.feedbackLabel}</p>
      {design.showings.map((showing) => {
        const total = Object.values(showing.counts).reduce((sum, n) => sum + n, 0);
        return (
          <div key={showing.id} className="vd-feedback-round">
            <p className="vd-muted">
              {fill(t.shownBy, { who: showing.createdByName ?? t.someone, when: day(showing.createdAt) })}
              {" · "}
              {total === 0 ? t.feedbackNone : fill(t.feedbackCounts, showing.counts)}
            </p>
            {showing.notes.length > 0 ? (
              <ol className="vd-feedback-notes">
                {showing.notes.map((note) => (
                  <li key={note.voter} className="vd-review">
                    <span className="vd-tag" data-verdict={note.verdict}>
                      {verdict[note.verdict]}
                    </span>
                    <span className="vd-muted">
                      {note.who ?? t.anonymous} · {day(note.at)}
                    </span>
                    <span className="vd-review-note">{note.note}</span>
                    {can ? (
                      <button
                        type="button"
                        className="vd-mark vd-review-remove"
                        title={t.hideNoteTitle}
                        disabled={disabled}
                        onClick={() => onHide(showing.id, note.voter)}
                      >
                        <X size={14} aria-hidden="true" />
                        <span className="sr-only">{t.hideNote}</span>
                      </button>
                    ) : null}
                  </li>
                ))}
              </ol>
            ) : null}
          </div>
        );
      })}
    </section>
  );
}
