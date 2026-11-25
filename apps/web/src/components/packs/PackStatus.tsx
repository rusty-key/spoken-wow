"use client";

import { useUiText } from "@/components/UiTextProvider";
import { DAY, useLocalDates } from "@/components/useLocalDates";
import { fill } from "@/lib/site-text/format";
import type { Pack } from "@/lib/community/store";

export default function PackStatus({ pack }: { pack: Pack }) {
  const t = useUiText().packs;
  const when = useLocalDates();

  return (
    <ul className="space-y-0.5 text-sm">
      <li>
        {pack.live ? (
          <>
            <span className="font-medium">{t.admin.live}</span> v{pack.live.version}
          </>
        ) : (
          <span className="text-muted-foreground">{t.admin.notLive}</span>
        )}
        {/* Else the author looks for it in the Manager, or wonders why it takes no version. */}
        {!pack.listed && <span className="text-muted-foreground"> · {t.admin.unlistedByAdmin}</span>}
      </li>
      {pack.pending && (
        <li>
          <span className="font-medium">{t.admin.pending}</span> v{pack.pending.version}{" "}
          <span className="text-muted-foreground">
            {fill(t.admin.since, { when: when(pack.pending.submittedAt, DAY) })}
          </span>
        </li>
      )}
      {pack.lastRejected && (
        <li className="text-destructive">
          <span className="font-medium">{t.admin.rejected}</span> v{pack.lastRejected.version}
          {pack.lastRejected.rejectReason && <>: {pack.lastRejected.rejectReason}</>}
        </li>
      )}
    </ul>
  );
}
