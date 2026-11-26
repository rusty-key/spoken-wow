import { audioRelPath } from "@/lib/audio";
import type { CorpusLine } from "@/lib/corpus";
import { withLang, type Lang } from "@/lib/lang";
import type { DesignSample } from "@/lib/voice-design/types";

export const liveTakeUrl = (lang: Lang, line: Pick<CorpusLine, "lineId" | "fileName">): string =>
  withLang(lang, `/api/quests/audio/${audioRelPath(line)}`);

/** Where each sampled line's live take plays, by line id; a line gone from the corpus has none. */
export function liveTakes(lang: Lang, index: Map<string, CorpusLine[]>, samples: readonly Pick<DesignSample, "lineId">[]): Record<string, string> {
  const live: Record<string, string> = {};
  for (const { lineId } of samples) {
    const line = index.get(lineId)?.[0];
    if (line) live[lineId] = liveTakeUrl(lang, line);
  }
  return live;
}
