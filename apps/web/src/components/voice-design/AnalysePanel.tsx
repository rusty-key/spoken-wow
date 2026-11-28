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

/** Shared by the button in the group's header and the panel below it. */
export type CompareBlind = { busy: boolean; error: string | null; missing: string[]; run: () => Promise<void> };

export function useCompareBlind(group: string): CompareBlind {
  const { lang, updateAnalysis } = useWorkbench();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [missing, setMissing] = useState<string[]>([]);
  async function run() {
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
  return { busy, error, missing, run };
}

/** Inside the group's summary, where a press would also fold the group. */
export function CompareBlindButton({ compare, analysis, slots }: { compare: CompareBlind; analysis: Analysis | null; slots: SlotView[] }) {
  const t = useUiText().voiceDesign;
  const { viewer, keys } = useWorkbench();
  if (!viewer.designs) return null;
  const withClips = slots.filter((slot) => slot.reference).length;
  const tip = [withClips >= 2 ? t.analysisNone : t.analysisNeedsClips, t.gameClipNote, t.analyseCost].join("\n\n");
  return (
    <span className="vd-tip vd-tip-below vd-group-action" data-tip={tip} tabIndex={0}>
      <button
        type="button"
        className="bs-btn"
        disabled={compare.busy || !keys.gemini || withClips < 2}
        onClick={(event) => {
          event.preventDefault();
          void compare.run();
        }}
      >
        {compare.busy ? <Loader2 size={14} className="animate-spin" aria-hidden="true" /> : <Ear size={14} aria-hidden="true" />}
        {compare.busy ? t.analysing : analysis ? t.analyseAgain : t.analyse}
      </button>
    </span>
  );
}

/** Gemini's blind comparison; its letters are revealed here, after the fact. */
export default function AnalysePanel({ analysis, compare: { error, missing } }: { analysis: Analysis | null; compare: CompareBlind }) {
  const t = useUiText().voiceDesign;
  const { viewer, setDraft } = useWorkbench();
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

  if (!analysis && !error && missing.length === 0) return null;

  return (
    <section className="vd-analysis" aria-label={t.analysisLabel}>
      {analysis ? (
        <div>
          <p className="vd-analysis-title">{t.analysisLabel}</p>
          <p className="vd-muted">{fill(t.analysedBy, { who: analysis.createdByName ?? t.someone, when: analysis.createdAt.slice(0, 10) })}</p>
        </div>
      ) : null}

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
                  {measures?.f0Hz !== undefined && measures.hnrDb !== undefined && measures.alphaRatioDb !== undefined ? (
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
