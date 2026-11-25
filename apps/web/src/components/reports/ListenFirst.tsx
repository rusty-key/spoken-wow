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
import { useUiText } from "@/components/UiTextProvider";
import { useGameContext } from "@/components/reports/useGameContext";
import { useLocalDates } from "@/components/useLocalDates";
import { packDownloads, packFor, partOf, type Pack, type PackPart } from "@/lib/packs";
import { fill } from "@/lib/site-text/format";
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
  const t = useUiText();
  const lang = useLang();
  const format = useLocalDates();
  const raw = useGameContext(source !== undefined);
  const context = useMemo(() => (source ? contextFrom(raw, source) : null), [raw, source]);
  // The take is this page's language's; a pack in another language says nothing about it.
  const news = context?.fields.pack === lang ? lineNews(context, releases, recordedAt) : null;
  const pack = source ? packFor(source, lang) : undefined;
  const part = partOf(pack, context?.fields.packFolder);
  const message =
    news &&
    describe(
      t.listenFirst,
      news,
      part?.name ?? pack?.name ?? t.listenFirst.yourPack,
      format(news.recordedAt, DAY),
    );

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
          {message?.title ?? t.listenFirst.important}
        </p>
        {message ? (
          <>
            {message.pack ? <p>{message.pack}</p> : null}
            <p>{message.line}</p>
            <p>{message.ask}</p>
            {news?.latest ? <Downloads pack={pack} part={part} /> : null}
          </>
        ) : (
          <p>{t.reports.mayHaveChanged}</p>
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
  const t = useUiText();
  const links = [{ label: t.listenFirst.manager, href: MANAGER_URL }, ...(pack ? packDownloads(pack, part) : [])];
  return (
    <p className="flex flex-wrap gap-x-3 gap-y-1">
      <span>{t.reports.updateWith}</span>
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

/** The note's sentences, already filled in: the dictionary is read where a hook can run. */
type Said = ReturnType<typeof useUiText>["listenFirst"];

function describe(
  said: Said,
  news: LineNews,
  name: string,
  recorded: string,
): { urgent: boolean; title: string; pack: string | null; line: string; ask: string } {
  const { version, latest, shipsIn, inYours } = news;
  const pack = !version
    ? null
    : latest
      ? fill(said.usingAvailable, { name, version, latest })
      : news.exact
        ? fill(said.using, { name, version })
        : fill(said.usingLatest, { name, version });
  const title = { title: latest ? said.outOfDate : said.important, pack };

  if (inYours === false) {
    return {
      ...title,
      urgent: true,
      line: shipsIn
        ? fill(said.reRecordedShips, { when: recorded, ships: shipsIn })
        : fill(said.reRecordedNext, { when: recorded }),
      ask: shipsIn ? said.playUpdate : said.fixOnWay,
    };
  }
  if (inYours) {
    return {
      ...title,
      urgent: false,
      line: fill(said.notReRecorded, { when: recorded }),
      ask: said.playCheck,
    };
  }
  return {
    ...title,
    urgent: latest !== null,
    line: fill(said.lastRecorded, { when: recorded }),
    ask: latest ? said.playBeforeUpdate : said.playBeforeReport,
  };
}
