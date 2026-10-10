/**
 * Pure projections /contributions's page.tsx turns a stored envelope into, split out so they
 * can be unit tested without spinning up the page's own database calls -- the same reason
 * lib/npc/resolve.ts's observedFrom is a free function rather than inlined where it's used.
 *
 * npcSummaryFrom reads the roster store (roster-store.ts), so this file is not node-free the way
 * envelope.ts/contributions.ts are -- ContributionTable.tsx only ever takes NpcSummary/
 * QuestSummary as `import type`, which TypeScript erases entirely, so the client bundle never
 * sees this module's own imports.
 */
import { BASE_LANG } from "@/lib/lang";
import { flavorOptionsFor } from "@/lib/contributions/speaker";
import { loadRoster } from "@/lib/voices/roster-store";
import type { NpcKind, NpcResolution, NpcRowKind, Provenance } from "@/lib/npc/store";
import { isQuestStage, type QuestStage } from "./query";

/** `stage` is null only for stored meta whose `event` is not one the addon sends. */
export type QuestSummary = { title: string; questId: number; stage: QuestStage | null } | "gossip";

/**
 * The Quest column's content for one contribution.
 *
 * Null for a source with no quest concept at all -- zones and books never carry `quest`/`title`,
 * and there is no ambiguity to flag there the way there is for a quests-source row.
 *
 * "gossip" for a quests-source envelope missing either field: checkEnvelope's other shape for
 * that source is an `npc:<id>` key with neither, and an empty cell would read as "we lost the
 * quest" rather than "this line was never tied to one". A quest id and title only ever arrive
 * together (checkEnvelope requires both `f.quest` and `f.event` for the quest:event key), so a
 * lone field here is stored data that doesn't match that shape rather than a real half-answer,
 * and the safer read is the same as having neither.
 */
export function questFor(row: { source: string; meta: Record<string, string> }): QuestSummary | null {
  if (row.source !== "quests") return null;
  const { quest, title, event } = row.meta;
  if (quest && title) return { title, questId: Number(quest), stage: isQuestStage(event) ? event : null };
  return "gossip";
}

/** The English page a books contribution is matched to, as the triage table shows it. */
export type BookMatch = { pageId: number; bookId: number; title: string; pageNumber: number; pageCount: number };

/**
 * The Book column's content for one contribution: what the client showed, and the English page
 * a moderator matched it to (migration 0059). Null for any source but books, and for an English
 * row, which has no translation to place -- accept writes nothing for it.
 */
export type BookSummary = { title: string | null; number: number | null; match: BookMatch | null };

export function bookFor(
  row: { source: string; locale: string; meta: Record<string, string> },
  match: BookMatch | null,
): BookSummary | null {
  if (row.source !== "books" || row.locale === BASE_LANG) return null;
  const number = Number(row.meta.number);
  return {
    title: row.meta.book?.trim() || null,
    number: Number.isInteger(number) && number > 0 ? number : null,
    match,
  };
}

/** Who a row's NPC is, in exactly the shape the triage table renders. */
export type NpcSummary = {
  /**
   * Null only for a kind-less envelope with no resolution to fall back on -- the addon reported
   * an id and a name but not what kind of entity it is (resolve.ts's observedFrom refuses to
   * guess, for the reason its own docstring gives), and resolveNpc refuses to touch the store at
   * all without one. The three real rows this table was designed against are exactly this case:
   * filed before the addon reported `kind` at all. Shown with the name and id still, and a kind
   * select added to the "nothing known" state, rather than blank -- a moderator supplying the
   * kind by hand is a reviewed human decision, not the silent auto-guess resolve.ts declines to
   * make at intake.
   */
  npcKind: NpcRowKind | null;
  npcId: number;
  npcName: string | null;
  race: string | null;
  gender: string | null;
  flavor: string | null;
  provenance: Provenance;
  confirmed: boolean;
  /** A moderator's answer they flagged for a later look -- see migration 0054. */
  doubtful: boolean;
  /**
   * flavorsFor(race, gender), or [] when either is unknown -- corpus.ts is server-only, so this
   * is computed once here rather than in the client component that renders it.
   */
  flavorOptions: string[];
  /**
   * A kind-less row whose id resolves differently as a creature and as a gameobject: each
   * answer, for the moderator to pick one. Empty otherwise. See idOnlyResolution.
   */
  conflict: NpcConflictOption[];
};

export type NpcConflictOption = Pick<
  NpcResolution,
  "npcKind" | "race" | "gender" | "flavor" | "provenance" | "doubtful"
>;

/** What an id-only lookup found for a kind-less contribution: one answer, or a conflict. */
export type IdOnlyLookup = {
  resolution: NpcResolution | undefined;
  /** Every disagreeing answer, for a moderator to choose between. Empty when there is no conflict. */
  conflict: NpcResolution[];
};

// store.ts's provenanceRank, for the same reason: the better-founded answer shows first.
const RANK: Record<Provenance, number> = { moderator: 4, corpus: 3, display: 2, client: 1, none: 0 };

/**
 * Who a kind-less contribution's NPC is, from every npc row sharing its id.
 *
 * A kind-less envelope names an id that may exist as both a creature and a gameobject. When the
 * rows that say anything (every provenance but `none`) agree on race, gender and flavor, that
 * answer is used, the best-ranked row first, so a moderator's own answer is what shows. When
 * they disagree it is a conflict: nothing is used, and the rows go back to the moderator to
 * choose between, which records the kind on the contribution (store.ts's setContributionNpcKind)
 * and turns every later read of it into a keyed one.
 *
 * Read-only, like getResolutionsById itself: choosing a kind is the moderator's, never this.
 */
export function idOnlyResolution(rows: NpcResolution[] | undefined): IdOnlyLookup {
  if (!rows?.length) return { resolution: undefined, conflict: [] };

  const answers = rows.filter((row) => row.provenance !== "none");
  if (answers.length === 0) {
    return { resolution: rows.length === 1 ? rows[0] : undefined, conflict: [] };
  }

  const voices = new Set(answers.map((row) => `${row.race}|${row.gender}|${row.flavor}`));
  if (voices.size > 1) {
    return {
      resolution: undefined,
      conflict: [...answers].sort((a, b) => RANK[b.provenance] - RANK[a.provenance]),
    };
  }

  const best = answers.reduce((a, b) => (RANK[b.provenance] > RANK[a.provenance] ? b : a));
  return { resolution: best, conflict: [] };
}

/**
 * One row's NPC/Speaker column content, from what the envelope itself observed and whatever
 * npc row (if any) already answers for that (kind, id).
 *
 * The resolution's own `npcKind` wins over the observation's: a resolution can only exist when
 * some envelope -- this one or an earlier one for the same NPC -- carried a kind, which makes it
 * strictly more informed than a kind-less current envelope naming the same id.
 *
 * The name goes the other way: the envelope's own name is what the player's client called the
 * NPC, in the row's own locale, while the resolution is shared by every language and names the
 * NPC in English (the corpus's name, or whichever envelope resolved it first). The resolution's
 * name is only the fallback for an envelope that named none.
 */
export async function npcSummaryFrom(
  observed: { npcKind: NpcKind | null; npcId: number; npcName: string | null },
  resolution: NpcResolution | undefined,
  conflict: NpcResolution[] = [],
): Promise<NpcSummary> {
  return {
    npcKind: resolution?.npcKind ?? observed.npcKind,
    npcId: observed.npcId,
    npcName: observed.npcName ?? resolution?.npcName ?? null,
    race: resolution?.race ?? null,
    gender: resolution?.gender ?? null,
    flavor: resolution?.flavor ?? null,
    provenance: resolution?.provenance ?? "none",
    confirmed: resolution?.confirmed ?? false,
    doubtful: resolution?.doubtful ?? false,
    flavorOptions:
      flavorOptionsFor(resolution?.race ?? null, resolution?.gender ?? null, await loadRoster()),
    conflict: conflict.map(({ npcKind, race, gender, flavor, provenance, doubtful }) => ({
      npcKind,
      race,
      gender,
      flavor,
      provenance,
      doubtful,
    })),
  };
}

/**
 * Resolves every key in `toResolve`, tolerating a failure on any single one of them.
 *
 * page.tsx's own call (`resolveOne` is resolveNpc) is a render, not a write path with its own
 * error boundary -- a write that throws (a DB blip, pool exhaustion) inside an unguarded
 * `Promise.all` would reject the whole thing and 500 the entire moderator queue over one row,
 * for every collaborator, not just fail to resolve that row. The intake route already treats a
 * resolveNpc failure as non-fatal to the contribution it's resolving for
 * (api/contributions/route.ts: "A failure here must not fail the contribution"); this is the
 * same principle applied to a page read of many rows instead of a write of one.
 *
 * A key resolveOne answers null for (no npcKind, or an id past the integer ceiling -- see
 * resolve.ts's own docstring) is left out of the result exactly like one that threw: either way
 * there is nothing to add to `resolutions`.
 */
export async function resolveMissing<T>(
  toResolve: Map<string, T>,
  resolveOne: (value: T) => Promise<NpcResolution | null>,
): Promise<Map<string, NpcResolution>> {
  const resolved = new Map<string, NpcResolution>();
  await Promise.all(
    [...toResolve.entries()].map(async ([key, value]) => {
      try {
        const row = await resolveOne(value);
        if (row) resolved.set(key, row);
      } catch (error) {
        console.error(`resolveMissing: resolveNpc failed for ${key}`, error);
      }
    }),
  );
  return resolved;
}
