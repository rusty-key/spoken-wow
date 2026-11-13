"use client";

import { DAY, useLocalDates } from "@/components/useLocalDates";
import type { Pack } from "@/lib/community/store";

/** Where a pack stands with players and with review, one line per fact. */
export default function PackStatus({ pack }: { pack: Pack }) {
  const when = useLocalDates();

  return (
    <ul className="space-y-0.5 text-sm">
      <li>
        {pack.live ? (
          <>
            <span className="font-medium">Live</span> v{pack.live.version}
          </>
        ) : (
          <span className="text-muted-foreground">Not live yet</span>
        )}
        {/* Else the author looks for it in the Manager, or wonders why it takes no version. */}
        {!pack.listed && <span className="text-muted-foreground"> · Unlisted by an admin</span>}
      </li>
      {pack.pending && (
        <li>
          <span className="font-medium">Pending</span> v{pack.pending.version}{" "}
          <span className="text-muted-foreground">since {when(pack.pending.submittedAt, DAY)}</span>
        </li>
      )}
      {pack.lastRejected && (
        <li className="text-destructive">
          <span className="font-medium">Rejected</span> v{pack.lastRejected.version}
          {pack.lastRejected.rejectReason && <>: {pack.lastRejected.rejectReason}</>}
        </li>
      )}
    </ul>
  );
}
