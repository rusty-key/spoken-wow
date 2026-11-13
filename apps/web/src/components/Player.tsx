"use client";

import { useLang } from "@/components/LangProvider";
import { withLang } from "@/lib/lang";
import AudioPlayer from "@/components/AudioPlayer";
import type { ResultLine } from "@/lib/search";

/**
 * The quests section's half of the player: which file a line plays, and what to call it.
 *
 * Everything else - the transport, the scrubber, the keyboard element - is AudioPlayer,
 * shared with places.
 */

/**
 * What the file should be called once it is downloaded.
 *
 * The addon path flattened rather than its basename, because the subfolder is part of the
 * identity: quests/ and gossip/ are separate namespaces, and a downloads folder is not.
 */
function downloadName(line: ResultLine): string {
  return line.audioPath.replace("/", "-");
}

type Props = {
  line: ResultLine | null;
  /**
   * The live take: the one regenerated in this session, else the one the search reported.
   *
   * Appended to the audio URL as a cache buster. Replacing a line does not change its path -
   * the addon resolves sounds by filename, so it cannot - and a cached response is only
   * revalidated after five minutes, so without this the browser replays the take that was
   * just replaced. Both sources, because a take made in another tab, or before a reload,
   * left a bare URL the browser still held the old take under.
   */
  version?: number;
  ref: React.RefObject<HTMLAudioElement | null>;
};

export default function Player({ line, version, ref }: Props) {
  const lang = useLang();
  return (
    <AudioPlayer
      audioRef={ref}
      src={
        line
          ? withLang(
              lang,
              `/api/quests/audio/${line.audioPath}${version === undefined ? "" : `?v=${version}`}`,
            )
          : undefined
      }
      title={line?.npcName ?? null}
      meta={line?.lineId}
      subtitle={line?.text}
      downloadName={line ? downloadName(line) : undefined}
    />
  );
}
