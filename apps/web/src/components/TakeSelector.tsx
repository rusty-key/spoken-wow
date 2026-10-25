"use client";

import { useLang } from "@/components/LangProvider";
import { withLang } from "@/lib/lang";
import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronDown, Loader2, Pause, Play, RotateCcw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

// Type-only, so it is erased from the bundle and the store's server-only guard never runs.
import type { Take } from "@/lib/takes/store";
import { cn } from "@/lib/utils";
import type { Source } from "@/lib/sections";
import { usd } from "@/lib/generation/money";

export function when(iso: string): string {
  const date = new Date(iso);
  return `${date.toLocaleDateString()} ${date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
}

/**
 * Which take is live, and every take it could be instead.
 *
 * ONE CONTROL, NOT TWO. The version label and the way back used to be separate things, and
 * only on some rows: places printed `v3` beside a restore button that silently put back
 * whichever clip was newest, quests hid a history popover behind a second icon, and readables
 * had neither although its takes were in the same table. The label is the trigger now --
 * the number is the question, and "which other numbers are there" is what a click asks.
 *
 * Restoring moves the live flag rather than writing a new take, so this list is the set of
 * takes the line has had and not a log of who looked at it.
 *
 * EVERY TAKE IS OFFERED. This used to grey out the ones whose bytes it could not find,
 * which meant drawing a list of takes required listing a directory -- and where the archive
 * is not on the machine serving the page, every past take looked lost. The database says
 * what was cut; whether the bytes are still there is answered by playing or restoring, and
 * both say so when they fail.
 *
 * A take this app did not cut is labelled `no record`, and shows no model and no cost:
 * nothing wrote down how it was made, and inventing a value would suggest it could be
 * reproduced. That is most quests takes -- the corpus was narrated by tts_cli, and old
 * pruning destroyed the rows of many re-rolls whose clips survived.
 */
export default function TakeSelector({
  source,
  file,
  version,
  takes,
  canRestore,
  onRestored,
}: {
  source: Source;
  /** Store-relative, as the row carries it: 'gossip/31ab….mp3' or '1411/razor-hill'. */
  file: string;
  /** The live version, for the trigger. Null where nothing has been cut yet. */
  version: number | null;
  /** How many takes exist, so a line with one says so without being opened. */
  takes: number;
  /**
   * Whether this viewer may read the take list and restore from it.
   *
   * The NUMBER is public -- which take is playing and how many there are say nothing a
   * listener should not see, and the row prints them for everyone. The list behind it is
   * not: /api/takes needs regenerate, so offering a visitor a dropdown that answers 403
   * is worse than offering none.
   */
  canRestore: boolean;
  /** Called with the version now live, so the row and the player can catch up. */
  onRestored: (version: number) => void;
}) {
  const lang = useLang();
  const [open, setOpen] = useState(false);
  const [list, setList] = useState<Take[] | null>(null);
  const [busy, setBusy] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [playing, setPlaying] = useState<number | null>(null);

  // One element for the popover rather than one per row: opening a second take should stop
  // the first, and the page's main player is deliberately left alone.
  const preview = useRef<HTMLAudioElement | null>(null);
  // Which take the element is currently pointed at, for the error handler: a failure
  // arrives as an event on the element, which knows a src and not a version.
  const playingRef = useRef<number | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const params = new URLSearchParams({ source, file });
      const response = await fetch(withLang(lang, `/api/takes?${params}`));
      const body = await response.json();
      if (!response.ok) {
        setError(body.error ?? `could not read the takes (${response.status})`);
        return;
      }
      setList(body.takes as Take[]);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    }
  }, [source, file, lang]);

  useEffect(() => {
    if (open) void load();
    else {
      preview.current?.pause();
      setPlaying(null);
    }
  }, [open, load]);

  // Stop the preview when the popover unmounts, or it keeps playing invisibly.
  useEffect(() => () => preview.current?.pause(), []);

  /**
   * A take whose bytes are gone, reported when somebody asks to hear it.
   *
   * Attached to the element rather than declared as onError, because a media element's
   * error event does not bubble and reaching it through React's delegation proved
   * unreliable here -- the button sat showing pause and said nothing. This is the whole
   * point of not greying takes out in advance, so it has to actually fire.
   */
  useEffect(() => {
    const element = preview.current;
    if (!element || !open) return;

    function onError() {
      if (playingRef.current !== null) failed(playingRef.current);
    }

    element.addEventListener("error", onError);
    return () => element.removeEventListener("error", onError);
  }, [open]);

  function togglePlay(take: number) {
    const element = preview.current;
    if (!element) return;

    if (playing === take) {
      element.pause();
      playingRef.current = null;
      setPlaying(null);
      return;
    }
    element.src = withLang(lang, `/api/takes/audio?${new URLSearchParams({
      source,
      file,
      version: String(take),
    })}`);
    // Where a missing clip is found out about, rather than predicted: the route answers
    // 404 and the panel says which take could not be heard, instead of greying every old
    // take out in advance by listing a directory while the page renders.
    //
    // Both paths, because a 404 reaches an <audio> either way: play() rejects in some
    // browsers, and in others it resolves and the element fires `error` instead. Handling
    // only the promise leaves the button stuck showing pause, which is how this was found.
    setError(null);
    playingRef.current = take;
    void element.play().catch(() => failed(take));
    setPlaying(take);
  }

  /** Say which take could not be heard, and let the button go back to play. */
  function failed(take: number) {
    if (playingRef.current !== take) return;
    playingRef.current = null;
    setPlaying(null);
    setError(`v${take} could not be played — its audio is not on the server`);
  }

  async function restore(take: number) {
    setBusy(take);
    setError(null);
    try {
      const response = await fetch(withLang(lang, "/api/takes/restore"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ source, file, version: take }),
      });
      const body = await response.json();
      if (!response.ok) {
        setError(body.error ?? `could not restore (${response.status})`);
        return;
      }
      onRestored(take);
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy(null);
    }
  }

  // Nothing to choose between, or nobody to choose: the number is printed rather than
  // offered. A line with one take says `v1`, which is what every untouched line is.
  if (takes <= 1 || !canRestore) {
    return version === null ? null : (
      <span
        className="text-muted-foreground font-mono text-xs"
        title={takes <= 1 ? "The only take" : `${takes} takes; v${version} is live`}
      >
        v{version}
      </span>
    );
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          title={`${takes} takes; v${version} is live`}
          aria-label={`Choose which of ${takes} takes is live`}
          className={cn(
            "text-muted-foreground hover:text-foreground flex cursor-pointer items-center gap-0.5 rounded-sm font-mono text-xs",
            "focus-visible:ring-ring/50 focus-visible:ring-[3px] focus-visible:outline-none",
          )}
        >
          v{version}
          <ChevronDown className={cn("size-3 transition-transform", open && "rotate-180")} />
        </button>
      </PopoverTrigger>

      <PopoverContent className="w-96">
        <div className="mb-2 text-sm font-medium">Takes</div>

        {error && (
          <p role="alert" className="text-destructive mb-2 text-xs">
            {error}
          </p>
        )}

        {list === null ? (
          <p className="text-muted-foreground text-xs">Loading…</p>
        ) : list.length === 0 ? (
          <p className="text-muted-foreground text-xs">
            No takes recorded. The first regeneration keeps whatever is there now.
          </p>
        ) : (
          // Capped and scrolled, because nothing prunes takes any more: a line re-rolled
          // two hundred times has two hundred rows here, and a list that long runs off the
          // bottom of the screen with the newest takes -- the ones anyone is looking for --
          // above the fold but the rest unreachable.
          <ul className="max-h-80 space-y-1.5 overflow-y-auto">
            {list.map((take) => (
              <li
                key={take.version}
                className={cn(
                  "flex items-start gap-2 rounded-md px-1.5 py-1 text-xs",
                  take.isCurrent && "bg-muted",
                )}
              >
                <Button
                  variant="ghost"
                  size="icon-xs"
                  title="Play this take"
                  onClick={() => togglePlay(take.version)}
                >
                  {playing === take.version ? <Pause /> : <Play />}
                </Button>

                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline gap-1.5">
                    <span className="font-mono">v{take.version}</span>
                    {take.origin !== "generated" && (
                      <span
                        className="text-muted-foreground"
                        title="Nothing recorded how this take was made"
                      >
                        no record
                      </span>
                    )}
                    {take.isCurrent && <span className="text-emerald-400">live</span>}
                  </div>
                  <div className="text-muted-foreground truncate">
                    {when(take.createdAt)}
                    {take.createdByName && ` · ${take.createdByName}`}
                    {/* Nothing recorded how an imported take was made, so nothing is
                        claimed about it. */}
                    {take.credits !== null && ` · ${take.credits} credits`}
                    {take.costUsd !== null && ` · ${usd(take.costUsd)}`}
                    {take.provider === "fish" && " · fish.audio"}
                    {take.provider === "voicestudio" && " · VoiceStudio"}
                  </div>
                </div>

                {!take.isCurrent && (
                  <Button
                    variant="ghost"
                    size="xs"
                    disabled={busy !== null}
                    onClick={() => void restore(take.version)}
                    title="Make this the take the addon plays"
                  >
                    {busy === take.version ? <Loader2 className="animate-spin" /> : <RotateCcw />}
                    Restore
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}

        <audio
          ref={preview}
          onEnded={() => {
            playingRef.current = null;
            setPlaying(null);
          }}
          className="hidden"
        />
      </PopoverContent>
    </Popover>
  );
}
