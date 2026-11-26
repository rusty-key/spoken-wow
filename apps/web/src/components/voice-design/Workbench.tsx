"use client";

import { ChevronRight, Loader2, Search, Wand2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import AudioPlayer from "@/components/AudioPlayer";
import { useLang } from "@/components/LangProvider";
import Link from "@/components/LocaleLink";
import { useUiText } from "@/components/UiTextProvider";
import { fill } from "@/lib/site-text/format";
import { DONENESS, donenessOf, isRevisable, type Doneness } from "@/lib/voice-design/groups";
import { PREVIEWS_PER_DESIGN } from "@/lib/voice-design/limits";
import type { Analysis, Design } from "@/lib/voice-design/types";

import AnalysePanel from "./AnalysePanel";
import ImportForm from "./ImportForm";
import SlotRow from "./SlotRow";
import { designFrom, requestRevision, WorkbenchContext, type Draft, type Playing, type Workbench as WorkbenchState } from "./context";


export type SlotView = {
  name: string;
  group: string;
  lineCount: number;
  npcs: string[];
  /** Where the slot's game clip plays, or null when it has none on the site. */
  reference: string | null;
  candidates: string[];
  /** The slot's lines that preview texts were taken from, by text. */
  previewLines: Record<string, { lineId: string; npcName: string; src: string }>;
  /** Characters of the default sample lines, for the cost before Sample is pressed. */
  sampleChars: number;
  /** Newest version first. */
  designs: Design[];
};

export type GroupView = { group: string; analysis: Analysis | null; slots: SlotView[] };


type Filter = "all" | Doneness;

const capital = (word: string) => word.charAt(0).toUpperCase() + word.slice(1);

/** What a search matches: the slot's name and who uses it, and every version's prompt and notes. */
function haystack(slot: SlotView): string {
  return [
    slot.name,
    ...slot.npcs,
    ...slot.designs.flatMap((design) => [design.prompt, design.previewText, ...design.reviews.map((review) => review.note)]),
  ]
    .join("\n")
    .toLowerCase();
}

export default function Workbench({
  groups: initialGroups,
  live: initialLive,
  viewer,
  keys,
  rate,
  model,
}: {
  groups: GroupView[];
  live: Record<string, string>;
  viewer: WorkbenchState["viewer"];
  keys: { elevenlabs: boolean; gemini: boolean };
  rate: number;
  model: string;
}) {
  const t = useUiText().voiceDesign;
  const lang = useLang();
  const [groups, setGroups] = useState(initialGroups);
  const [live, setLive] = useState(initialLive);
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [playing, setPlaying] = useState<Playing | null>(null);
  const [generatingAll, setGeneratingAll] = useState<{ done: number; total: number } | null>(null);
  const [confirmAll, setConfirmAll] = useState(false);
  const [generateLog, setGenerateLog] = useState<string[]>([]);
  const [sounding, setSounding] = useState(false);
  const audio = useRef<HTMLAudioElement | null>(null);

  // Started as soon as the bar has the new source: a play button that only loads would need a second press.
  useEffect(() => {
    if (playing) void audio.current?.play().catch(() => {});
  }, [playing]);

  const doneness = (slot: SlotView): Doneness => donenessOf(slot.designs[0] ?? null);
  const counts = useMemo(() => {
    const all = groups.flatMap((group) => group.slots);
    return Object.fromEntries([["all", all.length], ...DONENESS.map((d) => [d, all.filter((slot) => doneness(slot) === d).length])]) as Record<Filter, number>;
  }, [groups]);

  const needle = query.trim().toLowerCase();
  const shown = groups
    .map((group) => ({
      ...group,
      slots: group.slots.filter((slot) => (filter === "all" || doneness(slot) === filter) && (!needle || haystack(slot).includes(needle))),
    }))
    .filter((group) => group.slots.length > 0);
  const races = [...new Set(shown.map((group) => group.group.split("-")[0]))];
  const narrowed = filter !== "all" || needle !== "";

  const context = {
    lang,
    viewer,
    keys,
    rate,
    model,
    live,
    play: (clip: Playing) => {
      const el = audio.current;
      if (el && playing?.src === clip.src) void (el.paused ? el.play().catch(() => {}) : el.pause());
      else setPlaying(clip);
    },
    isPlaying: (src: string) => sounding && playing?.src === src,
    drafts,
    setDraft: (slot: string, draft: Draft | null) => {
      setDrafts((current) => {
        const next = { ...current };
        if (draft) next[slot] = draft;
        else delete next[slot];
        return next;
      });
      // The form may open far from the button pressed; it exists once this render lands.
      if (draft) setTimeout(() => document.getElementById(`design-${slot}`)?.scrollIntoView({ behavior: "smooth", block: "center" }));
    },
    updateDesign: (design: Design, takes?: Record<string, string>) => {
      if (takes) setLive((current) => ({ ...current, ...takes }));
      setGroups((current) =>
        current.map((group) => ({
          ...group,
          slots: group.slots.map((slot) => {
            if (slot.name !== design.slot) return slot;
            const others = slot.designs.filter((d) => d.id !== design.id);
            return { ...slot, designs: [...others, design].sort((a, b) => b.version - a.version) };
          }),
        })),
      );
    },
    updateAnalysis: (analysis: Analysis) =>
      setGroups((current) => current.map((group) => (group.group === analysis.group ? { ...group, analysis } : group))),
  };

  const toGenerate =
    filter !== "needs-work" ? [] : shown.flatMap((group) => group.slots).filter((slot) => slot.designs[0] && isRevisable(slot.designs[0]));
  // Gemini may change the preview text's length; the old one is the estimate Voice Design bills by.
  const allCredits = toGenerate.reduce((sum, slot) => sum + slot.designs[0].previewText.length * PREVIEWS_PER_DESIGN, 0);
  async function generateAll() {
    setConfirmAll(false);
    setGenerateLog([]);
    // One slot at a time: Gemini answers a burst of revisions with 429s.
    for (const [index, slot] of toGenerate.entries()) {
      setGeneratingAll({ done: index, total: toGenerate.length });
      const design = slot.designs[0];
      let draft: Draft | null = null;
      try {
        draft = await requestRevision(lang, design, fill(t.geminiRevision, { v: `v${design.version}` }));
        context.updateDesign(await designFrom(lang, slot.name, draft));
        setDrafts(({ [slot.name]: _, ...rest }) => rest);
      } catch (err) {
        // A paid-for draft whose design failed waits in the slot's form.
        if (draft) setDrafts((current) => ({ ...current, [slot.name]: draft! }));
        setGenerateLog((lines) => [...lines, `${slot.name}: ${err instanceof Error ? err.message : String(err)}`]);
      }
    }
    setGeneratingAll(null);
  }

  const label: Record<Filter, string> = {
    all: t.filterAll,
    none: t.statusNone,
    pending: t.statusPending,
    "needs-work": t.statusNeedsWork,
    good: t.statusGood,
  };

  return (
    <WorkbenchContext.Provider value={context}>
      <div className="vd-toolbar">
        <div className="bs-chips" role="group" aria-label={t.filterLabel}>
          {(["all", ...DONENESS] as Filter[]).map((value) => (
            <button
              key={value}
              type="button"
              className="bs-chip"
              aria-current={filter === value ? "page" : undefined}
              onClick={() => setFilter(value)}
            >
              {label[value]}
              <span className="bs-count">{counts[value]}</span>
            </button>
          ))}
        </div>
        <label className="bs-search vd-search">
          <Search size={15} aria-hidden="true" />
          <input type="search" value={query} placeholder={t.searchPlaceholder} aria-label={t.searchPlaceholder} onChange={(event) => setQuery(event.target.value)} />
        </label>
      </div>

      {viewer.designs && filter === "needs-work" ? (
        <div className="vd-revise-all">
          {confirmAll ? (
            <span className="vd-confirm">
              {fill(t.generateAllConfirm, { n: toGenerate.length, credits: allCredits })}
              <button type="button" className="bs-btn vd-btn-go" onClick={() => void generateAll()}>
                <Wand2 size={14} aria-hidden="true" />
                {t.generateAllGo}
              </button>
              <button type="button" className="bs-btn bs-btn-text" onClick={() => setConfirmAll(false)}>
                {t.cancel}
              </button>
            </span>
          ) : (
            <>
              <button
                type="button"
                className="bs-btn vd-btn-go"
                disabled={generatingAll !== null || toGenerate.length === 0 || !keys.gemini || !keys.elevenlabs}
                onClick={() => setConfirmAll(true)}
              >
                {generatingAll ? <Loader2 size={14} className="animate-spin" aria-hidden="true" /> : <Wand2 size={14} aria-hidden="true" />}
                {generatingAll
                  ? fill(t.generateAllProgress, { n: generatingAll.done + 1, total: generatingAll.total })
                  : fill(t.generateAll, { n: toGenerate.length })}
              </button>
              <span className="vd-cost">{toGenerate.length > 0 ? fill(t.generateAllCost, { credits: allCredits }) : t.generateAllNone}</span>
            </>
          )}
          {generateLog.length > 0 ? (
            <ul className="vd-import-log" role="alert">
              {generateLog.map((line, index) => (
                <li key={index}>{line}</li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

      {viewer.designs && (!keys.elevenlabs || !keys.gemini) ? (
        <p className="vd-note">
          {!keys.elevenlabs ? t.needsElevenLabsKey : t.needsGeminiKey}{" "}
          <Link href={!keys.elevenlabs ? "/profile#elevenlabs-key" : "/profile#gemini-key"} className="vd-link">
            {t.profileLink}
          </Link>
        </p>
      ) : null}
      {!viewer.designs ? <p className="vd-note">{t.readOnly}</p> : null}

      {shown.length === 0 ? <p className="vd-empty">{t.nothingMatches}</p> : null}

      {races.map((race) => (
        <section key={race} className="vd-race" aria-labelledby={`race-${race}`}>
          <h2 id={`race-${race}`} className="vd-race-title">
            {capital(race)}
          </h2>
          {shown
            .filter((group) => group.group.split("-")[0] === race)
            .map((group) => {
              const states = group.slots.map(doneness);
              return (
                <details
                  key={`${group.group}:${narrowed}`}
                  className="vd-group"
                  open={narrowed || group.slots.some((slot) => slot.designs.length > 0) || undefined}
                >
                  <summary className="vd-group-head">
                    <ChevronRight className="vd-chevron" size={16} aria-hidden="true" />
                    <span className="vd-group-title">{capital(group.group.split("-")[1] ?? group.group)}</span>
                    <span className="vd-group-counts">
                      {fill(t.groupCounts, {
                        slots: group.slots.length,
                        good: states.filter((s) => s === "good").length,
                        work: states.filter((s) => s === "needs-work").length,
                      })}
                    </span>
                  </summary>
                  <div className="vd-group-body">
                    <AnalysePanel group={group.group} analysis={group.analysis} slots={group.slots} />
                    {group.slots.map((slot) => (
                      <SlotRow key={slot.name} slot={slot} doneness={doneness(slot)} />
                    ))}
                  </div>
                </details>
              );
            })}
        </section>
      ))}

      {viewer.admin ? <ImportForm /> : null}

      {playing ? (
        <div className="fixed inset-x-0 bottom-0 z-40">
          <AudioPlayer audioRef={audio} onPlayingChange={setSounding} src={playing.src} title={playing.title} meta={playing.meta} subtitle={playing.subtitle} />
        </div>
      ) : null}
    </WorkbenchContext.Provider>
  );
}
