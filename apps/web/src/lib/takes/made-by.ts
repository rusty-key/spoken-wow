/**
 * Who and what made a line's live take: the generator and model, and the person who asked.
 *
 * One vocabulary for all three explorers, and client-safe, because the column and the
 * filter chips that read it are client components.
 *
 * Shown only to people who work in the language -- see worksHere in lib/lang-server.ts.
 * The model is harmless, but the author is a person's name against every line they made,
 * and a visitor has no use for either.
 */
import type { Provider } from "@/lib/generation/providers";

export type MadeBy = {
  /** "eleven:v3", "fish:2.1-pro-free". Also the filter's value, so a link reads the same. */
  model: string;
  /** The user's id, which is what the author filter matches: names are not unique. */
  authorId: string | null;
  authorName: string | null;
  /** When the take was made, as ISO 8601: a string, because this crosses to the client. */
  madeAt: string;
};

/** What the filter chips can offer: every model and author among the live takes. */
export type MadeByFacets = {
  models: string[];
  authors: { id: string; name: string }[];
};

const SHORT: Record<Provider, string> = { elevenlabs: "eleven", fish: "fish" };

/**
 * A model as the column names it: the provider, and the model without the prefix that
 * only repeats it.
 *
 * `unknown` when the take recorded none, which is every clip the CLI imported: saying
 * nothing would read as "the provider's only model", which ElevenLabs has never had.
 */
export function modelLabel(provider: Provider, modelId: string | null): string {
  if (!modelId) return `${SHORT[provider]}:unknown`;
  const model =
    provider === "elevenlabs"
      ? modelId.replace(/^eleven_/, "")
      : // fish names its generations s1, s2, s2.1; the letter is the family, not the model.
        modelId.replace(/^s(?=\d)/, "");
  return `${SHORT[provider]}:${model}`;
}

export function madeByOf(row: {
  provider: Provider;
  modelId: string | null;
  createdBy: string | null;
  createdByName: string | null;
  createdAt: Date;
}): MadeBy {
  return {
    model: modelLabel(row.provider, row.modelId),
    authorId: row.createdBy,
    authorName: row.createdByName,
    madeAt: row.createdAt.toISOString(),
  };
}

/** Sorted, so the chips list the same options in the same order on every visit. */
export function madeByFacets(all: Iterable<MadeBy>): MadeByFacets {
  const models = new Set<string>();
  const authors = new Map<string, string>();
  for (const made of all) {
    models.add(made.model);
    if (made.authorId) authors.set(made.authorId, made.authorName ?? made.authorId);
  }
  return {
    models: [...models].sort((a, b) => a.localeCompare(b)),
    authors: [...authors]
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name)),
  };
}

/** Whether a take passes the model and author filters. No take passes a filter that is set. */
export function madeByMatches(
  made: MadeBy | undefined,
  filters: { model?: string; author?: string },
): boolean {
  if (filters.model && made?.model !== filters.model) return false;
  if (filters.author && made?.authorId !== filters.author) return false;
  return true;
}
