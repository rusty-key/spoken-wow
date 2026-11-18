"use client";

/**
 * Says a team's override was saved over an original that has since changed, and answers it:
 * saving the same text again marks the new original as seen, and dropping goes back to it.
 */
import { useState } from "react";

import { useLang } from "@/components/LangProvider";
import { LiteButton } from "@/components/LiteControls";
import { dropTextOverride, saveTextOverride } from "@/lib/text-overrides/client";
import type { NarratedSource } from "@/lib/text-overrides/types";

export default function TextOverrideDrift({
  source,
  lineId,
  text,
  onAnswered,
}: {
  source: NarratedSource;
  lineId: string;
  text: string;
  onAnswered: () => void;
}) {
  const lang = useLang();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function answer(request: () => Promise<Response>) {
    setBusy(true);
    setError(null);
    try {
      const response = await request().catch(() => null);
      if (response?.ok) {
        onAnswered();
        return;
      }
      const body = (await response?.json().catch(() => null)) as { error?: string } | null;
      setError(body?.error ?? "That didn't go through -- try again.");
    } finally {
      // Only once the refusal is read: a retry started sooner would have its error overwritten.
      setBusy(false);
    }
  }

  return (
    <span className="mt-1 flex flex-wrap items-center gap-1 text-xs text-amber-300">
      The original changed since your override.
      <LiteButton disabled={busy} onClick={() => void answer(() => saveTextOverride(lang, source, lineId, text))}>
        Keep
      </LiteButton>
      <LiteButton disabled={busy} onClick={() => void answer(() => dropTextOverride(lang, source, lineId))}>
        Drop
      </LiteButton>
      {error ? (
        <span role="alert" className="text-destructive">
          {error}
        </span>
      ) : null}
    </span>
  );
}
