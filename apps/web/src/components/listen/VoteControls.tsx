"use client";

import { Loader2 } from "lucide-react";
import { useState } from "react";

import { useUiText } from "@/components/UiTextProvider";
import { VERDICTS, type Verdict } from "@/lib/voice-design/types";
import type { OwnVote } from "@/lib/voice-feedback/public";

/**
 * The four answers and the optional note. A note always goes with an answer: typed first, it
 * rides along with the answer pressed; typed after, Save note sends it with the same answer.
 */
export default function VoteControls({
  vote,
  onVote,
  cells = false,
}: {
  vote: OwnVote | undefined;
  onVote: (verdict: Verdict, note: string) => Promise<void>;
  cells?: boolean;
}) {
  const t = useUiText().listen;
  const [note, setNote] = useState(vote?.note ?? "");
  const [busy, setBusy] = useState<Verdict | "note" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const label: Record<Verdict, string> = { fits: t.fits, close: t.close, off: t.off, skip: t.skip };
  const noteChanged = note.trim() !== (vote?.note ?? "");

  async function send(what: Verdict | "note", verdict: Verdict) {
    setBusy(what);
    setError(null);
    try {
      await onVote(verdict, note.trim());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  const verdicts = (
    <div className="ls-verdicts" role="group" aria-label={t.question}>
      {VERDICTS.map((verdict) => (
        <button
          key={verdict}
          type="button"
          className="bs-btn ls-verdict"
          data-verdict={verdict}
          aria-pressed={vote?.verdict === verdict}
          aria-busy={busy === verdict}
          disabled={busy !== null}
          onClick={() => void send(verdict, verdict)}
        >
          {/* Hidden, not removed, while it sends: the button keeps its width and nothing jumps. */}
          <span className="ls-verdict-label">{label[verdict]}</span>
          {busy === verdict ? <Loader2 size={14} className="ls-verdict-spinner animate-spin" aria-hidden="true" /> : null}
        </button>
      ))}
    </div>
  );

  const noteField = (
    <div className="ls-note-field">
      <textarea
        className="ls-note"
        rows={2}
        maxLength={2000}
        value={note}
        placeholder={t.notePlaceholder}
        aria-label={t.noteLabel}
        onChange={(event) => setNote(event.target.value)}
      />
      {vote && noteChanged ? (
        <button type="button" className="bs-btn bs-btn-primary ls-save" disabled={busy !== null} onClick={() => void send("note", vote.verdict)}>
          {busy === "note" ? <Loader2 size={14} className="animate-spin" aria-hidden="true" /> : null}
          {t.saveNote}
        </button>
      ) : !vote && note.trim() ? (
        <span className="vd-muted">{t.voteFirst}</span>
      ) : null}
      {error ? (
        <p className="ls-error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );

  if (cells) {
    return (
      <>
        <td>{verdicts}</td>
        <td className="ls-note-cell">{noteField}</td>
      </>
    );
  }
  return (
    <div className="ls-vote">
      {verdicts}
      {noteField}
    </div>
  );
}
