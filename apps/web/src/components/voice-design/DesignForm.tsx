"use client";

import { Blend, Loader2, Wand2 } from "lucide-react";
import { useState } from "react";

import { useUiText } from "@/components/UiTextProvider";
import { withLang } from "@/lib/lang";
import { fill } from "@/lib/site-text/format";
import { DESIGN_LIMITS, PREVIEWS_PER_DESIGN, promptLengthProblem, promptProblems, REMIX_CHANGES_MAX, withEnding } from "@/lib/voice-design/limits";

import { designFrom, remixFrom, useWorkbench, type Draft } from "./context";
import RemixSettingsFields from "./RemixSettings";
import type { SlotView } from "./Workbench";

const { promptMax, textMin, textMax } = DESIGN_LIMITS;

export default function DesignForm({ slot, initial, onDone }: { slot: SlotView; initial: Draft | null; onDone: () => void }) {
  const t = useUiText().voiceDesign;
  const { lang, keys, updateDesign, remixSettings } = useWorkbench();
  // A remix sends ElevenLabs only the changes; the prompt is kept as the new voice's description.
  const remix = initial?.remix;
  const [changes, setChanges] = useState(initial?.changes ?? "");
  const [prompt, setPrompt] = useState(initial?.prompt ?? "");
  const [previewText, setPreviewText] = useState(initial?.previewText ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const problems = promptProblems(prompt);
  // Counted as sent: the server adds the ending, and the limit is on the whole prompt.
  const lengthProblem = promptLengthProblem(prompt);
  const changesOk = !remix || (changes.trim().length > 0 && changes.trim().length <= REMIX_CHANGES_MAX);
  const promptOk = lengthProblem === null;
  const textOk = previewText.trim().length >= textMin && previewText.trim().length <= textMax;
  // Voice Design bills about the preview text for each preview it makes; a remix, for its script.
  const cost = previewText.trim().length * (remix ? 1 : PREVIEWS_PER_DESIGN);
  const SubmitIcon = busy ? Loader2 : remix ? Blend : Wand2;

  async function design() {
    setBusy(true);
    setError(null);
    try {
      const draft = { ...initial, prompt, previewText, changes, analysisId: initial?.analysisId ?? null, from: initial?.from ?? "" };
      updateDesign(remix ? await remixFrom(lang, { ...draft, remix }, remixSettings) : await designFrom(lang, slot.name, draft));
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      className="vd-form"
      onSubmit={(event) => {
        event.preventDefault();
        void design();
      }}
    >
      {initial ? <p className="vd-muted">{fill(remix ? t.remixStarted : t.startedFrom, { from: initial.from })}</p> : null}
      {initial?.heard ? (
        <p className="vd-heard">
          <span className="bs-label">{t.heardLabel}</span> {initial.heard}
        </p>
      ) : null}
      {remix ? (
        <label className="vd-field">
          <span className="bs-label">{fill(t.changesLabel, { v: `v${remix.version}` })}</span>
          <textarea className="bs-textarea vd-input" rows={3} value={changes} onChange={(event) => setChanges(event.target.value)} />
          <span className="vd-hint" data-bad={changes.length > 0 && !changesOk ? "" : undefined}>
            {fill(t.changesHint, { n: changes.trim().length, max: REMIX_CHANGES_MAX })}
          </span>
        </label>
      ) : null}
      <label className="vd-field">
        <span className="bs-label">{t.promptLabel}</span>
        <textarea className="bs-textarea vd-input" rows={5} value={prompt} onChange={(event) => setPrompt(event.target.value)} />
        <span className="vd-hint" data-bad={prompt.length > 0 && !promptOk ? "" : undefined}>
          {fill(t.promptHint, { n: withEnding(prompt).length, max: promptMax })}
        </span>
        {problems.words.length > 0 ? (
          <span className="vd-hint" data-bad="">
            {fill(t.harshWords, { words: problems.words.join(", ") })}
          </span>
        ) : null}
        {prompt.trim() && problems.missingEnding ? (
          <span className="vd-hint" data-bad="">
            {t.endingMissing}{" "}
            <button type="button" className="vd-inline-btn" onClick={() => setPrompt(withEnding(prompt))}>
              {t.addEnding}
            </button>
          </span>
        ) : null}
      </label>
      <label className="vd-field">
        <span className="bs-label">{t.previewTextLabel}</span>
        <textarea className="bs-textarea vd-input" rows={3} value={previewText} onChange={(event) => setPreviewText(event.target.value)} />
        <span className="vd-hint" data-bad={previewText.length > 0 && !textOk ? "" : undefined}>
          {fill(t.previewTextHint, { n: previewText.trim().length, min: textMin })}
        </span>
      </label>
      {slot.candidates.length > 0 ? (
        <div className="vd-field">
          <span className="bs-label">{t.corpusLinesLabel}</span>
          <ul className="vd-candidates">
            {slot.candidates.map((text) => (
              <li key={text}>
                <button type="button" className="vd-candidate" onClick={() => setPreviewText(text)}>
                  {text}
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {remix ? <RemixSettingsFields /> : null}
      {error ? (
        <p role="alert" className="vd-error">
          {error}
        </p>
      ) : null}
      <div className="vd-form-actions">
        <button type="submit" className="bs-btn bs-btn-primary" disabled={busy || !promptOk || !changesOk || !textOk || !keys.elevenlabs}>
          <SubmitIcon size={14} className={busy ? "animate-spin" : undefined} aria-hidden="true" />
          {busy ? t.designing : remix ? t.remixButton : t.designButton}
        </button>
        <button type="button" className="bs-btn bs-btn-text" onClick={onDone} disabled={busy}>
          {t.cancel}
        </button>
        <span className="vd-cost">{fill(t.designCost, { credits: cost })}</span>
      </div>
    </form>
  );
}
