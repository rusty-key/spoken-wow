"use client";

/**
 * A language's activity log: who did what, when, with the audio playable where there is any.
 *
 * Every filter lives in the URL, like /reports, so a narrowed log can be shared and the back
 * button undoes a filter. Paging is an Older link carrying a keyset cursor rather than page
 * numbers; see listActivity for why.
 */
import { ChevronDown, ChevronRight, Play } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import AudioPlayer from "@/components/AudioPlayer";
import DateChip from "@/components/DateChip";
import FilterChip from "@/components/FilterChip";
import { useLang } from "@/components/LangProvider";
import { Refreshing } from "@/components/Loading";
import Link from "@/components/LocaleLink";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { usePendingPush } from "@/components/usePendingPush";
import { CATEGORIES, categoryOf, FOLDS, type Category, type Group } from "@/lib/activity/kinds";
import type { ActivityRow } from "@/lib/activity/store";
import { usd } from "@/lib/generation/money";
import { isProvider, PROVIDER_NAME } from "@/lib/generation/providers";
import { localeHref, withLang } from "@/lib/lang";
import { explorerHref, lexiconHref } from "@/lib/links";
import { capabilityLabel, isCapability } from "@/lib/permissions";
import { SOURCE_LABELS } from "@/lib/reports/reports";
import { SOURCES, type Source } from "@/lib/sections";
import { cn } from "@/lib/utils";

type Filter = {
  category?: Category;
  actorId?: string;
  source?: Source;
  from?: string;
  to?: string;
};

const CATEGORY_LABELS: Record<Category, string> = {
  audio: "Audio",
  text: "Text & pronunciation",
  voices: "Voices",
  admin: "Admin",
};

const CATEGORY_OPTIONS = CATEGORIES.map((category) => ({
  value: category,
  label: CATEGORY_LABELS[category],
}));

const SOURCE_OPTIONS = SOURCES.map((source) => ({ value: source, label: SOURCE_LABELS[source] }));

/** One take the transport bar can be pointed at. */
type Take = { source: Source; file: string; version: number };

function time(at: string): string {
  return new Date(at).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}

function day(at: string): string {
  return new Date(at).toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

/** A capability the way /admin names it, or the raw string when a later release wrote one. */
function grantName(value: unknown): string | null {
  return isCapability(value) ? capabilityLabel(value) : str(value);
}

function str(value: unknown): string | null {
  return typeof value === "string" && value !== "" ? value : null;
}

function num(value: unknown): number | null {
  return typeof value === "number" ? value : null;
}

/** "1 line", "2 lines", or "? lines" for a count the row does not carry. */
function plural(n: number | null, noun: string, nouns = `${noun}s`): string {
  return `${n === null ? "?" : n.toLocaleString()} ${n === 1 ? noun : nouns}`;
}

/** "a → b", or whichever half is known: rows backfilled from older tables carry neither. */
function change(before: string | null, after: string | null): string | null {
  if (before && after) return `${before} → ${after}`;
  return after ?? before;
}

/**
 * What one row says happened, in words, plus the text it quotes. The quoted part is kept
 * apart so the row can clamp it without clamping the verb.
 */
function describe(row: ActivityRow): { what: string; quote: string | null } {
  const d = row.detail;
  const version = num(d.version);
  switch (row.kind) {
    case "take.generated": {
      const cost =
        num(d.costUsd) !== null
          ? usd(num(d.costUsd)!)
          : num(d.credits) !== null
            ? `${num(d.credits)!.toLocaleString()} credits`
            : null;
      const provider = isProvider(d.provider) ? ` with ${PROVIDER_NAME[d.provider]}` : "";
      return { what: `generated take v${version}${provider}`, quote: cost };
    }
    case "take.restored":
      return {
        what: num(d.from) ? `restored take v${version} over v${num(d.from)}` : `restored take v${version}`,
        quote: null,
      };
    case "recording.uploaded":
      return { what: `recorded v${version}`, quote: null };
    case "recording.removed":
      return { what: `removed recording v${version}`, quote: null };
    case "take.acked":
      return { what: "marked the audio fine after a pronunciation change", quote: row.lineId ? null : row.subject };
    case "marks.cleared":
      return {
        what: `marked ${plural(num(d.count), "file")} fine after a pronunciation change`,
        quote: null,
      };
    case "batch.queued":
      return {
        what: `queued ${plural(num(d.count), "line")} for regeneration`,
        quote: str(d.label),
      };
    case "batch.stopped":
      return {
        what: num(d.cancelled) ? `stopped a batch, cancelling ${plural(num(d.cancelled), "line")}` : "stopped a batch",
        quote: str(d.reason) ?? str(d.label),
      };
    case "queue.stopped":
      return {
        what: `stopped ${plural(num(d.batches), "batch", "batches")}, cancelling ${plural(num(d.cancelled), "line")}`,
        quote: str(d.reason),
      };
    case "queue.paused":
      return { what: "paused the regeneration queue", quote: null };
    case "queue.resumed":
      return { what: "resumed the regeneration queue", quote: null };
    case "text.edited":
      if (num(d.contribution)) {
        return { what: `took a correction from the game (contribution #${num(d.contribution)})`, quote: str(d.text) };
      }
      return { what: version ? `edited the text (v${version})` : "edited the text", quote: str(d.text) };
    case "text.restored":
      return { what: `restored text v${version}`, quote: null };
    case "name.edited":
      return { what: "renamed", quote: str(d.name) };
    case "lexicon.added":
      return { what: `added a pronunciation for “${row.subject}”`, quote: str(d.after) };
    case "lexicon.edited":
      return {
        what: `changed how “${row.subject}” is pronounced`,
        quote: change(str(d.before), str(d.after)),
      };
    case "lexicon.removed":
      return { what: `removed the pronunciation of “${row.subject}”`, quote: str(d.before) };
    case "override.set":
      if (num(d.contribution)) {
        return { what: `took a correction from the game (contribution #${num(d.contribution)})`, quote: str(d.text) };
      }
      return { what: "overrode the English text", quote: str(d.text) };
    case "override.cleared":
      return { what: "cleared the English text override", quote: str(d.before) };
    case "ignore.set":
      return {
        what: row.lang === null ? "ignored a line in every language" : "ignored a line",
        quote: str(d.reason),
      };
    case "ignore.cleared":
      return { what: "stopped ignoring a line", quote: null };
    case "setting.changed":
      return { what: `changed the ${str(d.setting) === "raceTags" ? "race tags" : "generation settings"}`, quote: null };
    case "voice.cloned":
      return {
        what: `cloned the voice “${row.subject}”${num(d.sampleCount) ? ` from ${num(d.sampleCount)} samples` : ""}`,
        quote: null,
      };
    case "reference.set":
      return { what: `set the fish.audio reference for “${row.subject}”`, quote: str(d.transcript) };
    case "reference.edited":
      return { what: `edited the reference transcript for “${row.subject}”`, quote: str(d.transcript) };
    case "reference.deleted":
      return { what: `deleted the fish.audio reference for “${row.subject}”`, quote: null };
    case "sample.added":
    case "sample.deleted":
    case "sample.imported":
    case "sample.merged": {
      const files = Array.isArray(d.files) ? (d.files as string[]) : [];
      const verb = row.kind.split(".")[1];
      const count = files.length === 1 ? "a sample" : `${files.length} samples`;
      return {
        what: `${verb === "added" ? "uploaded" : verb} ${count} for “${row.subject}”`,
        quote: files.join(", ") || null,
      };
    }
    case "npc.resolved":
      return {
        what: `set who ${str(d.npcName) ?? row.subject} is`,
        quote: [str(d.race), str(d.gender), str(d.flavor)].filter(Boolean).join(" · ") || null,
      };
    case "type.changed":
      return {
        what: `${str(d.action)?.replace("-", " ") ?? "changed"} ${row.subject}`,
        quote: [str(d.gender), str(d.flavor), str(d.voice)].filter(Boolean).join(" · ") || null,
      };
    case "grant.added":
      return { what: `gave ${row.subjectName ?? "someone"} ${grantName(d.capability)}`, quote: null };
    case "grant.removed":
      return { what: `took ${grantName(d.capability)} from ${row.subjectName ?? "someone"}`, quote: null };
    case "language.toggled":
      return { what: d.enabled ? "switched the language on" : "switched the language off", quote: null };
    case "contribution.resolved":
      return {
        what: `${str(d.status) ?? "resolved"} a ${d.correction ? "correction from the game" : "contribution"}`,
        quote: str(d.key),
      };
    case "contribution.edited":
      return { what: `changed a contribution's ${str(d.field) ?? "details"}`, quote: null };
    case "report.resolved":
      return { what: `marked a report ${str(d.status) ?? "resolved"}`, quote: str(d.category) };
    case "user.role_changed":
      return { what: `made ${row.subjectName ?? "a removed user"} ${str(d.role) ?? "?"}`, quote: null };
    case "user.banned":
      return { what: `banned ${row.subjectName ?? "a removed user"}`, quote: str(d.banReason) };
    case "user.unbanned":
      return { what: `unbanned ${row.subjectName ?? "a removed user"}`, quote: null };
    case "user.removed":
      return { what: "removed a user", quote: null };
    case "user.impersonated":
      return { what: `signed in as ${row.subjectName ?? "a removed user"}`, quote: null };
    // A kind this page does not know: one a newer release wrote before a rollback to this
    // one. Shown by its name rather than breaking the page.
    default:
      return { what: String(row.kind), quote: null };
  }
}

/** Where a row points, if anywhere: the line, the page that manages the thing, or nothing. */
function target(row: ActivityRow): { href: string; label: string } | null {
  if (row.source && row.lineId) return { href: explorerHref(row.source, row.lineId), label: row.lineId };
  if (categoryOf(row.kind) === "voices") return row.subject ? { href: "/voices", label: row.subject } : null;
  if (row.kind.startsWith("lexicon.") && row.subject) return { href: lexiconHref(row.subject), label: "Pronunciation" };
  if (row.kind.startsWith("grant.") || row.kind.startsWith("user.")) return { href: "/admin", label: "Users" };
  if (row.kind.startsWith("report.")) return { href: "/reports?view=all", label: `report ${row.subject}` };
  if (row.kind.startsWith("contribution.")) return { href: "/contributions", label: `contribution ${row.subject}` };
  return null;
}

const FOLD_OF = new Map(
  (Object.entries(FOLDS) as [Group, (typeof FOLDS)[Group]][]).map(([kind, fold]) => [fold.parent as string, { kind, ...fold }]),
);

/**
 * The rows a row opens onto, if it folds any (FOLDS). For a batch, `count` is what the
 * server counted for the page's day range.
 */
function groupOf(row: ActivityRow): { kind: Group; id: string; count: number; noun: readonly [string, string] } | null {
  const fold = FOLD_OF.get(row.kind);
  const id = fold && str(row.detail[fold.key]);
  if (!fold || !id) return null;
  const count = fold.count === null ? row.takes : num(row.detail[fold.count]);
  return { kind: fold.kind, id, count: count ?? 0, noun: fold.noun };
}

/** The takes a row lets you hear: the new one, and for a restore the one it replaced. */
function takesOf(row: ActivityRow): Take[] {
  if (!row.source || !row.subject) return [];
  const version = num(row.detail.version);
  if (version === null) return [];
  const take = (v: number): Take => ({ source: row.source!, file: row.subject!, version: v });
  if (row.kind === "take.generated") return [take(version)];
  if (row.kind === "take.restored") {
    const from = num(row.detail.from);
    return from ? [take(version), take(from)] : [take(version)];
  }
  return [];
}

/** A play button for one take, sized for a row or for a batch's list. */
function PlayTake({ take, onPlay, compact }: { take: Take; onPlay: (take: Take) => void; compact?: boolean }) {
  return (
    <Button
      size="sm"
      variant="ghost"
      className={compact ? "ml-auto h-6 px-2" : "h-7 px-2"}
      title={`Play v${take.version}`}
      onClick={() => onPlay(take)}
    >
      <Play className={compact ? "size-3" : "size-3.5"} /> v{take.version}
    </Button>
  );
}

export default function ActivityTable({
  rows,
  next,
  paged,
  filter,
  actors,
}: {
  rows: ActivityRow[];
  /** The cursor for the Older link, or null on the last page. */
  next: string | null;
  /** Whether this is a page after the first, which earns a link back to the newest. */
  paged: boolean;
  filter: Filter;
  actors: { id: string; name: string }[];
}) {
  const lang = useLang();
  const { pending, push } = usePendingPush();
  const audio = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState<Take | null>(null);
  // Bumped on every press so pressing the same take twice replays it; see ReportTable.
  const [pressed, setPressed] = useState(0);
  const [open, setOpen] = useState<string | null>(null);
  const loading = useRef(new Set<string>());
  // Keyed by group and day range: the same batch lists different takes under another range.
  const [groups, setGroups] = useState<Record<string, ActivityRow[] | "failed">>({});
  const rangeKey = `${filter.from ?? ""}:${filter.to ?? ""}`;

  useEffect(() => {
    if (pressed === 0) return;
    void audio.current?.play().catch(() => {});
  }, [pressed]);

  function play(take: Take) {
    setPlaying(take);
    setPressed((count) => count + 1);
  }

  /** Move one filter, keep the rest, and start again from the newest row. */
  function go(change: Partial<Record<keyof Filter, string | undefined>>) {
    const merged = { ...filter, ...change };
    const params = new URLSearchParams();
    if (merged.category) params.set("category", merged.category);
    if (merged.actorId) params.set("actor", merged.actorId);
    if (merged.source) params.set("source", merged.source);
    if (merged.from) params.set("from", merged.from);
    if (merged.to) params.set("to", merged.to);
    push(localeHref(lang, `/activity${params.size ? `?${params}` : ""}`));
  }

  function older() {
    if (!next) return;
    const params = new URLSearchParams(window.location.search);
    params.set("before", next);
    push(localeHref(lang, `/activity?${params}`));
  }

  function newest() {
    const params = new URLSearchParams(window.location.search);
    params.delete("before");
    push(localeHref(lang, `/activity${params.size ? `?${params}` : ""}`));
  }

  const keyOf = (group: { kind: Group; id: string }) => `${group.kind}:${group.id}:${rangeKey}`;

  async function toggleGroup(row: ActivityRow) {
    const group = groupOf(row);
    if (!group) return;
    const key = keyOf(group);
    const opening = open !== row.id;
    setOpen(opening ? row.id : null);
    // A failed load is tried again on the next open; one still in flight is not.
    if (!opening || Array.isArray(groups[key]) || loading.current.has(key)) return;
    loading.current.add(key);
    const params = new URLSearchParams({ id: group.id, kind: group.kind });
    if (filter.from) params.set("from", filter.from);
    if (filter.to) params.set("to", filter.to);
    const response = await fetch(withLang(lang, `/api/activity/batch?${params}`)).catch(() => null);
    const takes = response?.ok ? ((await response.json()) as { takes: ActivityRow[] }).takes : null;
    loading.current.delete(key);
    setGroups((current) => ({ ...current, [key]: takes ?? "failed" }));
  }

  // Day headings between rows, so a column of bare clock times can be read.
  let lastDay: string | null = null;

  return (
    <>
      <nav className="mb-4 flex flex-wrap items-center gap-2">
        <FilterChip
          label="what"
          value={filter.category}
          options={CATEGORY_OPTIONS}
          onChange={(value) => go({ category: value })}
        />
        <FilterChip
          label="who"
          value={filter.actorId}
          options={actors.map((actor) => ({ value: actor.id, label: actor.name }))}
          onChange={(value) => go({ actorId: value })}
        />
        <FilterChip
          label="section"
          value={filter.source}
          options={SOURCE_OPTIONS}
          onChange={(value) => go({ source: value })}
        />
        <DateChip label="from" value={filter.from} onChange={(value) => go({ from: value })} />
        <DateChip label="to" value={filter.to} onChange={(value) => go({ to: value })} />
        {pending && <Refreshing />}
      </nav>

      {rows.length === 0 ? (
        <p className="text-muted-foreground text-sm">Nothing happened here yet.</p>
      ) : (
        <table
          aria-busy={pending}
          className={cn(
            "w-full border-separate border-spacing-0 text-sm transition-opacity",
            pending && "opacity-60",
          )}
        >
          <tbody>
            {rows.flatMap((row) => {
              const heading = day(row.at);
              const out = [];
              if (heading !== lastDay) {
                lastDay = heading;
                out.push(
                  <tr key={`day-${row.id}`}>
                    <th
                      colSpan={4}
                      className="text-muted-foreground border-b pt-5 pb-1 text-left text-xs font-medium"
                    >
                      {heading}
                    </th>
                  </tr>,
                );
              }

              const { what, quote } = describe(row);
              const link = target(row);
              const takes = takesOf(row);
              const group = groupOf(row);
              const expanded = group !== null && open === row.id;

              out.push(
                <tr key={row.id} className="align-top [&>td]:border-b [&>td]:py-2 [&>td]:leading-5">
                  <td className="text-muted-foreground w-14 pr-3 text-xs whitespace-nowrap tabular-nums">
                    {time(row.at)}
                  </td>
                  <td className="w-40 max-w-[10rem] truncate pr-3 font-medium">
                    {row.actorName ?? <span className="text-muted-foreground font-normal">system</span>}
                  </td>
                  <td className="pr-3">
                    <div className="flex flex-wrap items-center gap-x-2">
                      {row.lang === null && (
                        <Badge variant="outline" className="py-0 leading-5">
                          all languages
                        </Badge>
                      )}
                      <span>{what}</span>
                      {link && (
                        <Link
                          href={link.href}
                          title={link.label}
                          className="text-muted-foreground max-w-[18rem] truncate font-mono text-xs underline-offset-2 hover:underline"
                        >
                          {link.label}
                        </Link>
                      )}
                    </div>
                    {quote && (
                      <p className="text-muted-foreground line-clamp-2 text-xs" title={quote}>
                        {quote}
                      </p>
                    )}
                  </td>
                  <td className="text-right whitespace-nowrap">
                    {takes.map((take) => (
                      <PlayTake key={take.version} take={take} onPlay={play} />
                    ))}
                    {group && group.count > 0 && (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 px-2"
                        aria-expanded={expanded}
                        onClick={() => void toggleGroup(row)}
                      >
                        {expanded ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
                        {plural(group.count, ...group.noun)}
                      </Button>
                    )}
                  </td>
                </tr>,
              );

              if (expanded && group) {
                const inner = groups[keyOf(group)];
                out.push(
                  <tr key={`${row.id}-takes`}>
                    <td />
                    <td colSpan={3} className="border-b pb-2">
                      {inner === undefined ? (
                        <p className="text-muted-foreground py-2 text-xs">Loading {group.noun[1]}…</p>
                      ) : inner === "failed" ? (
                        <p className="text-destructive py-2 text-xs">Could not load these {group.noun[1]}.</p>
                      ) : (
                        <ul className="max-h-80 overflow-y-auto text-xs">
                          {inner.map((take) => (
                            <li key={take.id} className="flex items-center gap-2 py-0.5">
                              <span className="text-muted-foreground w-12 tabular-nums">{time(take.at)}</span>
                              {take.kind === "batch.stopped" ? (
                                <span className="truncate">
                                  {str(take.detail.label) ?? "a batch"}
                                  {num(take.detail.cancelled) !== null && (
                                    <span className="text-muted-foreground">
                                      {" "}
                                      · {plural(num(take.detail.cancelled), "line")} cancelled
                                    </span>
                                  )}
                                </span>
                              ) : take.source && take.lineId ? (
                                <Link
                                  href={explorerHref(take.source, take.lineId)}
                                  className="truncate font-mono underline-offset-2 hover:underline"
                                >
                                  {take.lineId}
                                </Link>
                              ) : (
                                <span className="truncate font-mono">{take.subject}</span>
                              )}
                              {takesOf(take).map((one) => (
                                <PlayTake key={one.version} take={one} onPlay={play} compact />
                              ))}
                            </li>
                          ))}
                        </ul>
                      )}
                    </td>
                  </tr>,
                );
              }
              return out;
            })}
          </tbody>
        </table>
      )}

      {(paged || next) && (
        <div className="flex items-center justify-center gap-3 py-4">
          {paged && (
            <Button size="sm" variant="secondary" onClick={newest}>
              Newest
            </Button>
          )}
          {next && (
            <Button size="sm" variant="secondary" onClick={older}>
              Older
            </Button>
          )}
        </div>
      )}

      {/* Drawn once something has been played, like /reports: an idle bar over a log is
          chrome that answers nothing. The archived take is served by /api/takes/audio,
          which a language admin passes because admin includes regenerate. */}
      {playing && (
        <div className="fixed inset-x-0 bottom-0 z-40">
          <AudioPlayer
            audioRef={audio}
            src={withLang(
              lang,
              `/api/takes/audio?${new URLSearchParams({
                source: playing.source,
                file: playing.file,
                version: String(playing.version),
              })}`,
            )}
            title={playing.file}
            meta={`v${playing.version}`}
            downloadName={`${playing.file.split("/").pop()?.replace(/\.mp3$/, "")}-v${playing.version}.mp3`}
          />
        </div>
      )}
    </>
  );
}
