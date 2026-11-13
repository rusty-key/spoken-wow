"use client";

import { useLang } from "@/components/LangProvider";
import { withLang } from "@/lib/lang";
import AudioPlayer from "@/components/AudioPlayer";
import type { ResultLine } from "@/lib/readables/search";

/**
 * The readables section's half of the player: which clip a page plays, and what to call it.
 *
 * Everything else -- the transport, the scrubber, the keyboard element -- is AudioPlayer,
 * shared with quests and places.
 */
type Props = {
  line: ResultLine | null;
  /** Take version, used only to bust the browser cache after a regeneration. */
  version?: number;
  audioRef: React.RefObject<HTMLAudioElement | null>;
};

export function Player({ line, version, audioRef }: Props) {
  const lang = useLang();
  const query = new URLSearchParams();
  if (version !== undefined) query.set("v", String(version));

  // A page with no take has nothing to play, and passing a src that 404s would leave the
  // transport enabled over silence.
  const playable = line !== null && line.state !== "missing";

  return (
    <AudioPlayer
      audioRef={audioRef}
      src={
        playable ? withLang(lang, `/api/readables/audio/${line.file}.mp3${query.size ? `?${query}` : ""}`) : undefined
      }
      title={
        line === null
          ? null
          : line.pageCount > 1
            ? `${line.title} · page ${line.pageNumber} of ${line.pageCount}`
            : line.title
      }
      meta={line?.id}
      subtitle={line?.text}
      downloadName={line ? `${line.title.replace(/\W+/g, "-").toLowerCase()}-${line.key}.mp3` : undefined}
      // Readables records the duration on the take, so the total is known before the file loads.
      totalHint={line?.take?.durationSec ?? undefined}
    />
  );
}
