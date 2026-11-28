"use client";

import { Plus } from "lucide-react";

import { useUiText } from "@/components/UiTextProvider";
import { fill } from "@/lib/site-text/format";
import type { JudgedDifference } from "@/lib/voice-design/difference";
import type { Weight } from "@/lib/voice-design/gemini";
import type { Judge } from "@/lib/voice-design/types";

export const JUDGE_NAME: Record<Judge, string> = { gemini: "Gemini", claude: "Claude" };

type Words = ReturnType<typeof useUiText>["voiceDesign"];

const MATTERS: Record<Weight, (t: Words) => string> = {
  high: (t) => t.mattersHigh,
  medium: (t) => t.mattersMedium,
  low: (t) => t.mattersLow,
};

export type Answer = { difference: JudgedDifference } | { error: string };

export default function DifferencePanel({
  answers,
  version,
  can,
  onAdd,
}: {
  answers: Partial<Record<Judge, Answer>>;
  version: string;
  can: boolean;
  onAdd: (difference: JudgedDifference) => void;
}) {
  const t = useUiText().voiceDesign;
  const judges = (["gemini", "claude"] as const).filter((judge) => answers[judge]);
  if (judges.length === 0) return null;
  return (
    <div className="vd-difference">
      {judges.map((judge) => {
        const answer = answers[judge]!;
        return (
          <section key={judge} className="vd-difference-judge" aria-label={judge === "gemini" ? t.differenceGemini : t.differenceClaude}>
            <p className="bs-label">{judge === "gemini" ? t.differenceGemini : t.differenceClaude}</p>
            {"error" in answer ? (
              <p role="alert" className="vd-error">
                {answer.error}
              </p>
            ) : (
              <>
                <p className="bs-text">{answer.difference.summary}</p>
                <ul>
                  {answer.difference.aspects.map((aspect, index) => (
                    <li key={index}>
                      {aspect.matters ? (
                        <span className="vd-tag" data-matters={aspect.matters}>
                          {MATTERS[aspect.matters](t)}
                        </span>
                      ) : null}{" "}
                      <span className="bs-label">{aspect.aspect}</span> {t.liveTake}: {aspect.live} · {t.newTake}: {aspect.new}
                      {aspect.reference ? ` · ${t.differenceReference}: ${aspect.reference}` : ""}
                    </li>
                  ))}
                </ul>
                {answer.difference.by === "claude" && answer.difference.fixes.length > 0 ? (
                  <>
                    <p className="bs-label">{t.differenceFixes}</p>
                    <ul>
                      {answer.difference.fixes.map((fix, index) => (
                        <li key={index}>{fix}</li>
                      ))}
                    </ul>
                  </>
                ) : null}
                {answer.difference.by === "claude" && answer.difference.image ? (
                  <details>
                    <summary>{t.differencePicture}</summary>
                    {/* A data URL the route made from the clips; next/image has nothing to optimise. */}
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img className="vd-difference-picture" src={`data:image/png;base64,${answer.difference.image}`} alt={t.differencePicture} />
                  </details>
                ) : null}
                {can && answer.difference.note ? (
                  <button
                    type="button"
                    className="bs-btn vd-tip"
                    data-tip={fill(t.differenceToReviewTitle, { v: version })}
                    onClick={() => onAdd(answer.difference)}
                  >
                    <Plus size={14} aria-hidden="true" />
                    {t.differenceToReview}
                  </button>
                ) : null}
              </>
            )}
          </section>
        );
      })}
    </div>
  );
}
