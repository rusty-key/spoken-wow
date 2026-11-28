"use client";

import { AudioLines, Blend, Check, ChevronDown, ChevronRight, Eye, GitCompare, Loader2, MoreHorizontal, Pencil, RefreshCw, Save, Shuffle, SlidersHorizontal, Sparkles, Trash2, Undo2, Wand2, X } from "lucide-react";
import { useState, type ReactNode } from "react";

import Link from "@/components/LocaleLink";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useUiText } from "@/components/UiTextProvider";
import { withLang } from "@/lib/lang";
import { fill } from "@/lib/site-text/format";
import { cn } from "@/lib/utils";
import { isRevisable } from "@/lib/voice-design/groups";
import { designName, recommendedPreview } from "@/lib/voice-design/limits";
import type { JudgedDifference } from "@/lib/voice-design/difference";
import type { ClipMark, Design, Judge, Measures, Observation } from "@/lib/voice-design/types";

import DifferencePanel, { JUDGE_NAME, type Answer } from "./DifferencePanel";
import FeedbackResults, { pickKey, verdictLabels } from "./FeedbackResults";
import PlayButton, { ReferenceClip } from "./PlayButton";
import StatusBadge from "./StatusBadge";
import { designAudioUrl, designFrom, remixFrom, requestRevision, send, useWorkbench, type Draft } from "./context";
import RemixSettingsFields from "./RemixSettings";
import type { SlotView } from "./Workbench";

const day = (iso: string) => iso.slice(0, 10);

/** A two-call action's failure names its call: Gemini's and ElevenLabs' errors read alike. */
async function stage<T>(step: string, work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (err) {
    throw new Error(`${step} failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}
const one = (value: number) => value.toFixed(1);
const two = (value: number) => value.toFixed(2);

/** The s-level, which the pick mostly turns on; every other measure is in its tooltip. */
function MeasureLine({ measures }: { measures: Measures | null }) {
  const t = useUiText().voiceDesign;
  if (measures?.ess === undefined) return null;
  const { ess, decay, level, f0Hz, hnrDb, alphaRatioDb } = measures;
  const detail = [
    decay !== undefined && level !== undefined ? fill(t.previewMetrics, { ess: two(ess), decay: one(decay), level: one(level) }) : null,
    f0Hz !== undefined && hnrDb !== undefined && alphaRatioDb !== undefined
      ? `${fill(t.measures, { f0: Math.round(f0Hz), hnr: one(hnrDb), alpha: one(alphaRatioDb) })}\n${t.measuresTitle}`
      : null,
    t.previewMetricsTitle,
  ];
  return (
    <span className="vd-measures vd-tip" data-tip={detail.filter(Boolean).join("\n")} tabIndex={0}>
      {fill(t.essShort, { ess: two(ess) })}
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

/**
 * The newest verdict's marks on the lines the version has now. Marks from before the lines were
 * voiced again name other lines, and the server refuses a mark on a line that is gone. Preview
 * marks are left out: nothing here shows them, so they would ride along unseen.
 */
function currentMarks(design: Design): Record<string, ClipMark> {
  const last = design.reviews.at(-1);
  if (!last || (design.sampledAt && last.createdAt < design.sampledAt)) return {};
  const lines = new Set(design.samples.map((sample) => `sample:${sample.position}`));
  return Object.fromEntries(Object.entries(last.clips).filter(([key]) => lines.has(key)));
}

function Confirm({
  question,
  label,
  open,
  working,
  disabled,
  onCancel,
  onConfirm,
  trigger,
}: {
  question: string;
  label: string;
  open: boolean;
  working: boolean;
  disabled: boolean;
  onCancel: () => void;
  onConfirm: () => void;
  trigger: ReactNode;
}) {
  const t = useUiText().voiceDesign;
  if (!open) return trigger;
  return (
    <span className="vd-confirm">
      {question}
      <button type="button" className="bs-btn bs-btn-danger" disabled={disabled} onClick={onConfirm}>
        {working ? <Loader2 size={14} className="animate-spin" aria-hidden="true" /> : <Trash2 size={14} aria-hidden="true" />}
        {label}
      </button>
      <button type="button" className="bs-btn bs-btn-text" onClick={onCancel}>
        {t.cancel}
      </button>
    </span>
  );
}

function Marks({ value, onChange, disabled }: { value: ClipMark | undefined; onChange: (mark: ClipMark | undefined) => void; disabled: boolean }) {
  const t = useUiText().voiceDesign;
  return (
    <span className="vd-marks" role="group" aria-label={t.markLabel}>
      <button
        type="button"
        className="vd-mark vd-tip"
        data-mark="good"
        aria-pressed={value === "good"}
        disabled={disabled}
        onClick={() => onChange(value === "good" ? undefined : "good")}
        data-tip={t.markGoodTitle}
      >
        <Check size={14} aria-hidden="true" />
        <span className="sr-only">{t.markGood}</span>
      </button>
      <button
        type="button"
        className="vd-mark vd-tip"
        data-mark="off"
        aria-pressed={value === "off"}
        disabled={disabled}
        onClick={() => onChange(value === "off" ? undefined : "off")}
        data-tip={t.markOffTitle}
      >
        <X size={14} aria-hidden="true" />
        <span className="sr-only">{t.markOff}</span>
      </button>
    </span>
  );
}

/** What's different's findings on a verdict, labelled as what a judge observed rather than what the reviewer wants. */
function Observations({ items, version, onRemove }: { items: Observation[]; version: string; onRemove?: (index: number) => void }) {
  const t = useUiText().voiceDesign;
  return (
    <ul className="vd-review-players vd-observations" aria-label={t.observationsLabel}>
      {items.map((seen, index) => (
        <li key={`${seen.by}|${seen.note}`}>
          <span className="vd-tag">{fill(t.observedBy, { judge: JUDGE_NAME[seen.by], v: version })}</span> {seen.note}
          {onRemove ? (
            <button type="button" className="vd-mark vd-review-remove" title={t.removeObservation} onClick={() => onRemove(index)}>
              <X size={14} aria-hidden="true" />
              <span className="sr-only">{t.removeObservation}</span>
            </button>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

/** The newest version carries the slot's next step; an older one can only be started from again. */
export default function VersionCard({ design, slot, newest, folded = false }: { design: Design; slot: SlotView; newest: boolean; folded?: boolean }) {
  const t = useUiText().voiceDesign;
  // A folded card is its header alone, opened from the header.
  const [open, setOpen] = useState(!folded);
  const { lang, viewer, keys, rate, model, live, updateDesign, removeDesign, setDraft, remixSettings } = useWorkbench();
  const last = design.reviews.at(-1);
  const [note, setNote] = useState("");
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set());
  const verdictLabel = verdictLabels(t);
  const previewLine = slot.previewLines[design.previewText];
  const recommended = recommendedPreview(design.previews.map((preview) => preview.measures));
  const [clips, setClips] = useState<Record<string, ClipMark>>(() => currentMarks(design));
  // A removed verdict or lines voiced again: the marks start over from what still applies.
  const marksBasis = `${last?.id}|${design.samples.map((sample) => sample.sha256).join()}`;
  const [marksFor, setMarksFor] = useState(marksBasis);
  // Each judge's answer, by sample position; lines voiced again are other takes, so they go too.
  const [differences, setDifferences] = useState<Record<number, Partial<Record<Judge, Answer>>>>({});
  const [observations, setObservations] = useState<Observation[]>([]);
  if (marksFor !== marksBasis) {
    setMarksFor(marksBasis);
    setClips(currentMarks(design));
    setDifferences({});
  }
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmBack, setConfirmBack] = useState(false);
  const [removing, setRemoving] = useState<number | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [linesMenuOpen, setLinesMenuOpen] = useState(false);
  const [direction, setDirection] = useState("");

  const audio = (sha: string) => designAudioUrl(lang, sha);
  const holds = design.holderId === viewer.id;
  const hasVoice = design.voiceId !== null && design.voiceDeletedAt === null;
  const can = viewer.designs;
  const sampleChars = design.samples.length > 0 ? design.samples.reduce((sum, s) => sum + s.text.length, 0) : slot.sampleChars;
  const tag = `v${design.version}`;
  const again = design.samples.length > 0;
  const SampleIcon = busy === "sample" ? Loader2 : again ? RefreshCw : AudioLines;

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
    run(what, async () => {
      const { design, live } = await send<{ design: Design; live?: Record<string, string> }>(withLang(lang, url), init);
      updateDesign(design, live);
    });

  const sample = (lines: "same" | "other") =>
    act("sample", `/api/voices/design/${design.id}/samples`, { body: { lines, ...(direction.trim() ? { direction: direction.trim() } : {}) } });

  /**
   * The finding goes in as an observation of how the version sounds, never as the note: "slower"
   * observed means the reviewer likely wants faster. Its opposite joins the note, to edit, as the wish.
   */
  const addToReview = (difference: JudgedDifference) => {
    const fixes = difference.by === "claude" && difference.fixes.length > 0 ? { fixes: difference.fixes } : {};
    setObservations((current) =>
      current.some((seen) => seen.by === difference.by && seen.note === difference.note) ? current : [...current, { by: difference.by, note: difference.note, ...fixes }],
    );
    if (difference.wish) setNote((current) => (current.trim() ? `${current.trim()}; ${difference.wish}` : difference.wish));
  };

  // Every judge the viewer has a key for, side by side; one failing leaves the other's answer.
  const judges = (["gemini", "claude"] as const).filter((judge) => (judge === "gemini" ? keys.gemini : keys.anthropic));
  const compare = (position: number) =>
    run(`difference-${position}`, async () => {
      setDifferences((current) => ({ ...current, [position]: {} }));
      await Promise.all(
        judges.map(async (by) => {
          let answer: Answer;
          try {
            answer = await send<{ difference: JudgedDifference }>(withLang(lang, `/api/voices/design/${design.id}/difference`), { body: { position, by } });
          } catch (err) {
            answer = { error: `${JUDGE_NAME[by]}: ${err instanceof Error ? err.message : String(err)}` };
          }
          setDifferences((current) => ({ ...current, [position]: { ...current[position], [by]: answer } }));
        }),
      );
    });

  // A slot has one public version: the one players heard before is not public any more.
  const show = () =>
    run("show", async () => {
      const { design: shown } = await send<{ design: Design }>(withLang(lang, `/api/voices/design/${design.id}/show`), { body: {} });
      updateDesign(shown);
      for (const other of slot.designs) if (other.id !== shown.id && other.isPublic) updateDesign({ ...other, isPublic: false });
    });

  const mark = (key: string, value: ClipMark | undefined) =>
    setClips((current) => {
      const next = { ...current };
      if (value) next[key] = value;
      else delete next[key];
      return next;
    });

  const revisable = isRevisable(design);
  const revision = () => requestRevision(lang, design, fill(t.geminiRevision, { v: tag }));
  const revise = () => run("revise", async () => setDraft(slot.name, await revision()));
  // Only the holder can remix: the voice is in their account and the call spends from their key.
  const remixable = hasVoice && holds;
  const remixDraft = (from: Partial<Draft>) => ({
    prompt: design.prompt,
    previewText: design.previewText,
    analysisId: design.analysisId,
    ...from,
    from: tag,
    remix: { id: design.id, version: design.version },
  });
  /**
   * Gemini's revision, then straight to Voice Design or Voice Remix. If that second call fails, the
   * paid-for draft waits in the form; if it succeeds, a draft left open would revise the old version.
   */
  const fromReview = <D extends Draft>(what: string, step: string, toDraft: (revised: Draft) => D, make: (draft: D) => Promise<Design[]>) =>
    run(what, async () => {
      const draft = toDraft(await stage("Gemini revision", revision));
      try {
        updateDesign(await stage(step, () => make(draft)));
        setDraft(slot.name, null);
      } catch (err) {
        setDraft(slot.name, draft);
        throw err;
      }
    });
  const generate = () => fromReview("generate", "Voice Design", (draft) => draft, (draft) => designFrom(lang, slot.name, draft));
  const remixFromReview = () => fromReview("remix", "Voice Remix", remixDraft, (draft) => remixFrom(lang, draft, remixSettings));

  return (
    <section className="vd-version" aria-label={fill(t.versionLabel, { slot: slot.name, v: design.version })}>
      <header className={cn("vd-version-head", folded && "vd-version-head-fold", !open && "vd-version-head-closed")} onClick={folded ? () => setOpen(!open) : undefined}>
        {folded ? (
          <button
            type="button"
            className="vd-fold-toggle"
            aria-expanded={open}
            aria-label={tag}
            onClick={(event) => {
              // The header toggles too; without this the press would toggle twice.
              event.stopPropagation();
              setOpen(!open);
            }}
          >
            <ChevronRight className="vd-chevron" size={16} aria-hidden="true" />
          </button>
        ) : null}
        <span className="vd-version-tag">{tag}</span>
        <StatusBadge doneness={last?.status ?? "pending"} />
        {design.isPublic ? (
          <span className="vd-tag vd-tag-gold" title={t.publicTagTitle}>
            {t.publicTag}
          </span>
        ) : null}
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
      </header>
      {open ? (
        <>

          <div className="vd-version-body">
            <div className="vd-prompt">
              <p className="bs-label">{t.promptLabel}</p>
              <p className="bs-text">{design.prompt}</p>
              <p className="bs-label vd-gap">{t.previewTextLabel}</p>
              <p className="bs-text bs-text-en">{design.previewText}</p>
              <Field label={t.archetypeLabel} value={design.analysis?.archetype} />
              <Field label={t.heardLabel} value={design.analysis?.revision_heard} />
              {typeof design.analysis?.remix_of === "number" ? (
                <Field label={fill(t.remixOf, { v: `v${design.analysis.remix_of}` })} value={design.analysis.remix_changes} />
              ) : null}
              <Field label={t.designNoteLabel} value={design.note} />
            </div>

            <div className="vd-clips">
              <p className="bs-label">{t.previewsLabel}</p>
              <ul className="vd-cliplist">
                <li className="vd-clip">
                  <ReferenceClip slot={slot} />
                </li>
                {previewLine ? (
                  <li className="vd-clip">
                    <PlayButton
                      clip={{ src: previewLine.src, title: previewLine.npcName, meta: `${t.liveTake} · ${previewLine.lineId}`, subtitle: design.previewText }}
                      live
                    >
                      {t.liveTake}
                    </PlayButton>
                    <span className="vd-muted">{previewLine.npcName}</span>
                  </li>
                ) : null}
                {design.previews.map((preview, index) => (
                  <li key={preview.sha256 + index} className="vd-clip">
                    <PlayButton
                      clip={{ src: audio(preview.sha256), title: `${slot.name} ${tag}`, meta: fill(t.previewN, { n: index + 1 }), subtitle: design.previewText }}
                    >
                      {fill(t.previewN, { n: index + 1 })}
                    </PlayButton>
                    {can && !hasVoice ? (
                      <button
                        type="button"
                        className={cn("bs-btn vd-tip", recommended === index && "bs-btn-primary")}
                        data-tip={design.isPublic ? t.lockedTitle : fill(t.saveCost, { name: designName(design) })}
                        disabled={busy !== null || !keys.elevenlabs || design.isPublic}
                        onClick={() => void act(`save-${index}`, `/api/voices/design/${design.id}/voice`, { body: { preview: index } })}
                      >
                        {busy === `save-${index}` ? <Loader2 size={14} className="animate-spin" aria-hidden="true" /> : <Save size={14} aria-hidden="true" />}
                        {t.saveAsVoice}
                      </button>
                    ) : null}
                    {recommended === index && design.previews.length > 1 ? (
                      <span className="vd-tag" title={t.recommendedTitle}>
                        {t.recommended}
                      </span>
                    ) : null}
                    {design.chosenPreview === index && hasVoice ? (
                      <span className="vd-tag vd-tag-gold" title={t.savedTitle}>
                        {t.saved}
                      </span>
                    ) : null}
                    <MeasureLine measures={preview.measures} />
                  </li>
                ))}
              </ul>
              {/* Before a preview is saved, a version whose previews are all wrong can simply go. */}
              {can && newest && design.voiceId === null && slot.designs[1] ? (
                <div className="vd-step">
                  <Confirm
                    question={fill(t.backConfirm, { v: tag, previous: `v${slot.designs[1].version}` })}
                    label={fill(t.backDelete, { v: tag })}
                    open={confirmBack}
                    working={busy === "back"}
                    disabled={busy !== null}
                    onCancel={() => setConfirmBack(false)}
                    onConfirm={() =>
                      void run("back", async () => {
                        await send(withLang(lang, `/api/voices/design/${design.id}`), { method: "DELETE" });
                        removeDesign(design);
                      })
                    }
                    trigger={
                      <button type="button" className="bs-btn" title={t.backTitle} disabled={busy !== null} onClick={() => setConfirmBack(true)}>
                        <Undo2 size={14} aria-hidden="true" />
                        {fill(t.back, { previous: `v${slot.designs[1].version}` })}
                      </button>
                    }
                  />
                </div>
              ) : null}
            </div>

            <div className="vd-samples">
              <p className="bs-label">{t.samplesLabel}</p>
              {can && design.samples.length > 0 ? <p className="vd-muted vd-marks-hint">{t.marksHint}</p> : null}
              {design.samples.length === 0 ? <p className="vd-muted">{hasVoice ? t.noSamples : t.saveFirst}</p> : null}
              <ul className="vd-cliplist">
                {design.samples.map((sample) => {
                  const now = live[sample.lineId];
                  const key = `sample:${sample.position}`;
                  return (
                    <li key={sample.position} className="vd-sample">
                      <div className="vd-sample-text">
                        <span className="vd-npc">{sample.npcName ?? sample.lineId}</span>
                        <p className="bs-text">{sample.text}</p>
                      </div>
                      <div className="vd-sample-play">
                        <PlayButton clip={{ src: audio(sample.sha256), title: sample.npcName ?? slot.name, meta: `${tag} · ${sample.lineId}`, subtitle: sample.text }}>
                          {t.newTake}
                        </PlayButton>
                        {now ? (
                          <PlayButton
                            clip={{ src: now, title: sample.npcName ?? slot.name, meta: `${t.liveTake} · ${sample.lineId}`, subtitle: sample.text }}
                            live
                          >
                            {t.liveTake}
                          </PlayButton>
                        ) : (
                          <span className="vd-muted">{t.noLiveTake}</span>
                        )}
                        {now && can ? (
                          <button
                            type="button"
                            className="bs-btn"
                            title={judges.length > 0 ? t.differenceTitle : t.differenceNoKey}
                            disabled={busy !== null || judges.length === 0}
                            onClick={() => void compare(sample.position)}
                          >
                            {busy === `difference-${sample.position}` ? (
                              <Loader2 size={14} className="animate-spin" aria-hidden="true" />
                            ) : (
                              <GitCompare size={14} aria-hidden="true" />
                            )}
                            {t.difference}
                          </button>
                        ) : null}
                        {can ? <Marks value={clips[key]} onChange={(m) => mark(key, m)} disabled={busy !== null} /> : null}
                      </div>
                      {differences[sample.position] ? (
                        <DifferencePanel answers={differences[sample.position]} version={tag} can={can} onAdd={addToReview} />
                      ) : null}
                    </li>
                  );
                })}
              </ul>
              {can && hasVoice ? (
                <div className="vd-step">
                  {holds ? (
                    <>
                      <input
                        className="vd-note-input vd-direction-input"
                        value={direction}
                        maxLength={200}
                        placeholder={t.sampleDirectionPlaceholder}
                        aria-label={t.sampleDirectionLabel}
                        title={t.sampleDirectionTitle}
                        disabled={busy !== null}
                        onChange={(event) => setDirection(event.target.value)}
                      />
                      <span className={cn(again && "vd-split")}>
                        <button
                          type="button"
                          className={cn("bs-btn", again && "vd-btn-again")}
                          title={design.isPublic ? t.resampleShownTitle : undefined}
                          disabled={busy !== null || !keys.elevenlabs}
                          onClick={() => void sample("same")}
                        >
                          <SampleIcon size={14} className={busy === "sample" ? "animate-spin" : undefined} aria-hidden="true" />
                          {again ? t.resample : t.sample}
                        </button>
                        {again ? (
                          <Popover open={linesMenuOpen} onOpenChange={setLinesMenuOpen}>
                            <PopoverTrigger asChild>
                              <button type="button" className="bs-btn vd-btn-again" aria-label={t.resampleMore} title={t.resampleMore} disabled={busy !== null || !keys.elevenlabs}>
                                <ChevronDown size={14} aria-hidden="true" />
                              </button>
                            </PopoverTrigger>
                            <PopoverContent align="start" side="top" className="vd-more-menu">
                              <button
                                type="button"
                                onClick={() => {
                                  setLinesMenuOpen(false);
                                  void sample("other");
                                }}
                              >
                                <Shuffle size={14} aria-hidden="true" />
                                {t.resampleOther}
                              </button>
                            </PopoverContent>
                          </Popover>
                        ) : null}
                      </span>
                      <span className="vd-cost">{fill(t.sampleCost, { credits: Math.round(sampleChars * rate), model })}</span>
                    </>
                  ) : (
                    <span className="vd-muted">{fill(t.holderOnly, { who: design.holderName ?? t.someone })}</span>
                  )}
                </div>
              ) : null}
              {can && design.samples.length > 0 ? (
                <div className="vd-step">
                  <button
                    type="button"
                    className={cn("bs-btn", (!design.isPublic || design.playersHearOlderLines) && "bs-btn-primary")}
                    title={t.showToPlayersTitle}
                    disabled={busy !== null}
                    onClick={() => void show()}
                  >
                    {busy === "show" ? <Loader2 size={14} className="animate-spin" aria-hidden="true" /> : <Eye size={14} aria-hidden="true" />}
                    {design.isPublic ? t.showingAgain : t.showToPlayers}
                  </button>
                  {design.playersHearOlderLines ? <span className="vd-cost">{t.playersHearOlder}</span> : null}
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
                  {review.observations.length > 0 ? <Observations items={review.observations} version={tag} /> : null}
                  {review.players.length > 0 ? (
                    <ul className="vd-review-players" aria-label={t.pickedNotesLabel}>
                      {review.players.map((pick, index) => (
                        <li key={index}>
                          <span className="vd-tag" data-verdict={pick.verdict}>
                            {verdictLabel[pick.verdict]}
                          </span>{" "}
                          {pick.note}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                  {can ? (
                    <Confirm
                      question={t.removeReviewConfirm}
                      label={t.removeReview}
                      open={removing === review.id}
                      working={busy === "unreview"}
                      disabled={busy !== null}
                      onCancel={() => setRemoving(null)}
                      onConfirm={async () => {
                        await act("unreview", `/api/voices/design/${design.id}/reviews/${review.id}`, { method: "DELETE" });
                        setRemoving(null);
                      }}
                      trigger={
                        <button
                          type="button"
                          className="vd-mark vd-review-remove"
                          title={t.removeReviewTitle}
                          disabled={busy !== null}
                          onClick={() => setRemoving(review.id)}
                        >
                          <X size={14} aria-hidden="true" />
                          <span className="sr-only">{t.removeReviewTitle}</span>
                        </button>
                      }
                    />
                  ) : null}
                </li>
              ))}
            </ol>
          ) : null}

          <FeedbackResults
            design={design}
            can={can}
            disabled={busy !== null}
            onHide={(showingId, voter) => void act("hide", `/api/voices/design/${design.id}/feedback`, { method: "DELETE", body: { showingId, voter } })}
            picked={picked}
            onPick={(key, on) =>
              setPicked((current) => {
                const next = new Set(current);
                if (on) next.add(key);
                else next.delete(key);
                return next;
              })
            }
          />

          {can ? (
            <div className="vd-review-form">
              {observations.length > 0 ? (
                <Observations items={observations} version={tag} onRemove={(index) => setObservations((current) => current.filter((_, i) => i !== index))} />
              ) : null}
              <input
                className="vd-note-input"
                value={note}
                maxLength={2000}
                placeholder={t.notePlaceholderWork}
                aria-label={t.noteLabel}
                onChange={(event) => setNote(event.target.value)}
              />
              <div className="vd-verdict-actions" title={design.reviews.length > 0 ? t.addReviewTitle : undefined}>
                {(["good", "needs-work"] as const).map((value) => (
                  <button
                    key={value}
                    type="button"
                    className="bs-btn vd-verdict-option"
                    data-status={value}
                    disabled={busy !== null}
                    onClick={async () => {
                      // Only notes still listed: one hidden since it was ticked has no box left to untick.
                      const players = design.showings.flatMap((showing) =>
                        showing.notes.filter((n) => picked.has(pickKey(showing.id, n.voter))).map((n) => ({ showingId: showing.id, voter: n.voter })),
                      );
                      const ok = await act(`review-${value}`, `/api/voices/design/${design.id}/reviews`, { body: { status: value, note, clips, players, observations } });
                      if (ok) {
                        setNote("");
                        setPicked(new Set());
                        setObservations([]);
                      }
                    }}
                  >
                    {busy === `review-${value}` ? <Loader2 size={14} className="animate-spin" aria-hidden="true" /> : null}
                    {value === "good" ? t.statusGood : t.statusNeedsWork}
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          {can ? (
            <div className="vd-version-foot">
              {newest && revisable ? (
                <button
                  type="button"
                  className="bs-btn vd-btn-go"
                  title={t.generateCost}
                  disabled={busy !== null || !keys.gemini || !keys.elevenlabs}
                  onClick={() => void generate()}
                >
                  {busy === "generate" ? <Loader2 size={14} className="animate-spin" aria-hidden="true" /> : <Wand2 size={14} aria-hidden="true" />}
                  {busy === "generate" ? t.generating : t.generate}
                </button>
              ) : null}
              {newest && revisable && remixable ? (
                <span className="vd-split">
                  <button
                    type="button"
                    className="bs-btn vd-btn-remix"
                    title={t.remixCost}
                    disabled={busy !== null || !keys.gemini || !keys.elevenlabs}
                    onClick={() => void remixFromReview()}
                  >
                    {busy === "remix" ? <Loader2 size={14} className="animate-spin" aria-hidden="true" /> : <Blend size={14} aria-hidden="true" />}
                    {busy === "remix" ? t.remixing : t.remix}
                  </button>
                  <Popover>
                    <PopoverTrigger asChild>
                      <button type="button" className="bs-btn vd-btn-remix" aria-label={t.remixSettings} title={t.remixSettings}>
                        <SlidersHorizontal size={14} aria-hidden="true" />
                      </button>
                    </PopoverTrigger>
                    <PopoverContent align="start" side="top" className="vd-pop">
                      <RemixSettingsFields />
                    </PopoverContent>
                  </Popover>
                </span>
              ) : null}
              <Popover open={menuOpen} onOpenChange={setMenuOpen}>
                <PopoverTrigger asChild>
                  <button type="button" className="bs-btn bs-btn-text" aria-label={t.moreActions} title={t.moreActions}>
                    {busy === "revise" ? <Loader2 size={14} className="animate-spin" aria-hidden="true" /> : <MoreHorizontal size={16} aria-hidden="true" />}
                  </button>
                </PopoverTrigger>
                <PopoverContent align="start" side="top" className="vd-more-menu">
                  {newest && revisable ? (
                    <button
                      type="button"
                      title={t.reviseCost}
                      disabled={busy !== null || !keys.gemini}
                      onClick={() => {
                        setMenuOpen(false);
                        void revise();
                      }}
                    >
                      <Sparkles size={14} aria-hidden="true" />
                      {t.revise}
                    </button>
                  ) : null}
                  <button
                    type="button"
                    title={t.branchTitle}
                    onClick={() => {
                      setMenuOpen(false);
                      setDraft(slot.name, { prompt: design.prompt, previewText: design.previewText, analysisId: design.analysisId, from: tag });
                    }}
                  >
                    <Pencil size={14} aria-hidden="true" />
                    {fill(t.branch, { v: tag })}
                  </button>
                  {remixable ? (
                    <button
                      type="button"
                      title={t.remixByHandTitle}
                      onClick={() => {
                        setMenuOpen(false);
                        setDraft(slot.name, remixDraft({ changes: "" }));
                      }}
                    >
                      <Blend size={14} aria-hidden="true" />
                      {fill(t.remixByHand, { v: tag })}
                    </button>
                  ) : null}
                </PopoverContent>
              </Popover>
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
                <span className="vd-push">
                  <Confirm
                    question={t.deleteConfirm}
                    label={t.deleteVoice}
                    open={confirmDelete}
                    working={busy === "delete"}
                    disabled={busy !== null}
                    onCancel={() => setConfirmDelete(false)}
                    onConfirm={async () => {
                      await act("delete", `/api/voices/design/${design.id}/voice`, { method: "DELETE" });
                      setConfirmDelete(false);
                    }}
                    trigger={
                      <button type="button" className="bs-btn bs-btn-danger" title={t.deleteTitle} onClick={() => setConfirmDelete(true)}>
                        <Trash2 size={14} aria-hidden="true" />
                        {t.deleteVoice}
                      </button>
                    }
                  />
                </span>
              ) : null}
            </div>
          ) : null}

          {error ? (
            <p role="alert" className="vd-error">
              {error}
            </p>
          ) : null}
        </>
      ) : null}
    </section>
  );
}
