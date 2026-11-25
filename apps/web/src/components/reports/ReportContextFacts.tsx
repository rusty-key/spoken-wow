/**
 * What the player's addon said it saw when Report was pressed: the facts, then the text.
 *
 * Shown as the player's claim, never as the line: the fragment is written by a client, and a
 * hand-edited link is as easy to send as a real one.
 */
"use client";

import { useState, type ReactNode } from "react";

import { useUiText } from "@/components/UiTextProvider";
import { fill } from "@/lib/site-text/format";

import {
  LATEST_VERSION,
  contextFacts,
  outdatedPack,
  outdatedVersion,
  packVersion,
  type PackVersions,
  type ReportContext,
} from "@/lib/reports/context";
import { cn } from "@/lib/utils";

export default function ReportContextFacts({
  context,
  className,
}: {
  context: ReportContext;
  className?: string;
}) {
  const w = useUiText().reports.landing;
  const facts = contextFacts(context, w.facts, fill);
  return (
    <div className={cn("flex flex-col gap-2 text-xs", className)}>
      {facts.length ? (
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5">
          {facts.map((fact) => (
            <div key={fact.label} className="contents">
              <dt className="text-muted-foreground">{fact.label}</dt>
              <dd className="break-words">{fact.value}</dd>
            </div>
          ))}
        </dl>
      ) : null}
      {context.text ? (
        <blockquote className="border-l-2 pl-2 text-sm break-words whitespace-pre-wrap">
          {context.text}
        </blockquote>
      ) : null}
    </div>
  );
}

/**
 * The context folded under a report in triage, its summary just the versions: the pack first, as
 * it holds the audio, then Spoken. One that is behind the newest release turns amber as
 * "old/newest", the newer pack outranking a newer addon, with what that means in its tooltip.
 * Might, because the version says nothing about whether the release touched this line.
 *
 * `latestPacks` are the section's newest released pack versions by language.
 *
 * `children` follow the facts and are drawn only once the context is opened, so what they fetch
 * is fetched for the reports somebody reads rather than for every row on the page.
 */
export function ReportContextNote({
  context,
  latestPacks,
  children,
}: {
  context: ReportContext | null;
  latestPacks: PackVersions;
  children?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const w = useUiText().reports.landing;
  if (!context) return null;
  const spoken = context.fields.addon?.split("/")[1];
  const pack = packVersion(context);
  const oldPack = outdatedPack(context, latestPacks);
  const oldSpoken = !oldPack && outdatedVersion(context) ? LATEST_VERSION : null;
  const parts = [
    pack && (
      <Version
        key="pack"
        kind="from"
        version={pack}
        latest={oldPack?.latest}
        from={w.fromVersion}
        spoken={w.spokenVersion}
        hint={w.versionHint}
      />
    ),
    spoken && (
      <Version
        key="spoken"
        kind="spoken"
        version={spoken}
        latest={oldSpoken}
        from={w.fromVersion}
        spoken={w.spokenVersion}
        hint={w.versionHint}
      />
    ),
  ].filter(Boolean);
  return (
    <details
      className="mt-1 text-xs"
      onClick={(event) => event.stopPropagation()}
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary className="text-muted-foreground cursor-pointer">
        {parts.length ? parts.flatMap((part, i) => (i ? [", ", part] : [part])) : w.fromGame}
      </summary>
      <ReportContextFacts context={context} className="mt-1.5" />
      {open ? children : null}
    </details>
  );
}

/** One version the report was filed against, amber where a newer one exists. */
function Version({
  kind,
  version,
  latest,
  from,
  spoken,
  hint,
}: {
  kind: "from" | "spoken";
  version: string;
  latest?: string | null;
  /** "from {version}": the pack the player was hearing. */
  from: string;
  /** "spoken {version}": the addon. */
  spoken: string;
  hint: string;
}) {
  const wrap = kind === "from" ? from : spoken;
  if (!latest) return fill(wrap, { version });
  return (
    <span
      className="text-amber-600 dark:text-amber-400"
      title={fill(hint, { version, latest })}
    >
      {fill(wrap, { version })}/{latest}
    </span>
  );
}
