"use client";

import { useLang } from "@/components/LangProvider";
import { withLang } from "@/lib/lang";
import AudioPlayer from "@/components/AudioPlayer";
import { canPlay, type ExplorerLine, type ExplorerSection } from "@/components/explorer/section";

/**
 * The places and bosses half of the player: which clip a line plays, and what to call it.
 *
 * Everything else - the transport, the scrubber, the keyboard element - is AudioPlayer,
 * shared with quests.
 */
type Props<L extends ExplorerLine> = {
  section: Pick<ExplorerSection<L>, "api">;
  line: L | null;
  /** Take version, used only to bust the browser cache after a regeneration. */
  version?: number;
  audioRef: React.RefObject<HTMLAudioElement | null>;
};

export function Player<L extends ExplorerLine>({ section, line, version, audioRef }: Props<L>) {
  const lang = useLang();
  const query = new URLSearchParams();
  if (version !== undefined) query.set("v", String(version));

  // A line with no take has nothing to play, and passing a src that 404s would leave the
  // transport enabled over silence.
  const playable = line !== null && canPlay(line);

  return (
    <AudioPlayer
      audioRef={audioRef}
      src={
        playable ? withLang(lang, `${section.api}/audio/${line.file}.mp3${query.size ? `?${query}` : ""}`) : undefined
      }
      title={line?.name ?? null}
      meta={line?.id}
      subtitle={line?.text ?? undefined}
      downloadName={line ? `${line.file.replace(/\//g, "-")}.mp3` : undefined}
      // Places records the duration on the take, so the total is known before the file loads.
      totalHint={line?.take?.durationSec ?? undefined}
    />
  );
}
