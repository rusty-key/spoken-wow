"use client";

/** Client props are in the page payload, so rows carry no uploader. */
import { useCallback, useRef, useState } from "react";

import { useLocalDates } from "@/components/useLocalDates";
import { useUiText } from "@/components/UiTextProvider";
import type { ContributionStatus } from "@/lib/contributions/contributions";
import type { NameContribution, ObservedKind } from "@/lib/names/observed";
import { fill } from "@/lib/site-text/format";

export default function NameContributionTable({ initial }: { initial: NameContribution[] }) {
  const text = useUiText();
  const t = text.contributions.names;
  const kindLabels: Record<ObservedKind, string> = {
    creature: text.catalogue.facets.npcType.creature,
    gameobject: text.catalogue.facets.npcType.gameobject,
  };
  const when = useLocalDates();
  const [statuses, setStatuses] = useState<Record<number, ContributionStatus>>({});
  const [refusals, setRefusals] = useState<Record<number, string>>({});
  const [busy, setBusy] = useState<ReadonlySet<number>>(new Set());
  const inFlight = useRef(new Set<number>());

  const resolve = useCallback(async (id: number, status: ContributionStatus) => {
    if (inFlight.current.has(id)) return;
    inFlight.current.add(id);
    setBusy(new Set(inFlight.current));
    try {
      const response = await fetch("/api/contributions/name", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id, status }),
      }).catch(() => null);
      const body = await response?.json().catch(() => null);
      if (response?.ok) {
        setStatuses((all) => ({ ...all, [id]: status }));
        setRefusals(({ [id]: _, ...rest }) => rest);
      } else {
        const message = typeof body?.error === "string" ? body.error : t.failed;
        setRefusals((all) => ({ ...all, [id]: message }));
      }
    } finally {
      inFlight.current.delete(id);
      setBusy(new Set(inFlight.current));
    }
  }, [t.failed]);

  if (initial.length === 0) {
    return <p className="text-muted-foreground text-sm">{t.nothing}</p>;
  }

  return (
    <div className="bs-rows">
      {initial.map((row) => {
        const current = statuses[row.id] ?? row.status;
        const hold = busy.has(row.id);
        return (
          <div key={row.id} id={`name-${row.id}`} className="bs-review-row" data-moved={current !== row.status ? "" : undefined}>
            <div className="bs-who">
              <div className="bs-who-name">{row.english ?? t.unnamed}</div>
              <span className="bs-who-sub">
                {kindLabels[row.kind]} #{row.entityId}
              </span>
            </div>

            <div className="min-w-0">
              <p className="bs-label">{t.currentName}</p>
              {row.currentName ? (
                <p className="bs-text">{row.currentName}</p>
              ) : (
                <p className="bs-text">
                  {row.english ?? t.none}
                  <span
                    className="text-muted-foreground ml-2 rounded-full border px-1.5 text-[11px] font-medium"
                    title={t.noNameYet}
                  >
                    {t.english}
                  </span>
                </p>
              )}
            </div>

            <div className="min-w-0">
              <p className="bs-label">{t.contributedName}</p>
              <p className="bs-text">{row.name}</p>
            </div>

            <div className="bs-actions">
              {current === "new" ? (
                <>
                  <button
                    type="button"
                    className="bs-btn"
                    disabled={hold}
                    title={t.keepTitle}
                    onClick={() => void resolve(row.id, "accepted")}
                  >
                    {t.keep}
                  </button>
                  <button type="button" className="bs-btn bs-btn-text" disabled={hold} onClick={() => void resolve(row.id, "rejected")}>
                    {t.drop}
                  </button>
                </>
              ) : current === "rejected" ? (
                <button type="button" className="bs-btn bs-btn-text" disabled={hold} onClick={() => void resolve(row.id, "new")}>
                  {t.reopen}
                </button>
              ) : (
                <span className="text-muted-foreground text-sm">{t.kept}</span>
              )}
              {refusals[row.id] ? <p className="bs-refusal">{refusals[row.id]}</p> : null}
            </div>

            <div className="bs-meta">
              <span>
                {row.uploaders === 1 ? t.sentByOne : fill(t.sentByMany, { n: row.uploaders })}
              </span>
              <span>{fill(t.updated, { when: when(row.updatedAt) })}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
