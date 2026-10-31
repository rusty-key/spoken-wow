"use client";

import Image from "next/image";
import { useCallback, useEffect, useRef, useState } from "react";

import { timecode } from "@/lib/utils";

import { useArrowFocus } from "./useArrowFocus";
import type { Voice } from "./voices";

/** Smooth scrolling unless the visitor asks for less motion; the CSS rule does not reach scripted scrolls. */
const behavior = (): ScrollBehavior => (window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth");

/**
 * One recording from the voice packs: the speaker, a waveform that doubles as the seek bar, and
 * the words below it, lit as they are spoken by the start times measured against this audio. The
 * file downloads when it is played.
 */
function Clip({ voice, label, disabled = false }: { voice: Voice; label: string; disabled?: boolean }) {
  const audio = useRef<HTMLAudioElement>(null);
  const pending = useRef<number | null>(null);
  const text = useRef<HTMLParagraphElement>(null);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!playing) return;
    let frame = 0;
    const tick = () => {
      // Tenths of a second are enough for the words and the bar, and spare a render per frame.
      const now = audio.current?.currentTime ?? 0;
      setTime((was) => (Math.abs(now - was) >= 0.1 ? now : was));
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [playing]);

  const toggle = () => {
    const el = audio.current;
    if (!el) return;
    if (el.paused) {
      setFailed(false);
      // A play interrupted by a pause or by the player's removal rejects with AbortError.
      el.play().catch((error: DOMException) => {
        if (error.name !== "AbortError") setFailed(true);
      });
    } else el.pause();
  };

  const seek = (to: number) => {
    const el = audio.current;
    // With preload none there is no metadata before the first play, and Safari drops a seek until there is.
    if (el && el.readyState === 0) pending.current = to;
    else if (el) el.currentTime = to;
    setTime(to);
  };

  // The range moves in 50 ms steps for a pointer; a key press moves by seconds.
  const keySeek = (event: React.KeyboardEvent) => {
    const step = { ArrowLeft: -1, ArrowDown: -1, ArrowRight: 1, ArrowUp: 1, PageDown: -5, PageUp: 5 }[event.key];
    if (!step) return;
    event.preventDefault();
    seek(Math.min(voice.duration, Math.max(0, time + step)));
  };

  let current = -1;
  if (playing || time > 0) {
    voice.times.forEach((start, i) => {
      if (time >= start) current = i;
    });
  }
  const progress = time / voice.duration;

  // The text shows two lines; keep the word being spoken inside them.
  useEffect(() => {
    const box = text.current;
    const word = box?.querySelector<HTMLElement>(".now");
    if (!box) return;
    if (current < 0) box.scrollTo({ top: 0, behavior: behavior() });
    // Move only when the word falls outside the two lines showing, and then to the top line.
    else if (word && (word.offsetTop + word.offsetHeight > box.scrollTop + box.clientHeight || word.offsetTop < box.scrollTop)) {
      box.scrollTo({ top: word.offsetTop, behavior: behavior() });
    }
  }, [current]);

  return (
    <div className="bn-voice-card">
      <audio
        ref={audio}
        src={voice.audio || undefined}
        preload="none"
        onLoadedMetadata={() => {
          if (audio.current && pending.current !== null) audio.current.currentTime = pending.current;
          pending.current = null;
        }}
        onPlay={() => setPlaying(true)}
        onPause={() => {
          setPlaying(false);
          if (audio.current) setTime(audio.current.currentTime);
        }}
        onEnded={() => {
          setPlaying(false);
          seek(0);
        }}
      />
      <div className="bn-voice-head">
        <Image src={voice.icon} alt="" width={64} height={64} unoptimized />
        <p>
          <b>{voice.name}</b>
          <span>{voice.sub}</span>
        </p>
      </div>
      <div className="bn-voice-bar">
        <button type="button" className="bn-voice-play" aria-label={disabled ? "Play: no recording yet" : `${playing ? "Pause" : "Play"}: ${voice.name}`} onClick={toggle} disabled={disabled}>
          {playing ? (
            <svg width="24" height="24" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M6 4h4v16H6zM14 4h4v16h-4z" fill="currentColor" />
            </svg>
          ) : (
            <svg width="24" height="24" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M8 4l12 8-12 8z" fill="currentColor" />
            </svg>
          )}
        </button>
        <div className="bn-voice-wave">
          {!disabled && <input
            type="range"
            className="bn-voice-seek"
            min={0}
            max={voice.duration}
            step={0.05}
            value={time}
            aria-label={`Position in the ${label} example`}
            aria-valuetext={`${timecode(time)} of ${timecode(voice.duration)}`}
            onChange={(event) => seek(Number(event.target.value))}
            onKeyDown={keySeek}
          />}
          <div className="bn-wave" aria-hidden="true">
            {voice.peaks.map((peak, i) => (
              <i key={i} className={i / voice.peaks.length < progress ? "on" : undefined} style={{ height: `${peak * 100}%` }} />
            ))}
          </div>
        </div>
        <span className="bn-voice-time">
          {timecode(time)} / {timecode(voice.duration)}
        </span>
      </div>
      {failed && (
        <p role="alert" className="bn-voice-error">
          This recording could not be played. Check your connection and try again.
        </p>
      )}
      <p className="bn-voice-text" lang="en" ref={text}>
        {voice.words.map((word, i) => (
          <span key={i} className={i === current ? "now" : i < current ? "said" : undefined}>
            {word}{" "}
          </span>
        ))}
      </p>
    </div>
  );
}

/**
 * A part with no recording yet, in the shape of the others so the section does not change size:
 * one example button, the speaker, a flat waveform and a Play button that cannot be pressed.
 */
export function VoicePlaceholder({ icon, name, text }: { icon: string; name: string; text: string }) {
  const none: Voice = { label: name, name, sub: "No recording yet", icon, audio: "", duration: 0, peaks: Array(96).fill(0.06), words: [text], times: [] };
  return (
    <div className="bn-voice">
      <div className="bn-voice-picks-wrap">
        <ul className="bn-voice-picks">
          <li>
            <button type="button" aria-pressed="true" aria-disabled="true">
              <Image src={icon} alt="" width={64} height={64} unoptimized />
              {name}
            </button>
          </li>
        </ul>
      </div>
      <Clip voice={none} label={name.toLowerCase()} disabled />
    </div>
  );
}

const CHEVRON = (path: string) => (
  <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d={path} />
  </svg>
);

/**
 * The part's recordings: one row of buttons that scrolls sideways, fading out at an edge that has
 * more, above the recording that is showing.
 */
export default function VoicePlayer({ voices, label }: { voices: Voice[]; label: string }) {
  const [pick, setPick] = useState(0);
  const [edges, setEdges] = useState({ start: false, end: false });
  const row = useRef<HTMLUListElement>(null);
  const prev = useRef<HTMLButtonElement>(null);
  const next = useRef<HTMLButtonElement>(null);

  const measure = useCallback(() => {
    const el = row.current;
    if (!el) return;
    const start = el.scrollLeft > 4;
    const end = el.scrollLeft + el.clientWidth < el.scrollWidth - 4;
    // Scrolling fires many events; keep the same object so a row that did not change does not render.
    setEdges((now) => (now.start === start && now.end === end ? now : { start, end }));
  }, []);

  useEffect(() => {
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [measure]);

  useArrowFocus(edges, row, prev, next);

  const scroll = (direction: 1 | -1) => {
    const el = row.current;
    if (el) el.scrollBy({ left: direction * el.clientWidth * 0.8, behavior: behavior() });
  };

  const choose = (i: number) => {
    setPick(i);
    const el = row.current;
    const button = el?.children[i] as HTMLElement | undefined;
    if (!el || !button) return;
    const left = el.scrollLeft + button.getBoundingClientRect().left - el.getBoundingClientRect().left - (el.clientWidth - button.offsetWidth) / 2;
    el.scrollTo({ left, behavior: behavior() });
  };

  return (
    <div className="bn-voice">
      <div className="bn-voice-picks-wrap" data-start={edges.start} data-end={edges.end}>
        <ul className="bn-voice-picks" aria-label={`${label} examples`} ref={row} onScroll={measure}>
          {voices.map((voice, i) => (
            <li key={voice.audio}>
              <button type="button" aria-pressed={i === pick} onClick={() => choose(i)}>
                <Image src={voice.icon} alt="" width={64} height={64} unoptimized />
                {voice.label}
              </button>
            </li>
          ))}
        </ul>
        <button type="button" ref={prev} className="bn-voice-arrow bn-voice-prev" aria-label="Earlier examples" aria-hidden={!edges.start} tabIndex={edges.start ? 0 : -1} onClick={() => scroll(-1)}>
          {CHEVRON("M12 4l-6 6 6 6")}
        </button>
        <button type="button" ref={next} className="bn-voice-arrow bn-voice-next" aria-label="More examples" aria-hidden={!edges.end} tabIndex={edges.end ? 0 : -1} onClick={() => scroll(1)}>
          {CHEVRON("M8 4l6 6-6 6")}
        </button>
      </div>
      <Clip key={pick} voice={voices[pick]} label={label} />
    </div>
  );
}
