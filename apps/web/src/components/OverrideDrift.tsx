"use client";

/**
 * Says an override was saved over an original that has since changed, and answers it: saving the
 * same text again marks the new original as seen, and dropping goes back to it.
 */
import { useState } from "react";

import { LiteButton } from "@/components/LiteControls";

export default function OverrideDrift({
  file,
  lineId,
  text,
  canAnswer,
  onAnswered,
}: {
  file: string;
  lineId: string;
  text: string;
  /** The override route's own gate; everybody else only reads the note. */
  canAnswer: boolean;
  onAnswered: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function answer(method: "PUT" | "DELETE") {
    setBusy(true);
    setError(null);
    const response = await fetch(
      method === "PUT" ? "/api/quests/lines/override" : `/api/quests/lines/override?file=${encodeURIComponent(file)}`,
      {
        method,
        headers: { "Content-Type": "application/json" },
        body: method === "PUT" ? JSON.stringify({ file, lineId, text }) : undefined,
      },
    ).catch(() => null);
    setBusy(false);
    if (response?.ok) onAnswered();
    else setError("That didn't go through -- try again.");
  }

  return (
    <span className="flex flex-wrap items-center gap-1 text-amber-300">
      original changed since your override
      {canAnswer ? (
        <>
          <LiteButton disabled={busy} onClick={() => void answer("PUT")}>
            Keep
          </LiteButton>
          <LiteButton disabled={busy} onClick={() => void answer("DELETE")}>
            Drop
          </LiteButton>
        </>
      ) : null}
      {error ? <span className="text-destructive">{error}</span> : null}
    </span>
  );
}
