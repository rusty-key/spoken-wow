"use client";

import { Loader2, Wand2 } from "lucide-react";
import { useState } from "react";

import { useUiText } from "@/components/UiTextProvider";
import { withLang } from "@/lib/lang";
import { fill } from "@/lib/site-text/format";
import { DESIGN_LIMITS, PREVIEWS_PER_DESIGN, promptLengthProblem, promptProblems, withEnding } from "@/lib/voice-design/limits";
import type { Design } from "@/lib/voice-design/types";

import { send, useWorkbench, type Draft } from "./context";
import type { SlotView } from "./Workbench";

const { promptMax, textMin, textMax } = DESIGN_LIMITS;

export default function DesignForm({ slot, initial, onDone }: { slot: SlotView; initial: Draft | null; onDone: () => void }) {
  const t = useUiText().voiceDesign;
  const { lang, keys, updateDesign } = useWorkbench();
  const [prompt, setPrompt] = useState(initial?.prompt ?? "");
  const [previewText, setPreviewText] = useState(initial?.previewText ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const problems = promptProblems(prompt);
  // Counted as sent: the server adds the ending, and the limit is on the whole prompt.
  const lengthProblem = promptLengthProblem(prompt);
  const promptOk = lengthProblem === null;
  const textOk = previewText.trim().length >= textMin && previewText.trim().length <= textMax;
  // Voice Design bills about the preview text for each preview it makes.
  const cost = previewText.trim().length * PREVIEWS_PER_DESIGN;

  async function design() {
    setBusy(true);
    setError(null);
    try {
      const { design } = await send<{ design: Design }>(withLang(lang, "/api/voices/design"), {
        body: { slot: slot.name, prompt, previewText, analysisId: initial?.analysisId ?? null, revisionHeard: initial?.heard ?? null },
      });
      updateDesign(design);
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
      {initial ? <p className="vd-muted">{fill(t.startedFrom, { from: initial.from })}</p> : null}
      {initial?.heard ? (
        <p className="vd-heard">
          <span className="bs-label">{t.heardLabel}</span> {initial.heard}
        </p>
      ) : null}
      <label className="vd-field">
        <span className="bs-label">{t.promptLabel}</span>
        <textarea className="bs-textarea vd-input" rows={5} value={prompt} onChange={(event) => setPrompt(event.target.value)} />
        <span className="vd-hint" data-bad={prompt.length > 0 && !promptOk ? "" : undefined}>
          {fill(t.promptHint, { n: withEnding(prompt).length, max: promptMax })}
        </span>
        {problems.words.length > 0 ? <span className="vd-hint" data-bad="">{fill(t.harshWords, { words: problems.words.join(", ") })}</span> : null}
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
      {error ? (
        <p role="alert" className="vd-error">
          {error}
        </p>
      ) : null}
      <div className="vd-form-actions">
        <button type="submit" className="bs-btn bs-btn-primary" disabled={busy || !promptOk || !textOk || !keys.elevenlabs}>
          {busy ? <Loader2 size={14} className="animate-spin" aria-hidden="true" /> : <Wand2 size={14} aria-hidden="true" />}
          {busy ? t.designing : t.designButton}
        </button>
        <button type="button" className="bs-btn bs-btn-text" onClick={onDone} disabled={busy}>
          {t.cancel}
        </button>
        <span className="vd-cost">{fill(t.designCost, { credits: cost })}</span>
      </div>
    </form>
  );
}
