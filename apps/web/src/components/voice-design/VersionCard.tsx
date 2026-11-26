"use client";

import { Check, Loader2, Play, Save, Sparkles, Trash2, X } from "lucide-react";
import { useState } from "react";

import Link from "@/components/LocaleLink";
import { useUiText } from "@/components/UiTextProvider";
import { withLang } from "@/lib/lang";
import { fill } from "@/lib/site-text/format";
import { cn } from "@/lib/utils";
import { isRevisable, type ReviewStatus } from "@/lib/voice-design/groups";
import type { Revision } from "@/lib/voice-design/gemini";
import { designName, recommendedPreview } from "@/lib/voice-design/limits";
import type { ClipMark, Design, Measures } from "@/lib/voice-design/types";

import StatusBadge from "./StatusBadge";
import { send, useWorkbench } from "./context";
import type { SlotView } from "./Workbench";

const day = (iso: string) => iso.slice(0, 10);
const one = (value: number) => value.toFixed(1);

const two = (value: number) => value.toFixed(2);

/** What a preview is chosen by, then openSMILE's voice measures, each only when measured. */
function MeasureLine({ measures }: { measures: Measures | null }) {
  const t = useUiText().voiceDesign;
  if (!measures) return null;
  const { ess, decay, level, f0Hz, hnrDb, alphaRatioDb } = measures;
  return (
    <span className="vd-measure-lines">
      {ess !== undefined && decay !== undefined && level !== undefined ? (
        <span className="vd-measures" title={t.previewMetricsTitle}>
          {fill(t.previewMetrics, { ess: two(ess), decay: one(decay), level: one(level) })}
        </span>
      ) : null}
      {f0Hz !== undefined && hnrDb !== undefined && alphaRatioDb !== undefined ? (
        <span className="vd-measures" title={t.measuresTitle}>
          {fill(t.measures, { f0: Math.round(f0Hz), hnr: one(hnrDb), alpha: one(alphaRatioDb) })}
        </span>
      ) : null}
    </span>
  );
}

function Field({ label, value }: { label: string; value: unknown }) {
  if (typeof value !== "string" || !value) return null;
  return (
    <>
      <p className="bs-label vd-gap">{label}</p>
      <p className="bs-text bs-text-en">{value}</p>
    </>
  );
}

function Marks({ value, onChange, disabled }: { value: ClipMark | undefined; onChange: (mark: ClipMark | undefined) => void; disabled: boolean }) {
  const t = useUiText().voiceDesign;
  return (
    <span className="vd-marks" role="group" aria-label={t.markLabel}>
      <button
        type="button"
        className="vd-mark"
        data-mark="good"
        aria-pressed={value === "good"}
        disabled={disabled}
        onClick={() => onChange(value === "good" ? undefined : "good")}
        title={t.markGood}
      >
        <Check size={14} aria-hidden="true" />
        <span className="sr-only">{t.markGood}</span>
      </button>
      <button
        type="button"
        className="vd-mark"
        data-mark="off"
        aria-pressed={value === "off"}
        disabled={disabled}
        onClick={() => onChange(value === "off" ? undefined : "off")}
        title={t.markOff}
      >
        <X size={14} aria-hidden="true" />
        <span className="sr-only">{t.markOff}</span>
      </button>
    </span>
  );
}

export default function VersionCard({ design, slot }: { design: Design; slot: SlotView }) {
  const t = useUiText().voiceDesign;
  const { lang, viewer, keys, rate, model, live, play, playing, updateDesign, setDraft } = useWorkbench();
  const last = design.reviews.at(-1);
  const [status, setStatus] = useState<ReviewStatus | null>(last?.status ?? null);
  const [note, setNote] = useState("");
  const recommended = recommendedPreview(design.previews.map((preview) => preview.measures));
  const [best, setBest] = useState<number | null>(last?.bestPreview ?? design.chosenPreview ?? recommended);
  const [clips, setClips] = useState<Record<string, ClipMark>>(last?.clips ?? {});
  // A re-sample puts new lines behind the same `sample:<n>` keys: a mark on the old line must not
  // carry over to the new one.
  const sampled = design.samples.map((sample) => sample.sha256).join();
  const [marksFor, setMarksFor] = useState(sampled);
  if (marksFor !== sampled) {
    setMarksFor(sampled);
    setClips((current) => Object.fromEntries(Object.entries(current).filter(([key]) => !key.startsWith("sample:"))));
  }
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const audio = (sha: string) => withLang(lang, `/api/voices/design/audio/${sha}`);
  const holds = design.holderId === viewer.id;
  const hasVoice = design.voiceId !== null && design.voiceDeletedAt === null;
  const can = viewer.designs;
  const sampleChars = design.samples.length > 0 ? design.samples.reduce((sum, s) => sum + s.text.length, 0) : slot.sampleChars;
  const tag = `v${design.version}`;

  /** One action at a time per card, its failure said on the card. */
  async function run(what: string, work: () => Promise<void>): Promise<boolean> {
    setBusy(what);
    setError(null);
    try {
      await work();
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      return false;
    } finally {
      setBusy(null);
    }
  }

  const act = (what: string, url: string, init: { method?: string; body?: unknown } = {}) =>
    run(what, async () => updateDesign((await send<{ design: Design }>(withLang(lang, url), init)).design));

  const mark = (key: string, value: ClipMark | undefined) =>
    setClips((current) => {
      const next = { ...current };
      if (value) next[key] = value;
      else delete next[key];
      return next;
    });

  const isPlaying = (src: string) => playing?.src === src;

  const revisable = isRevisable(design);
  const revise = () =>
    run("revise", async () => {
      const { revision } = await send<{ revision: Revision }>(withLang(lang, `/api/voices/design/${design.id}/revise`));
      setDraft(slot.name, {
        prompt: revision.prompt,
        previewText: revision.preview_text,
        analysisId: null,
        heard: revision.heard,
        from: fill(t.geminiRevision, { v: tag }),
      });
    });

  return (
    <section className="vd-version" aria-label={fill(t.versionLabel, { slot: slot.name, v: design.version })}>
      <header className="vd-version-head">
        <span className="vd-version-tag">{tag}</span>
        <StatusBadge doneness={last?.status ?? "pending"} />
        <span className="vd-muted">
          {fill(t.madeBy, { who: design.createdByName ?? t.someone, when: day(design.createdAt) })}
        </span>
        {design.voiceName ? (
          <span className="vd-muted">
            {design.voiceDeletedAt
              ? fill(t.voiceDeleted, { name: design.voiceName })
              : fill(t.voiceIn, { name: design.voiceName, who: holds ? t.yourAccount : fill(t.theirAccount, { who: design.holderName ?? t.someone }) })}
          </span>
        ) : null}
        {can && revisable ? (
          <button
            type="button"
            className="bs-btn bs-btn-text vd-push"
            title={t.reviseCost}
            disabled={busy !== null || !keys.gemini}
            onClick={() => void revise()}
          >
            {busy === "revise" ? <Loader2 size={14} className="animate-spin" aria-hidden="true" /> : <Sparkles size={14} aria-hidden="true" />}
            {busy === "revise" ? t.revising : t.revise}
          </button>
        ) : null}
        {can ? (
          <button
            type="button"
            className={cn("bs-btn bs-btn-text", !revisable && "vd-push")}
            onClick={() => setDraft(slot.name, { prompt: design.prompt, previewText: design.previewText, analysisId: design.analysisId, from: tag })}
          >
            {fill(t.branch, { v: tag })}
          </button>
        ) : null}
      </header>

      <div className="vd-version-body">
        <div className="vd-prompt">
          <p className="bs-label">{t.promptLabel}</p>
          <p className="bs-text">{design.prompt}</p>
          <p className="bs-label vd-gap">{t.previewTextLabel}</p>
          <p className="bs-text bs-text-en">{design.previewText}</p>
          <Field label={t.archetypeLabel} value={design.analysis?.archetype} />
          <Field label={t.heardLabel} value={design.analysis?.revision_heard} />
          <Field label={t.designNoteLabel} value={design.note} />
        </div>

        <div className="vd-clips">
          <p className="bs-label">{t.previewsLabel}</p>
          <ul className="vd-cliplist">
            {design.previews.map((preview, index) => {
              const src = audio(preview.sha256);
              const key = `preview:${index}`;
              return (
                <li key={preview.sha256 + index} className="vd-clip">
                  <button
                    type="button"
                    className={cn("vd-play", isPlaying(src) && "vd-play-on")}
                    onClick={() => play({ src, title: `${slot.name} ${tag}`, meta: fill(t.previewN, { n: index + 1 }), subtitle: design.previewText })}
                  >
                    <Play size={13} aria-hidden="true" />
                    {fill(t.previewN, { n: index + 1 })}
                  </button>
                  {recommended === index && design.previews.length > 1 ? (
                    <span className="vd-tag" title={t.recommendedTitle}>
                      {t.recommended}
                    </span>
                  ) : null}
                  {design.chosenPreview === index && design.voiceName ? <span className="vd-tag vd-tag-gold">{t.saved}</span> : null}
                  <MeasureLine measures={preview.measures} />
                  {can ? (
                    <span className="vd-clip-end">
                      <label className="vd-radio">
                        <input type="radio" name={`best-${design.id}`} checked={best === index} onChange={() => setBest(index)} />
                        {t.best}
                      </label>
                      <Marks value={clips[key]} onChange={(m) => mark(key, m)} disabled={busy !== null} />
                    </span>
                  ) : null}
                </li>
              );
            })}
          </ul>

          {can && !design.voiceId ? (
            <div className="vd-step">
              <button
                type="button"
                className="bs-btn bs-btn-primary"
                disabled={busy !== null || best === null || !keys.elevenlabs}
                onClick={() => void act("save", `/api/voices/design/${design.id}/voice`, { body: { preview: best } })}
              >
                {busy === "save" ? <Loader2 size={14} className="animate-spin" aria-hidden="true" /> : <Save size={14} aria-hidden="true" />}
                {best === null ? t.pickPreview : fill(t.saveVoice, { n: best + 1 })}
              </button>
              <span className="vd-cost">{fill(t.saveCost, { name: designName(design) })}</span>
            </div>
          ) : null}
        </div>

        <div className="vd-samples">
          <p className="bs-label">{t.samplesLabel}</p>
          {design.samples.length === 0 ? <p className="vd-muted">{hasVoice ? t.noSamples : t.saveFirst}</p> : null}
          <ul className="vd-cliplist">
            {design.samples.map((sample) => {
              const src = audio(sample.sha256);
              const now = live[sample.lineId];
              const key = `sample:${sample.position}`;
              return (
                <li key={sample.position} className="vd-sample">
                  <div className="vd-sample-text">
                    <span className="vd-npc">{sample.npcName ?? sample.lineId}</span>
                    <p className="bs-text">{sample.text}</p>
                  </div>
                  <div className="vd-sample-play">
                    <button
                      type="button"
                      className={cn("vd-play", isPlaying(src) && "vd-play-on")}
                      onClick={() => play({ src, title: sample.npcName ?? slot.name, meta: `${tag} · ${sample.lineId}`, subtitle: sample.text })}
                    >
                      <Play size={13} aria-hidden="true" />
                      {t.newTake}
                    </button>
                    {now ? (
                      <button
                        type="button"
                        className={cn("vd-play", "vd-play-live", isPlaying(now) && "vd-play-on")}
                        onClick={() => play({ src: now, title: sample.npcName ?? slot.name, meta: `${t.liveTake} · ${sample.lineId}`, subtitle: sample.text })}
                      >
                        <Play size={13} aria-hidden="true" />
                        {t.liveTake}
                      </button>
                    ) : (
                      <span className="vd-muted">{t.noLiveTake}</span>
                    )}
                    {can ? <Marks value={clips[key]} onChange={(m) => mark(key, m)} disabled={busy !== null} /> : null}
                  </div>
                </li>
              );
            })}
          </ul>
          {can && hasVoice ? (
            <div className="vd-step">
              {holds ? (
                <>
                  <button
                    type="button"
                    className="bs-btn"
                    disabled={busy !== null || !keys.elevenlabs}
                    onClick={() => void act("sample", `/api/voices/design/${design.id}/samples`, { body: {} })}
                  >
                    {busy === "sample" ? <Loader2 size={14} className="animate-spin" aria-hidden="true" /> : <Play size={14} aria-hidden="true" />}
                    {design.samples.length > 0 ? t.resample : t.sample}
                  </button>
                  <span className="vd-cost">{fill(t.sampleCost, { credits: Math.round(sampleChars * rate), model })}</span>
                </>
              ) : (
                <span className="vd-muted">{fill(t.holderOnly, { who: design.holderName ?? t.someone })}</span>
              )}
            </div>
          ) : null}
        </div>
      </div>

      {design.reviews.length > 0 ? (
        <ol className="vd-reviews" aria-label={t.reviewsLabel}>
          {design.reviews.map((review) => (
            <li key={review.id} className="vd-review">
              <StatusBadge doneness={review.status} />
              <span className="vd-muted">
                {fill(t.reviewedBy, { who: review.createdByName ?? t.someone, when: day(review.createdAt) })}
                {review.bestPreview !== null ? ` · ${fill(t.bestWas, { n: review.bestPreview + 1 })}` : ""}
              </span>
              {review.note ? <span className="vd-review-note">{review.note}</span> : null}
            </li>
          ))}
        </ol>
      ) : null}

      {can ? (
        <form
          className="vd-review-form"
          onSubmit={async (event) => {
            event.preventDefault();
            if (!status) return;
            const ok = await act("review", `/api/voices/design/${design.id}/reviews`, { body: { status, note, bestPreview: best, clips } });
            if (ok) setNote("");
          }}
        >
          <div className="vd-verdict" role="radiogroup" aria-label={t.verdictLabel}>
            {(["good", "needs-work"] as const).map((value) => (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={status === value}
                className="vd-verdict-option"
                data-status={value}
                onClick={() => setStatus(value)}
              >
                {value === "good" ? t.statusGood : t.statusNeedsWork}
              </button>
            ))}
          </div>
          <input
            className="vd-note-input"
            value={note}
            maxLength={2000}
            placeholder={status === "needs-work" ? t.notePlaceholderWork : t.notePlaceholder}
            aria-label={t.noteLabel}
            onChange={(event) => setNote(event.target.value)}
          />
          <button type="submit" className="bs-btn" disabled={busy !== null || status === null}>
            {busy === "review" ? <Loader2 size={14} className="animate-spin" aria-hidden="true" /> : null}
            {t.saveReview}
          </button>
        </form>
      ) : null}

      {can && (last?.status === "good" || (hasVoice && holds)) ? (
        <div className="vd-version-foot">
          {last?.status === "good" && hasVoice ? (
            <span className="vd-muted">
              {t.adoptBefore}
              <Link href="/voices" className="vd-link">
                {t.voicesLink}
              </Link>
              {t.adoptAfter}
            </span>
          ) : null}
          {hasVoice && holds ? (
            confirmDelete ? (
              <span className="vd-confirm">
                {t.deleteConfirm}
                <button
                  type="button"
                  className="bs-btn bs-btn-danger"
                  disabled={busy !== null}
                  onClick={async () => {
                    await act("delete", `/api/voices/design/${design.id}/voice`, { method: "DELETE" });
                    setConfirmDelete(false);
                  }}
                >
                  {busy === "delete" ? <Loader2 size={14} className="animate-spin" aria-hidden="true" /> : <Trash2 size={14} aria-hidden="true" />}
                  {t.deleteVoice}
                </button>
                <button type="button" className="bs-btn bs-btn-text" onClick={() => setConfirmDelete(false)}>
                  {t.cancel}
                </button>
              </span>
            ) : (
              <button type="button" className="bs-btn bs-btn-text vd-push" onClick={() => setConfirmDelete(true)}>
                <Trash2 size={14} aria-hidden="true" />
                {t.deleteVoice}
              </button>
            )
          ) : null}
        </div>
      ) : null}

      {error ? (
        <p role="alert" className="vd-error">
          {error}
        </p>
      ) : null}
    </section>
  );
}
