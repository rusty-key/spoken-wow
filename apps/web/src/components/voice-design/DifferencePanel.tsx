"use client";

import { Plus } from "lucide-react";

import { useUiText } from "@/components/UiTextProvider";
import { fill } from "@/lib/site-text/format";
import type { JudgedDifference } from "@/lib/voice-design/difference";
import type { Weight } from "@/lib/voice-design/judging";
import { JUDGES, type Judge } from "@/lib/voice-design/types";

const MATTERS = { high: "mattersHigh", medium: "mattersMedium", low: "mattersLow" } as const satisfies Record<Weight, string>;
const HEADING = { gemini: "differenceGemini", claude: "differenceClaude" } as const satisfies Record<Judge, string>;

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
  const judges = JUDGES.filter((judge) => answers[judge]);
  if (judges.length === 0) return null;
  return (
    <div className="vd-difference">
      {judges.map((judge) => {
        const answer = answers[judge]!;
        const heading = t[HEADING[judge]];
        return (
          <section key={judge} className="vd-difference-judge" aria-label={heading}>
            <p className="bs-label">{heading}</p>
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
                          {t[MATTERS[aspect.matters]]}
                        </span>
                      ) : null}{" "}
                      <span className="bs-label">{aspect.aspect}</span> {t.liveTake}: {aspect.live} · {t.newTake}: {aspect.new}
                      {aspect.reference ? ` · ${t.differenceReference}: ${aspect.reference}` : ""}
                    </li>
                  ))}
                </ul>
                {answer.difference.fixes?.length ? (
                  <>
                    <p className="bs-label">{t.differenceFixes}</p>
                    <ul>
                      {answer.difference.fixes.map((fix, index) => (
                        <li key={index}>{fix}</li>
                      ))}
                    </ul>
                  </>
                ) : null}
                {answer.difference.image ? (
                  <details>
                    <summary>{t.differencePicture}</summary>
                    {/* A data URL the route made from the clips; next/image has nothing to optimise. */}
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img className="vd-difference-picture" loading="lazy" src={`data:image/png;base64,${answer.difference.image}`} alt={t.differencePicture} />
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
