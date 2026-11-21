/**
 * Who a report about an NPC, rather than about one of its lines, is about.
 *
 * A gossip NPC with a dozen takes is reported by its address alone when the reporter never
 * picks a take, so the table has no line to show beside the report. What it can show is the
 * speaker: name, what picked the voice, the voice, and how many lines they say.
 *
 * Asked once per page by the server: a corpus scan per row would be one per report.
 */
import type { Corpus } from "@/lib/corpus";
import { BASE_LANG, type Lang } from "@/lib/lang";
import { corpus as questCorpus } from "@/lib/quests/catalogue";
import { speakerOf, type Heading } from "@/lib/reports/detail";
import { parseTarget, resolveTarget } from "@/lib/reports/target";

/** Each NPC or object address among `targets`, by address. Addresses that resolve to nothing are left out. */
export async function npcDetails(
  targets: string[],
  lang: Lang = BASE_LANG,
  corpus?: Corpus,
): Promise<Record<string, Heading>> {
  const wanted = [...new Set(targets)].flatMap((address) => {
    const target = parseTarget(address.split("/"));
    return target && target.kind !== "quest" ? [{ address, target }] : [];
  });
  if (wanted.length === 0) return {};

  // One scan of the corpus for every address's id, then each address resolved against that
  // handful, rather than resolveTarget scanning the whole corpus once per address.
  const ids = new Set(wanted.map(({ target }) => (target.kind === "npc" ? target.npcId : target.objectId)));
  const all = corpus ?? (await questCorpus(lang));
  const candidates = { ...all, lines: all.lines.filter((line) => ids.has(line.npcId)) };

  const details: Record<string, Heading> = {};
  for (const { address, target } of wanted) {
    const spoken = await resolveTarget(target, candidates);
    const [first] = spoken;
    if (!first) continue;

    const { speaker, aside } = speakerOf(first);
    const count = new Set(spoken.map((line) => line.lineId)).size;
    details[address] = {
      heading: first.npcName,
      headingHref: null,
      speaker,
      speakerIsHeading: true,
      aside: [aside, count === 1 ? "1 line" : `${count} lines`].filter(Boolean).join(" · "),
    };
  }
  return details;
}
