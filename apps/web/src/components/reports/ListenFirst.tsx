"use client";

/**
 * The note an /r/ page puts above its player: the game plays the clip its pack shipped with,
 * and this page plays the live take, which may be a fix made since. Without it a player
 * reports what they heard in the game without checking, and triage spends a listen on a
 * problem that is already gone.
 *
 * With the addon's context it says what it can: the player's pack against the newest, when the
 * line was last recorded, and whether that recording is in their pack, a newer one or none yet.
 * Without it, or before the context is read, it only asks for a listen.
 */
import { TriangleAlertIcon } from "lucide-react";
import { useMemo } from "react";

import { MANAGER_URL } from "@/components/landing/links";
import { useLang } from "@/components/LangProvider";
import { useGameContext } from "@/components/reports/useGameContext";
import { useLocalDates } from "@/components/useLocalDates";
import { packDownloads, packFor, partOf, type Pack, type PackPart } from "@/lib/packs";
import { contextFrom, lineNews, type LineNews, type PackRelease } from "@/lib/reports/context";
import type { Source } from "@/lib/sections";
import { cn } from "@/lib/utils";

const DAY: Intl.DateTimeFormatOptions = { day: "numeric", month: "long", year: "numeric" };

export default function ListenFirst({
  className,
  source,
  recordedAt = null,
  releases,
}: {
  className?: string;
  /** The section whose context to read; none on a page whose reports carry no context. */
  source?: Source;
  /** When the live take was generated. */
  recordedAt?: string | null;
  /** The section's releases in this page's language, newest first. */
  releases?: PackRelease[];
}) {
  const lang = useLang();
  const format = useLocalDates();
  const raw = useGameContext(source !== undefined);
  const context = useMemo(() => (source ? contextFrom(raw, source) : null), [raw, source]);
  // The take is this page's language's; a pack in another language says nothing about it.
  const news = context?.fields.pack === lang ? lineNews(context, releases, recordedAt) : null;
  const pack = source ? packFor(source, lang) : undefined;
  const part = partOf(pack, context?.fields.packFolder);
  const message = news && describe(news, part?.name ?? pack?.name ?? "your pack", format(news.recordedAt, DAY));

  return (
    <aside
      role="note"
      className={cn(
        "flex gap-3 rounded-md border border-amber-500/50 bg-amber-500/10 p-3 text-sm",
        message?.urgent && "border-2 border-amber-500/70 bg-amber-500/15 p-4",
        className,
      )}
    >
      <TriangleAlertIcon className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-400" />
      <div className="flex flex-col gap-1.5">
        <p className={cn("font-medium text-amber-700 dark:text-amber-300", message?.urgent && "text-base font-semibold")}>
          {message?.title ?? "Important: listen first"}
        </p>
        {message ? (
          <>
            {message.pack ? <p>{message.pack}</p> : null}
            <p>{message.line}</p>
            <p>{message.ask}</p>
            {news?.latest ? <Downloads pack={pack} part={part} /> : null}
          </>
        ) : (
          <p>This line may have changed since your pack. Play the current version below before reporting.</p>
        )}
      </div>
    </aside>
  );
}

/**
 * Where the newer pack comes from: the Manager, which updates every pack, then by hand. Of a
 * quests pack split on CurseForge, only the part the line plays from, where the addon said which.
 */
function Downloads({ pack, part }: { pack: Pack | undefined; part: PackPart | undefined }) {
  const links = [{ label: "Spoken Manager", href: MANAGER_URL }, ...(pack ? packDownloads(pack, part) : [])];
  return (
    <p className="flex flex-wrap gap-x-3 gap-y-1">
      <span>Update with:</span>
      {links.map((link) => (
        <a
          key={link.href}
          href={link.href}
          target="_blank"
          rel="noreferrer"
          className="font-medium underline underline-offset-2"
        >
          {link.label}
        </a>
      ))}
    </p>
  );
}

function describe(
  news: LineNews,
  name: string,
  recorded: string,
): { urgent: boolean; title: string; pack: string | null; line: string; ask: string } {
  const { version, latest, shipsIn, inYours } = news;
  const pack = !version
    ? null
    : latest
      ? `You are using ${name} ${version}, and ${latest} is available.`
      : news.exact
        ? `You are using ${name} ${version}.`
        : `You are using ${name} ${version}, the latest.`;
  const said = { title: latest ? "Your voice pack is out of date" : "Important: listen first", pack };

  if (inYours === false) {
    return {
      ...said,
      urgent: true,
      line: shipsIn
        ? `This line was re-recorded on ${recorded}, after your pack. The new recording is in ${shipsIn} and later.`
        : `This line was re-recorded on ${recorded}, after the latest pack. The new recording comes with the next one.`,
      ask: shipsIn
        ? "Play it below. If it sounds right, there is nothing to report: update your pack to hear it in the game."
        : "Play it below. If it sounds right, there is nothing to report: the fix is on its way.",
    };
  }
  if (inYours) {
    return {
      ...said,
      urgent: false,
      line: `This line has not been re-recorded since your pack: it was last recorded on ${recorded}, so you heard the current recording.`,
      ask: "Play it below to check, and report it if it is wrong.",
    };
  }
  return {
    ...said,
    urgent: latest !== null,
    line: `This line was last recorded on ${recorded}.`,
    ask: latest
      ? "Play it below before reporting. If it sounds right, update your pack to hear it in the game."
      : "Play the current version below before reporting.",
  };
}
