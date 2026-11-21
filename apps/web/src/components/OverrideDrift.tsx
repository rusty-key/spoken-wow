"use client";

/**
 * Says an override was saved over an original that has since changed, and answers it: saving the
 * same text again marks the new original as seen, and dropping goes back to it.
 */
import { useState } from "react";

import { useLang } from "@/components/LangProvider";
import { LiteButton } from "@/components/LiteControls";
import { dropOverride, saveOverride } from "@/lib/quests/override-client";

export default function OverrideDrift({
  file,
  lineId,
  text,
  onAnswered,
}: {
  /** Where the override is stored, which a voice's row inherits from its line's. */
  file: string;
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
    const response = await request().catch(() => null);
    setBusy(false);
    if (response?.ok) {
      onAnswered();
      return;
    }
    const body = (await response?.json().catch(() => null)) as { error?: string } | null;
    setError(body?.error ?? "That didn't go through -- try again.");
  }

  return (
    <span className="mt-1 flex flex-wrap items-center gap-1 text-xs text-amber-300">
      original changed since your override
      <LiteButton disabled={busy} onClick={() => void answer(() => saveOverride(lang, file, lineId, text))}>
        Keep
      </LiteButton>
      <LiteButton disabled={busy} onClick={() => void answer(() => dropOverride(lang, file))}>
        Drop
      </LiteButton>
      {error ? <span className="text-destructive">{error}</span> : null}
    </span>
  );
}
