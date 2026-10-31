/**
 * The report address a corpus line would produce, for reporting from the explorer.
 *
 * The addon builds its address from what the client can see - a quest id and an event, or a
 * unit GUID - because a data module that failed to load is the failure most worth reporting.
 * A line row on the site knows the same two things and writes the same string, so a report
 * filed here and one filed from the game arrive as the same kind of row and triage never has
 * to care which came from where.
 *
 * SEPARATE FROM target.ts, which resolves an address back into corpus lines and loads the
 * corpus to do it. That is a server module; this one is imported by a row in the table.
 */
import type { CorpusLine } from "@/lib/corpus";
import type { Source } from "@/lib/line-fields";

/**
 * Which address each source travels as, so a new source fails the build here rather than losing
 * its report button. Three name a quest. Gossip, chat and follow-up lines travel as an NPC
 * address instead: gossip and chat have no quest, and a follow-up line is neither of a quest's two
 * dialogs - quest/{id}/complete would resolve to the turn-in text, not to what the NPC said
 * afterwards. Its speaker's address does resolve to it (target.ts matches every line of that
 * NPC), and the lineId the row sends along picks it out of the others.
 */
const ADDRESS: Record<Source, "quest" | "npc"> = {
  accept: "quest",
  progress: "quest",
  complete: "quest",
  gossip: "npc",
  followup: "npc",
  chatter: "npc",
};

export function targetForLine(
  line: Pick<CorpusLine, "source" | "questId" | "npcId" | "npcType">,
): string | null {
  const address = ADDRESS[line.source];
  if (address === "quest") {
    // Nothing in the corpus should be a quest line without a quest, but "quest/null/accept"
    // would resolve to nothing while looking like a real report, so it is worth refusing.
    return line.questId === null ? null : `quest/${line.questId}/${line.source}`;
  }
  if (address !== "npc") return null;
  return line.npcType === "gameobject" ? `object/${line.npcId}` : `npc/${line.npcId}`;
}
