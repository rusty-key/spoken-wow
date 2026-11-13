"use client";

import FilterChip from "@/components/FilterChip";
import type { MadeBy, MadeByFacets } from "@/lib/takes/made-by";

/**
 * The "Made by" column and its two filter chips, shared by the three explorers.
 *
 * Drawn only when the search answered with facets, which it does only for somebody working
 * in the language. The server decides, not a client-side grant check, so the column never
 * appears half a second late after the grants arrive -- or for anyone the server would not
 * have told.
 */

/** The model on top, the author under it, then the day. Empty for a line with no take. */
export function MadeByCell({ madeBy }: { madeBy: MadeBy | null }) {
  return (
    <td className="px-2 py-2 text-xs">
      {madeBy && (
        <>
          <div className="truncate font-mono" title={madeBy.model}>
            {madeBy.model}
          </div>
          {/* A take with no author was imported from the CLI, or its account is gone. */}
          <div className="text-muted-foreground truncate" title={madeBy.authorName ?? undefined}>
            {madeBy.authorName ?? "—"}
          </div>
          {/* The UTC day, not a locale's: the first render is the server's, and a date
              formatted there in another locale or zone would not hydrate. */}
          <div className="text-muted-foreground truncate tabular-nums" title={madeBy.madeAt}>
            {madeBy.madeAt.slice(0, 10)}
          </div>
        </>
      )}
    </td>
  );
}

export function MadeByChips({
  facets,
  model,
  author,
  onChange,
}: {
  facets: MadeByFacets;
  model: string | undefined;
  author: string | undefined;
  onChange: (next: { model?: string; author?: string }) => void;
}) {
  return (
    <>
      <FilterChip
        label="model"
        value={model}
        options={facets.models.map((value) => ({ value, label: value }))}
        onChange={(model) => onChange({ model })}
      />
      <FilterChip
        label="author"
        value={author}
        options={facets.authors.map(({ id, name }) => ({ value: id, label: name }))}
        onChange={(author) => onChange({ author })}
      />
    </>
  );
}
