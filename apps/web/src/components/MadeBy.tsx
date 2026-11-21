"use client";

import type { MadeBy } from "@/lib/takes/made-by";

/**
 * The "Made by" column, shared by the three explorers.
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
