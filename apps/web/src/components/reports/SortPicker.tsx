"use client";

import { ChevronRight } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { useLang } from "@/components/LangProvider";
import Link from "@/components/LocaleLink";
import { withLang } from "@/lib/lang";
import { SOURCE_LABELS } from "@/lib/reports/reports";
import type { Source } from "@/lib/sections";
import { cn } from "@/lib/utils";

/** The order a triager is most likely to want: quests carry most of the reports. */
const ORDER: readonly Source[] = ["quests", "readables", "places", "bosses"];

export default function SortPicker({ counts }: { counts: Record<Source, { left: number; skipped: number }> }) {
  const lang = useLang();
  const router = useRouter();
  const [busy, setBusy] = useState<Source | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function reset(source: Source) {
    setBusy(source);
    setError(null);
    const response = await fetch(withLang(lang, `/api/reports/skip?source=${source}`), { method: "DELETE" }).catch(
      () => null,
    );
    setBusy(null);
    if (!response?.ok) return setError("Couldn't reset the skipped reports.");
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-3">
      {ORDER.map((source) => {
        const { left, skipped } = counts[source];
        return (
          <div key={source} className="bg-card rounded-xl border">
            <Link
              href={`/reports/sort/${source}`}
              aria-disabled={left === 0}
              className={cn(
                "flex items-center gap-4 px-5 py-5",
                left === 0 ? "pointer-events-none opacity-60" : "hover:bg-muted/50 active:bg-muted rounded-xl",
              )}
            >
              <span className="flex-1 text-lg font-medium">{SOURCE_LABELS[source]}</span>
              <span className="text-2xl font-semibold tabular-nums">{left}</span>
              <ChevronRight className="text-muted-foreground size-5" />
            </Link>
            {skipped > 0 ? (
              <div className="text-muted-foreground flex items-center justify-between border-t px-5 py-2.5 text-sm">
                <span>{skipped} skipped</span>
                <button
                  type="button"
                  disabled={busy !== null}
                  onClick={() => void reset(source)}
                  className="text-foreground -my-2 -mr-2 rounded-md px-2 py-2 font-medium underline-offset-2 hover:underline disabled:opacity-50"
                >
                  {busy === source ? "Resetting…" : "Reset"}
                </button>
              </div>
            ) : null}
          </div>
        );
      })}
      {error ? <p className="text-destructive text-sm">{error}</p> : null}
      <Link href="/reports/quests" className="text-muted-foreground mt-2 text-sm underline-offset-2 hover:underline">
        All reports as a table
      </Link>
    </div>
  );
}
