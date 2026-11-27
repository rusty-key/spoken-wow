"use client";

import { X } from "lucide-react";

import { Checkbox } from "@/components/ui/checkbox";
import { useUiText } from "@/components/UiTextProvider";
import { fill } from "@/lib/site-text/format";
import { VERDICTS, type Design, type Verdict } from "@/lib/voice-design/types";

import { designAudioUrl, useWorkbench } from "./context";
import PlayButton from "./PlayButton";

const day = (iso: string) => iso.slice(0, 10);

export const pickKey = (showingId: number, voter: string) => `${showingId}|${voter}`;

export const verdictLabels = (t: ReturnType<typeof useUiText>["voiceDesign"]): Record<Verdict, string> => ({
  fits: t.verdictFits,
  close: t.verdictClose,
  off: t.verdictOff,
  skip: t.verdictSkip,
});

/** What players said about each showing of a version, newest showing first. */
export default function FeedbackResults({
  design,
  can,
  disabled,
  onHide,
  picked,
  onPick,
}: {
  design: Design;
  can: boolean;
  disabled: boolean;
  onHide: (showingId: number, voter: string) => void;
  /** Notes ticked to go with the next verdict, as `<showingId>|<voter>`. */
  picked: ReadonlySet<string>;
  onPick: (key: string, on: boolean) => void;
}) {
  const t = useUiText().voiceDesign;
  const { lang } = useWorkbench();
  if (design.showings.length === 0) return null;
  const verdict = verdictLabels(t);
  return (
    <section className="vd-feedback" aria-label={t.feedbackLabel}>
      <p className="bs-label">{t.feedbackLabel}</p>
      {design.showings.map((showing) => {
        const total = Object.values(showing.counts).reduce((sum, n) => sum + n, 0);
        return (
          <div key={showing.id} className="vd-feedback-round">
            <p className="vd-muted">{fill(t.shownBy, { who: showing.createdByName ?? t.someone, when: day(showing.createdAt) })}</p>
            {/* Votes and notes are about these lines; once voiced again, the card's own lines are others. */}
            {showing.samples && showing.linesChanged ? (
              <div className="vd-round-lines">
                <span className="vd-muted">{t.roundLines}</span>
                {showing.samples.map((line, index) => (
                  <PlayButton
                    key={line.sha256 + index}
                    clip={{ src: designAudioUrl(lang, line.sha256), title: line.npcName ?? design.slot, meta: t.roundLines, subtitle: line.text ?? "" }}
                  >
                    {fill(t.roundLineN, { n: index + 1 })}
                  </PlayButton>
                ))}
              </div>
            ) : null}
            {total === 0 ? (
              <p className="vd-muted">{t.feedbackNone}</p>
            ) : (
              <ul className="vd-feedback-counts" aria-label={t.feedbackCountsLabel}>
                {VERDICTS.map((key) => (
                  <li key={key} className="vd-tag" data-verdict={key} data-none={showing.counts[key] === 0 || undefined}>
                    {verdict[key]} <strong>{showing.counts[key]}</strong>
                  </li>
                ))}
              </ul>
            )}
            {showing.notes.length > 0 ? (
              <ol className="vd-feedback-notes">
                {showing.notes.map((note) => (
                  <li key={note.voter} className="vd-review">
                    {can ? (
                      <Checkbox
                        className="vd-pick"
                        aria-label={t.pickNote}
                        title={t.pickNoteTitle}
                        checked={picked.has(pickKey(showing.id, note.voter))}
                        disabled={disabled}
                        onCheckedChange={(on) => onPick(pickKey(showing.id, note.voter), on === true)}
                      />
                    ) : null}
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
