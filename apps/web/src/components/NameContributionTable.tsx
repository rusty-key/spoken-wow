"use client";

/** Client props are in the page payload, so rows carry no uploader. */
import { useCallback, useRef, useState } from "react";

import { useLocalDates } from "@/components/useLocalDates";
import type { ContributionStatus } from "@/lib/contributions/contributions";
import type { NameContribution, ObservedKind } from "@/lib/names/observed";

const KIND_LABELS: Record<ObservedKind, string> = { creature: "NPC", gameobject: "Object" };

export default function NameContributionTable({ initial }: { initial: NameContribution[] }) {
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
        const message = typeof body?.error === "string" ? body.error : "That didn't go through -- try again.";
        setRefusals((all) => ({ ...all, [id]: message }));
      }
    } finally {
      inFlight.current.delete(id);
      setBusy(new Set(inFlight.current));
    }
  }, []);

  if (initial.length === 0) {
    return <p className="text-muted-foreground text-sm">Nothing here.</p>;
  }

  return (
    <div className="bs-rows">
      {initial.map((row) => {
        const current = statuses[row.id] ?? row.status;
        const hold = busy.has(row.id);
        return (
          <div key={row.id} id={`name-${row.id}`} className="bs-review-row" data-moved={current !== row.status ? "" : undefined}>
            <div className="bs-who">
              <div className="bs-who-name">{row.english ?? "unnamed"}</div>
              <span className="bs-who-sub">
                {KIND_LABELS[row.kind]} #{row.entityId}
              </span>
            </div>

            <div className="min-w-0">
              <p className="bs-label">Current name</p>
              {row.currentName ? (
                <p className="bs-text">{row.currentName}</p>
              ) : (
                <p className="bs-text">
                  {row.english ?? "none"}
                  <span
                    className="text-muted-foreground ml-2 rounded-full border px-1.5 text-[11px] font-medium"
                    title="This language has no name for it yet"
                  >
                    English
                  </span>
                </p>
              )}
            </div>

            <div className="min-w-0">
              <p className="bs-label">Contributed name</p>
              <p className="bs-text">{row.name}</p>
            </div>

            <div className="bs-actions">
              {current === "new" ? (
                <>
                  <button
                    type="button"
                    className="bs-btn"
                    disabled={hold}
                    title="Show this name in the quest log and tracker for players of this language"
                    onClick={() => void resolve(row.id, "accepted")}
                  >
                    Keep
                  </button>
                  <button type="button" className="bs-btn bs-btn-text" disabled={hold} onClick={() => void resolve(row.id, "rejected")}>
                    Drop
                  </button>
                </>
              ) : current === "rejected" ? (
                <button type="button" className="bs-btn bs-btn-text" disabled={hold} onClick={() => void resolve(row.id, "new")}>
                  Reopen
                </button>
              ) : (
                <span className="text-muted-foreground text-sm">Kept</span>
              )}
              {refusals[row.id] ? <p className="bs-refusal">{refusals[row.id]}</p> : null}
            </div>

            <div className="bs-meta">
              <span>
                Sent by {row.uploaders} {row.uploaders === 1 ? "player" : "players"}
              </span>
              <span>Updated {when(row.updatedAt)}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
