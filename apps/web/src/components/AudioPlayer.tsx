"use client";

import { Download, Pause, Play, Volume2, VolumeX } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { cn, timecode } from "@/lib/utils";

import { Contained } from "./Width";

/**
 * The transport bar both sections play through.
 *
 * ONE <audio> FOR THE WHOLE PAGE. Starting a line therefore stops the previous one with no
 * bookkeeping across rows -- the alternative, an element per row, means tracking which are
 * playing and pausing them by hand, and getting that wrong sounds like two narrators talking
 * over each other.
 *
 * The element stays a plain <audio> handed back through `audioRef`, because both explorers
 * drive playback imperatively from the keyboard (space toggles, j/k step). The chrome here is
 * presentation over that element, never a replacement for it.
 *
 * WHERE A MISSING FILE IS REPORTED. A take is a row in the database, and nothing asks the
 * filesystem whether its bytes are reachable while a page renders -- so the first thing that
 * knows a clip is not there is this element, when somebody presses play. It says so here
 * rather than failing silently, which is what it used to do: `play()` was called with its
 * rejection swallowed and no `error` listener at all, so a 404 left the button showing play
 * and the bar at 0:00 with no explanation.
 *
 * WHAT IT DOES NOT KNOW. Not what a line is, not how its URL is built, not which section it
 * belongs to. Quests names files by NPC and event, places by map id and slug, and places adds a
 * language the path itself does not carry -- so each section keeps a small adapter that turns
 * its own line into these props. That seam is the whole reason this is one component: the two
 * were the same 200 lines written twice, and they had already drifted to different playback
 * rates and different scrub behaviour.
 */
const RATES = [0.75, 1, 1.25, 1.5, 2];

// The volume outlives the page: every explorer mounts its own element, and a level set on
// quests should still be the level on places. Storage can be absent or throw (private windows,
// blocked site data), in which case the element's own default of full volume stands.
const VOLUME_KEY = "spoken:volume";

function storedVolume(): number | null {
  try {
    const raw = window.localStorage.getItem(VOLUME_KEY);
    const value = Number(raw);
    return raw !== null && value >= 0 && value <= 1 ? value : null;
  } catch {
    return null;
  }
}

function storeVolume(value: number) {
  try {
    window.localStorage.setItem(VOLUME_KEY, String(value));
  } catch {
    // Not remembered, and nothing else depends on it.
  }
}

type Props = {
  /** The audio to play, or undefined when nothing is selected. */
  src: string | undefined;
  /** Who is speaking, or what the line belongs to. */
  title: string | null;
  /** The line's id, set in mono beside the title. */
  meta?: string;
  /** What the line says, one line, clipped. */
  subtitle?: string;
  /** The filename a download should land as. */
  downloadName?: string;
  /**
   * A duration known before the file loads, in seconds.
   *
   * Places records it on the take, so the total can be shown immediately rather than after
   * the first byte arrives. Quests does not, and passes nothing.
   */
  totalHint?: number;
  audioRef: React.RefObject<HTMLAudioElement | null>;
};

export default function AudioPlayer({
  src,
  title,
  meta,
  subtitle,
  downloadName,
  totalHint,
  audioRef,
}: Props) {
  const local = useRef<HTMLAudioElement | null>(null);

  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [rate, setRate] = useState(1);
  const [muted, setMuted] = useState(false);
  const [volume, setVolume] = useState(1);
  // While dragging, the slider follows the pointer rather than timeupdate events. Without
  // this the thumb fights the playhead and snaps back every 250ms.
  const [scrubbing, setScrubbing] = useState<number | null>(null);
  // Set when the element could not fetch or decode what it was pointed at. Almost always a
  // clip whose row exists and whose file does not -- the archive is not on every machine
  // that serves this page.
  const [failed, setFailed] = useState(false);

  const fail = () => {
    setFailed(true);
    setPlaying(false);
  };

  // Both refs point at the same element: this component reads it for its own chrome, the
  // explorer drives playback through it.
  const attach = (el: HTMLAudioElement | null) => {
    local.current = el;
    audioRef.current = el;
  };

  useEffect(() => {
    const el = local.current;
    if (!el) return;

    const onTime = () => setTime(el.currentTime);
    const onMeta = () => setDuration(Number.isFinite(el.duration) ? el.duration : 0);
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    const onRate = () => setRate(el.playbackRate);
    const onVolume = () => {
      setMuted(el.muted);
      setVolume(el.volume);
    };
    // Not declared as onError on the element: a media element's error event does not
    // bubble, so React's delegation never sees it.
    const onError = fail;

    el.addEventListener("timeupdate", onTime);
    el.addEventListener("loadedmetadata", onMeta);
    el.addEventListener("durationchange", onMeta);
    el.addEventListener("play", onPlay);
    el.addEventListener("pause", onPause);
    el.addEventListener("ended", onPause);
    el.addEventListener("ratechange", onRate);
    el.addEventListener("volumechange", onVolume);
    el.addEventListener("error", onError);

    const saved = storedVolume();
    if (saved !== null) el.volume = saved;

    return () => {
      el.removeEventListener("timeupdate", onTime);
      el.removeEventListener("loadedmetadata", onMeta);
      el.removeEventListener("durationchange", onMeta);
      el.removeEventListener("play", onPlay);
      el.removeEventListener("pause", onPause);
      el.removeEventListener("ended", onPause);
      el.removeEventListener("ratechange", onRate);
      el.removeEventListener("volumechange", onVolume);
      el.removeEventListener("error", onError);
    };
  }, []);

  // A new clip starts at zero even before its metadata arrives, so the previous one's
  // duration is never briefly shown against the new one's name.
  useEffect(() => {
    setTime(0);
    setDuration(0);
    setFailed(false);
  }, [src]);

  const toggle = () => {
    const el = local.current;
    if (!el?.src) return;
    // Both paths, because a 404 reaches an <audio> either way: play() rejects in some
    // browsers, and in others it resolves and the element fires `error` instead. Handling
    // only one leaves the button stuck, which is how this was found in the take popover.
    void (el.paused ? el.play().catch(fail) : el.pause());
  };

  const cycleRate = () => {
    const el = local.current;
    if (!el) return;
    el.playbackRate = RATES[(RATES.indexOf(el.playbackRate) + 1) % RATES.length] ?? 1;
  };

  const changeVolume = (value: number) => {
    const el = local.current;
    if (!el) return;
    el.volume = value;
    // Dragging the level up is asking to hear it, so it lifts a mute rather than moving a
    // slider that stays silent.
    el.muted = value === 0;
    storeVolume(value);
  };

  const position = scrubbing ?? time;
  const total = duration || totalHint || 0;

  return (
    <div className="bg-card/95 border-t backdrop-blur">
      <Contained className="flex items-center gap-2 py-3 sm:gap-4">
        <Button
          size="icon"
          variant="secondary"
          onClick={toggle}
          disabled={!src}
          aria-label={playing ? "Pause" : "Play"}
          className="size-10 shrink-0 rounded-full"
        >
          {playing ? <Pause className="fill-current" /> : <Play className="fill-current" />}
        </Button>

        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium">
            {title ?? "Nothing playing"}
            {meta && <span className="text-muted-foreground ml-2 font-mono text-xs">{meta}</span>}
          </div>
          <div
            className={cn(
              "truncate text-xs",
              failed ? "text-destructive" : "text-muted-foreground",
            )}
            role={failed ? "alert" : undefined}
          >
            {failed ? "Its audio is not on the server." : (subtitle ?? "Pick a line to hear it.")}
          </div>

          <div className="mt-1.5 flex items-center gap-3">
            <span className="text-muted-foreground w-8 shrink-0 text-right font-mono text-[11px]">
              {timecode(position)}
            </span>
            <Slider
              value={[position]}
              max={total || 1}
              step={0.05}
              disabled={!src || !total}
              aria-label="Seek"
              // The bar itself is 4px tall, which is a miserable thing to hit with a mouse.
              // The padding gives the track a 20px-tall pointer target, and the matching
              // negative margin keeps the row laid out as if it were still 4px.
              className="-my-2 cursor-pointer py-2 data-disabled:cursor-default"
              onValueChange={([value]) => setScrubbing(value)}
              // Committed on release, never on every intermediate value: setting currentTime
              // per pointer move restarts the fetch each time.
              onValueCommit={([value]) => {
                if (local.current) local.current.currentTime = value;
                setTime(value);
                setScrubbing(null);
              }}
            />
            <span className="text-muted-foreground w-8 shrink-0 font-mono text-[11px]">
              {timecode(total)}
            </span>
          </div>
        </div>

        <Button
          size="sm"
          variant="ghost"
          onClick={cycleRate}
          disabled={!src}
          aria-label="Playback speed"
          className="w-14 shrink-0 font-mono text-xs tabular-nums"
        >
          {rate.toFixed(2).replace(/0$/, "")}x
        </Button>
        <Button
          size="icon"
          variant="ghost"
          onClick={() => {
            const el = local.current;
            if (!el) return;
            // Unmuting a level dragged to zero would still be silence, so it comes back full.
            if (!el.muted && el.volume > 0) el.muted = true;
            else changeVolume(el.volume || 1);
          }}
          disabled={!src}
          aria-label={muted || volume === 0 ? "Unmute" : "Mute"}
          // A phone has volume buttons, and at its width the seek bar needs the room more.
          className="hidden shrink-0 sm:inline-flex"
        >
          {muted || volume === 0 ? <VolumeX /> : <Volume2 />}
        </Button>
        <Slider
          value={[muted ? 0 : volume]}
          max={1}
          step={0.01}
          aria-label="Volume"
          // Not disabled with nothing playing: the level is worth setting before the first
          // line, and it is remembered either way. Same enlarged pointer target as the seek bar.
          className="-my-2 hidden w-20 shrink-0 cursor-pointer py-2 sm:flex"
          onValueChange={([value]) => changeVolume(value ?? 0)}
        />

        {/* An anchor, not a fetch: the file is same-origin, so `download` renames it on the
            way out and the browser handles the save. With nothing playing there is no href to
            give, and a disabled anchor is not a thing - hence the plain button. */}
        {src ? (
          <Button size="icon" variant="ghost" asChild className="shrink-0">
            <a
              href={src}
              download={downloadName}
              aria-label="Download this line"
              title={downloadName && `Download ${downloadName}`}
            >
              <Download />
            </a>
          </Button>
        ) : (
          <Button
            size="icon"
            variant="ghost"
            disabled
            aria-label="Download this line"
            className="shrink-0"
          >
            <Download />
          </Button>
        )}

        <audio ref={attach} preload="metadata" src={src} />
      </Contained>
    </div>
  );
}
