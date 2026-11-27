"use client";

import { ChevronLeft, ChevronRight, LayoutList, Pause, Play, Search, SquareStack } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import AudioPlayer from "@/components/AudioPlayer";
import { useUiText } from "@/components/UiTextProvider";
import { send } from "@/components/voice-design/context";
import { withLang, type Lang } from "@/lib/lang";
import { fill } from "@/lib/site-text/format";
import { cn } from "@/lib/utils";
import type { Verdict } from "@/lib/voice-design/types";
import { slotLabel } from "@/lib/voice-feedback/label";
import type { OwnVote, PublicVoice } from "@/lib/voice-feedback/public";

import VoteControls from "./VoteControls";

type Filter = "all" | "unvoted" | "voted";
type View = "table" | "cards";
type Clip = { src: string; title: string; subtitle: string };


const viewIn = (hash: string): View | null => (hash === "#table" || hash === "#cards" ? (hash.slice(1) as View) : null);

/** Who the voice is for: Gemini's archetype when it wrote one, and the NPCs players hear it from. */
function Character({ voice }: { voice: PublicVoice }) {
  return (
    <>
      {voice.archetype ? <p className="ls-archetype">{voice.archetype}</p> : null}
      {voice.examples.length > 0 ? <p className="vd-muted">{voice.examples.join(", ")}</p> : null}
    </>
  );
}

export default function Listen({
  lang,
  voices,
  dealt = voices,
  votes: initialVotes,
}: {
  lang: Lang;
  voices: PublicVoice[];
  /** The cards' order, shuffled by the server so the first card the page shows is the one it keeps. */
  dealt?: PublicVoice[];
  votes: Record<number, OwnVote>;
}) {
  const t = useUiText().listen;
  const [votes, setVotes] = useState(initialVotes);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [view, setView] = useState<View>("cards");
  // The votes the filter was set against: a voice voted since stays in the list, so its note
  // field does not vanish under the cursor.
  const [filteredBy, setFilteredBy] = useState(initialVotes);
  // Cards deal out what was left to vote on when they were opened, in random order, unfiltered.
  const [cardsFrom, setCardsFrom] = useState(initialVotes);
  const [at, setAt] = useState(0);
  const [playing, setPlaying] = useState<Clip | null>(null);
  const [sounding, setSounding] = useState(false);
  const audio = useRef<HTMLAudioElement | null>(null);

  // Cards unless the address asks for `#table`, so a link can open either.
  useEffect(() => {
    const follow = () => {
      if (viewIn(window.location.hash) === "table") setView("table");
      else openCards();
    };
    follow();
    window.addEventListener("hashchange", follow);
    return () => window.removeEventListener("hashchange", follow);
    // openCards reads the votes at the moment the view opens; re-subscribing on each vote buys nothing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Started as soon as the bar has the new source: a play button that only loads would need a second press.
  useEffect(() => {
    if (playing) void audio.current?.play().catch(() => {});
  }, [playing]);

  const play = (clip: Clip) => {
    const el = audio.current;
    if (el && playing?.src === clip.src) void (el.paused ? el.play().catch(() => {}) : el.pause());
    else setPlaying(clip);
  };

  function chooseFilter(value: Filter) {
    setFilter(value);
    setFilteredBy(votes);
  }

  function choose(next: View) {
    window.history.replaceState(null, "", `#${next}`);
    if (next === "cards") openCards();
    else setView("table");
  }

  function openCards() {
    setView("cards");
    setCardsFrom(votes);
    setAt(0);
  }

  const needle = query.trim().toLowerCase();
  const matches = (voice: PublicVoice) =>
    (!needle || [voice.race, voice.gender, voice.flavor ?? ""].join(" ").toLowerCase().includes(needle)) &&
    (filter === "all" || (filter === "voted") === voice.showingId in filteredBy);
  const listed = voices.filter(matches);
  const cards = dealt.filter((voice) => !(voice.showingId in cardsFrom));
  const current = cards[Math.min(at, cards.length - 1)];

  const counts: Record<Filter, number> = {
    all: voices.length,
    voted: voices.filter((voice) => voice.showingId in votes).length,
    unvoted: voices.filter((voice) => !(voice.showingId in votes)).length,
  };

  async function vote(voice: PublicVoice, verdict: Verdict, note: string) {
    await send(withLang(lang, "/api/listen/votes"), { body: { showingId: voice.showingId, verdict, note } });
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
              onClick={() => play({ src, title: slotLabel(voice.slot), subtitle: said })}
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
        {view === "table" ? (
          <>
            <div className="bs-chips" role="group" aria-label={t.filterLabel}>
              {(["all", "unvoted", "voted"] as Filter[]).map((value) => (
                <button
                  key={value}
                  type="button"
                  className="bs-chip"
                  aria-current={filter === value ? "page" : undefined}
                  onClick={() => chooseFilter(value)}
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
                onChange={(event) => setQuery(event.target.value)}
              />
            </label>
          </>
        ) : null}
        <button type="button" className="bs-btn ls-view" onClick={() => choose(view === "table" ? "cards" : "table")}>
          {view === "table" ? <SquareStack size={14} aria-hidden="true" /> : <LayoutList size={14} aria-hidden="true" />}
          {view === "table" ? t.cardsView : t.tableView}
        </button>
      </div>

      {voices.length === 0 ? (
        <p className="vd-muted">{t.none}</p>
      ) : view === "table" && listed.length === 0 ? (
        <p className="vd-muted">{filter === "unvoted" && !needle ? t.allDone : t.noMatch}</p>
      ) : view === "cards" && cards.length === 0 ? (
        <p className="vd-muted">{t.allDone}</p>
      ) : view === "table" ? (
        <table className="ls-table">
          <thead>
            <tr>
              <th scope="col">{t.columnVoice}</th>
              <th scope="col">{t.columnCharacter}</th>
              <th scope="col">{t.columnLines}</th>
              <th scope="col">{t.columnVote}</th>
              <th scope="col">{t.noteLabel}</th>
            </tr>
          </thead>
          <tbody>
            {listed.map((voice) => (
              <tr key={voice.showingId}>
                <th scope="row" className="ls-name">
                  {slotLabel(voice.slot)}
                </th>
                <td className="ls-character">
                  <Character voice={voice} />
                </td>
                <td>{lines(voice, false)}</td>
                <VoteControls
                  key={voice.showingId}
                  cells
                  vote={votes[voice.showingId]}
                  onVote={(verdict, note) => vote(voice, verdict, note)}
                />
              </tr>
            ))}
          </tbody>
        </table>
      ) : current ? (
        <section className="ls-card" aria-label={slotLabel(current.slot)}>
          <h2 className="ls-card-name">{slotLabel(current.slot)}</h2>
          <div className="ls-character">
            <Character voice={current} />
          </div>
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
