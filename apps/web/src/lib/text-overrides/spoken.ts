import { overrideSpokenHash as bossHash } from "@/lib/bosses/catalogue";
import type { Lang } from "@/lib/lang";
import { overrideSpokenHash as placeHash } from "@/lib/places/catalogue";
import { overrideSpokenHash as readableHash } from "@/lib/readables/catalogue";

import type { NarratedSource } from "./types";

const HASHES: Record<NarratedSource, (lang: Lang, lineId: string, text: string) => Promise<string | null>> = {
  places: placeHash,
  bosses: bossHash,
  readables: readableHash,
};

/** The hash the source's catalogue overlay gives a line speaking `text`, which a take of it carries. */
export function overrideSpokenHash(source: NarratedSource, lang: Lang, lineId: string, text: string): Promise<string | null> {
  return HASHES[source](lang, lineId, text);
}
