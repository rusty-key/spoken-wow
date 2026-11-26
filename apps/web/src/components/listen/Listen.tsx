"use client";

import { ChevronLeft, ChevronRight, LayoutList, Pause, Play, Search, SquareStack } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import AudioPlayer from "@/components/AudioPlayer";
import { useUiText } from "@/components/UiTextProvider";
import { withLang, type Lang } from "@/lib/lang";
import { fill } from "@/lib/site-text/format";
import { cn } from "@/lib/utils";
import type { Verdict } from "@/lib/voice-design/types";
import type { OwnVote, PublicVoice } from "@/lib/voice-feedback/public";

import VoteControls from "./VoteControls";

type Filter = "all" | "unvoted" | "voted";
type View = "table" | "cards";
type Clip = { src: string; title: string; subtitle: string };

const capital = (word: string) => word.charAt(0).toUpperCase() + word.slice(1);

/** `orc-male-shady` reads Orc · Male · Shady. */
export const voiceName = (voice: PublicVoice) =>
  [voice.race, voice.gender, ...(voice.flavor ? voice.flavor.split("-") : [])].map(capital).join(" · ");

function shuffled<T>(items: readonly T[]): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

export default function Listen({ lang, voices, votes: initialVotes }: { lang: Lang; voices: PublicVoice[]; votes: Record<number, OwnVote> }) {
  const t = useUiText().listen;
  const [votes, setVotes] = useState(initialVotes);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [view, setView] = useState<View>("table");
  // Shuffled after mount, so the server's render matches the first client one.
  const [order, setOrder] = useState<string[]>(() => voices.map((voice) => voice.slot));
  const [at, setAt] = useState(0);
  const [playing, setPlaying] = useState<Clip | null>(null);
  const [sounding, setSounding] = useState(false);
  const audio = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    setOrder(shuffled(voices.map((voice) => voice.slot)));
    if (window.matchMedia?.("(max-width: 640px)").matches) setView("cards");
  }, [voices]);

  // Started as soon as the bar has the new source: a play button that only loads would need a second press.
  useEffect(() => {
    if (playing) void audio.current?.play().catch(() => {});
  }, [playing]);

  const play = (clip: Clip) => {
    const el = audio.current;
    if (el && playing?.src === clip.src) void (el.paused ? el.play().catch(() => {}) : el.pause());
    else setPlaying(clip);
  };

  const needle = query.trim().toLowerCase();
  const matches = (voice: PublicVoice) =>
    (!needle || [voice.race, voice.gender, voice.flavor ?? ""].join(" ").toLowerCase().includes(needle)) &&
    (filter === "all" || (filter === "voted") === (voice.showingId in votes));
  const listed = voices.filter(matches);
  const bySlot = useMemo(() => new Map(voices.map((voice) => [voice.slot, voice])), [voices]);
  const cards = order.map((slot) => bySlot.get(slot)).filter((voice): voice is PublicVoice => voice !== undefined && matches(voice));
  const current = cards[Math.min(at, cards.length - 1)];

  const counts: Record<Filter, number> = {
    all: voices.length,
    voted: voices.filter((voice) => voice.showingId in votes).length,
    unvoted: voices.filter((voice) => !(voice.showingId in votes)).length,
  };

  async function vote(voice: PublicVoice, verdict: Verdict, note: string) {
    const response = await fetch(withLang(lang, "/api/listen/votes"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ showingId: voice.showingId, verdict, note }),
    });
    const body = (await response.json().catch(() => ({}))) as { error?: string };
    if (!response.ok) throw new Error(body.error ?? `${response.status}`);
    setVotes((known) => ({ ...known, [voice.showingId]: { verdict, note } }));
  }

  const lines = (voice: PublicVoice, spelled: boolean) => (
    <ul className={cn("ls-lines", spelled && "ls-lines-spelled")}>
      {voice.samples.map((sample, index) => {
        const src = withLang(lang, `/api/listen/audio/${sample.sha256}`);
        const on = sounding && playing?.src === src;
        const Icon = on ? Pause : Play;
        const said = sample.npcName ? `${sample.npcName}: ${sample.text}` : sample.text;
        return (
          <li key={sample.sha256}>
            <button
              type="button"
              className={cn("vd-play", on && "vd-play-on")}
              aria-pressed={on}
              title={spelled ? undefined : said}
              onClick={() => play({ src, title: voiceName(voice), subtitle: said })}
            >
              <Icon size={13} aria-hidden="true" />
              {fill(t.lineN, { n: index + 1 })}
            </button>
            {spelled ? <span className="ls-line-text">{said}</span> : null}
          </li>
        );
      })}
    </ul>
  );

  const filterLabel: Record<Filter, string> = { all: t.filterAll, unvoted: t.filterUnvoted, voted: t.filterVoted };

  return (
    <div className="ls">
      <div className="vd-toolbar">
        <div className="bs-chips" role="group" aria-label={t.filterLabel}>
          {(["all", "unvoted", "voted"] as Filter[]).map((value) => (
            <button
              key={value}
              type="button"
              className="bs-chip"
              aria-current={filter === value ? "page" : undefined}
              onClick={() => {
                setFilter(value);
                setAt(0);
              }}
            >
              {filterLabel[value]}
              <span className="bs-count">{counts[value]}</span>
            </button>
          ))}
        </div>
        <label className="bs-search vd-search">
          <Search size={15} aria-hidden="true" />
          <input
            type="search"
            value={query}
            placeholder={t.searchPlaceholder}
            aria-label={t.searchPlaceholder}
            onChange={(event) => {
              setQuery(event.target.value);
              setAt(0);
            }}
          />
        </label>
        <button type="button" className="bs-btn ls-view" onClick={() => setView(view === "table" ? "cards" : "table")}>
          {view === "table" ? <SquareStack size={14} aria-hidden="true" /> : <LayoutList size={14} aria-hidden="true" />}
          {view === "table" ? t.cardsView : t.tableView}
        </button>
      </div>

      {voices.length === 0 ? (
        <p className="vd-muted">{t.none}</p>
      ) : listed.length === 0 ? (
        <p className="vd-muted">{filter === "unvoted" && !needle ? t.allDone : t.noMatch}</p>
      ) : view === "table" ? (
        <table className="ls-table">
          <thead>
            <tr>
              <th scope="col">{t.columnVoice}</th>
              <th scope="col">{t.columnCharacter}</th>
              <th scope="col">{t.columnLines}</th>
              <th scope="col">{t.columnVote}</th>
            </tr>
          </thead>
          <tbody>
            {listed.map((voice) => (
              <tr key={voice.showingId}>
                <th scope="row" className="ls-name">
                  {voiceName(voice)}
                </th>
                <td className="vd-muted">{voice.archetype}</td>
                <td>{lines(voice, false)}</td>
                <td>
                  <VoteControls key={voice.showingId} vote={votes[voice.showingId]} onVote={(verdict, note) => vote(voice, verdict, note)} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : current ? (
        <section className="ls-card" aria-label={voiceName(current)}>
          <h2 className="ls-card-name">{voiceName(current)}</h2>
          {current.archetype ? <p className="vd-muted">{current.archetype}</p> : null}
          {lines(current, true)}
          <p className="bs-label">{t.question}</p>
          <VoteControls key={current.showingId} vote={votes[current.showingId]} onVote={(verdict, note) => vote(current, verdict, note)} />
          <nav className="ls-card-nav">
            <button type="button" className="bs-btn" disabled={at === 0} onClick={() => setAt(at - 1)}>
              <ChevronLeft size={14} aria-hidden="true" />
              {t.previous}
            </button>
            <span className="vd-muted">{fill(t.position, { n: Math.min(at, cards.length - 1) + 1, total: cards.length })}</span>
            <button type="button" className="bs-btn" disabled={at >= cards.length - 1} onClick={() => setAt(at + 1)}>
              {t.next}
              <ChevronRight size={14} aria-hidden="true" />
            </button>
          </nav>
        </section>
      ) : null}

      {playing ? (
        <div className="fixed inset-x-0 bottom-0 z-40">
          <AudioPlayer audioRef={audio} onPlayingChange={setSounding} src={playing.src} title={playing.title} subtitle={playing.subtitle} />
        </div>
      ) : null}
    </div>
  );
}
