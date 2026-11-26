import { audioRelPath } from "@/lib/audio";
import { withLang, type Lang } from "@/lib/lang";
import { lineIndex } from "@/lib/quests/catalogue";
import type { DesignSample } from "@/lib/voice-design/types";

/** Where each sampled line's live take plays, by line id; a line gone from the corpus has none. */
export async function liveTakes(lang: Lang, samples: readonly Pick<DesignSample, "lineId">[]): Promise<Record<string, string>> {
  const index = await lineIndex(lang);
  const live: Record<string, string> = {};
  for (const { lineId } of samples) {
    const line = index.get(lineId)?.[0];
    if (line) live[lineId] = withLang(lang, `/api/quests/audio/${audioRelPath(line)}`);
  }
  return live;
}
