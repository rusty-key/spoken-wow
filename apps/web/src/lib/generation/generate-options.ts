/**
 * What every section's generator takes besides the line: who speaks it, in which language,
 * for which batch, and how the take is kept.
 */
import type { Lang } from "@/lib/lang";
import type { commitTake } from "@/lib/takes/commit";

import type { Speaker } from "./speakers/speaker";

export type GenerateOptions = {
  speaker: Speaker;
  lang?: Lang;
  batchId?: string;
  /**
   * commitTake, unless the run is only recording what it would send (relay.ts), whose
   * commit throws to end it there.
   */
  commit?: typeof commitTake;
};
