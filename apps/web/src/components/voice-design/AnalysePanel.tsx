"use client";

import { Ear, Loader2 } from "lucide-react";
import { useState } from "react";

import { useUiText } from "@/components/UiTextProvider";
import { withLang } from "@/lib/lang";
import { fill } from "@/lib/site-text/format";
import { flavorOf } from "@/lib/voice-design/groups";
import type { Analysis } from "@/lib/voice-design/types";

import { send, useWorkbench } from "./context";
import type { SlotView } from "./Workbench";

const one = (value: number) => value.toFixed(1);
const RANKINGS = ["deepest_to_highest", "roughest_to_smoothest", "most_to_least_menacing", "most_to_least_authoritative"] as const;
const DESCRIBED = ["apparent_age", "pitch", "timbre", "texture", "attitude_persona", "processing"] as const;

/** Analyse: Gemini hears the group's flavors blind; its letters are revealed here, after the fact. */
export default function AnalysePanel({ group, analysis, slots }: { group: string; analysis: Analysis | null; slots: SlotView[] }) {
  const t = useUiText().voiceDesign;
  const { lang, viewer, keys, updateAnalysis, setDraft } = useWorkbench();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [missing, setMissing] = useState<string[]>([]);
  const withClips = slots.filter((slot) => slot.reference).length;
  const name = (label: string) => {
    const slot = analysis?.labels[label];
    return slot ? (flavorOf(slot) ?? slot) : label;
  };
  const described: Record<(typeof DESCRIBED)[number], string> = {
    apparent_age: t.fieldAge,
    pitch: t.fieldPitch,
    timbre: t.fieldTimbre,
    texture: t.fieldTexture,
    attitude_persona: t.fieldAttitude,
    processing: t.fieldProcessing,
  };
  const ranking: Record<(typeof RANKINGS)[number], string> = {
    deepest_to_highest: t.rankDeepest,
    roughest_to_smoothest: t.rankRoughest,
    most_to_least_menacing: t.rankMenacing,
    most_to_least_authoritative: t.rankAuthoritative,
  };

  async function analyse() {
    setBusy(true);
    setError(null);
    try {
      const result = await send<{ analysis: Analysis; missing: string[] }>(withLang(lang, "/api/voices/design/analyse"), { body: { group } });
      updateAnalysis(result.analysis);
      setMissing(result.missing);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  if (!analysis && !viewer.designs) return null;

  return (
    <section className="vd-analysis" aria-label={t.analysisLabel}>
      <div className="vd-analysis-head">
        <div>
          <p className="vd-analysis-title">{t.analysisLabel}</p>
          <p className="vd-muted">
            {analysis
              ? fill(t.analysedBy, { who: analysis.createdByName ?? t.someone, when: analysis.createdAt.slice(0, 10) })
              : withClips >= 2
                ? t.analysisNone
                : t.analysisNeedsClips}
          </p>
        </div>
        {viewer.designs ? (
          <div className="vd-step">
            <button type="button" className="bs-btn" disabled={busy || !keys.gemini || withClips < 2} onClick={() => void analyse()}>
              {busy ? <Loader2 size={14} className="animate-spin" aria-hidden="true" /> : <Ear size={14} aria-hidden="true" />}
              {busy ? t.analysing : analysis ? t.analyseAgain : t.analyse}
            </button>
            <span className="vd-cost">{t.analyseCost}</span>
          </div>
        ) : null}
      </div>

      {missing.length > 0 ? <p className="vd-muted">{fill(t.analysisMissing, { slots: missing.join(", ") })}</p> : null}
      {error ? (
        <p role="alert" className="vd-error">
          {error}
        </p>
      ) : null}

      {analysis ? (
        <>
          <div className="vd-flavors">
            {Object.entries(analysis.result.voices).map(([label, voice]) => {
              const slot = analysis.labels[label];
              const measures = analysis.measurements?.[label];
              return (
                <article key={label} className="vd-flavor">
                  <header className="vd-flavor-head">
                    <span className="vd-version-tag">{label}</span>
                    <span className="vd-flavor-name">{slot}</span>
                    {voice.archetype ? <span className="vd-muted">{voice.archetype}</span> : null}
                  </header>
                  {measures ? (
                    <p className="vd-measures">
                      {fill(t.measures, { f0: Math.round(measures.f0Hz), hnr: one(measures.hnrDb), alpha: one(measures.alphaRatioDb) })}
                    </p>
                  ) : null}
                  <dl className="vd-described">
                    {DESCRIBED.filter((field) => voice[field]).map((field) => (
                      <div key={field}>
                        <dt>{described[field]}</dt>
                        <dd>{voice[field]}</dd>
                      </div>
                    ))}
                  </dl>
                  {viewer.designs && slot ? (
                    <button
                      type="button"
                      className="bs-btn bs-btn-text"
                      onClick={() => {
                        setDraft(slot, {
                          prompt: voice.voice_design_prompt,
                          previewText: voice.preview_text,
                          analysisId: analysis.id,
                          from: t.geminiDraft,
                        });
                        document.getElementById(`slot-${slot}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
                      }}
                    >
                      {t.useDraft}
                    </button>
                  ) : null}
                </article>
              );
            })}
          </div>
          <dl className="vd-rankings">
            {RANKINGS.filter((key) => analysis.result.rankings?.[key]?.length).map((key) => (
              <div key={key}>
                <dt>{ranking[key]}</dt>
                <dd>{analysis.result.rankings![key].map(name).join(" › ")}</dd>
              </div>
            ))}
          </dl>
        </>
      ) : null}
    </section>
  );
}
