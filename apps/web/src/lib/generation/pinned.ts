/**
 * The generator a quest line is spoken by: fish.audio when its voice is pinned to it in the
 * language (fish_reference."pinned", migration 0078), and the collaborator's choice otherwise.
 *
 * Keyed on the line's own voice, the NPC's, because that is what the file is named for: a
 * gossip file shared by many NPCs is one voice, so a pin on it has one answer. The narrator
 * and a marked stretch go with the line, since one request speaks every turn of it.
 */
import "server-only";

import type { Lang } from "@/lib/lang";
import { lineIndex } from "@/lib/quests/catalogue";
import { pinnedVoices } from "@/lib/voices/references";

import type { Provider } from "./providers";

/** fish.audio when the line's voice is pinned in `lang`; undefined leaves the choice alone. */
export async function pinnedProvider(lineId: string, lang: Lang): Promise<Provider | undefined> {
  const voice = (await lineIndex(lang)).get(lineId)?.[0]?.voice;
  if (!voice) return undefined;
  return (await pinnedVoices(lang)).has(voice) ? "fish" : undefined;
}
