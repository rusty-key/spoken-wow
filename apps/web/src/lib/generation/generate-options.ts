import type { Lang } from "@/lib/lang";
import type { commitTake } from "@/lib/takes/commit";

import type { Speaker } from "./speakers/speaker";

export type GenerateOptions = {
  speaker: Speaker;
  lang?: Lang;
  batchId?: string;
  /** A run that only records what it would send passes a commit that throws, to end there. */
  commit?: typeof commitTake;
};
