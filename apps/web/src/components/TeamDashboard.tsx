"use client";

import { Check } from "lucide-react";
import Link from "next/link";

import { describe } from "@/components/ActivityTable";
import Avatar from "@/components/Avatar";
import { CAPABILITY_COLOURS } from "@/components/GrantCell";
import { useLang } from "@/components/LangProvider";
import { useUiText } from "@/components/UiTextProvider";
import { useLocalDates } from "@/components/useLocalDates";
import type { Dashboard } from "@/lib/admin/dashboard";
import { FOLDABLE, type ActivityRun } from "@/lib/admin/runs";
import { langName, localeHref, type Lang } from "@/lib/lang";
import type { Capability } from "@/lib/permissions";
import { CATEGORIES } from "@/lib/reports/reports";
import { fill } from "@/lib/site-text/format";
import type { UiText } from "@/lib/ui-text/en";
import { cn } from "@/lib/utils";

/** Which of the pages a task links to the viewer may open; a task without one shows no link. */
export type DashboardAccess = { contributions: boolean; reports: boolean; missing: boolean; activity: boolean };

type Task = {
  key: string;
  count: number;
  /** The count stopped at a limit, so there may be more. */
  atLeast?: boolean;
  title: string;
  detail: string;
  capabilities: Capability[];
  href: string | null;
  action: string;
};

const WHEN: Intl.DateTimeFormatOptions = { hour: "2-digit", minute: "2-digit" };
const DAY: Intl.DateTimeFormatOptions = { day: "numeric", month: "short" };

const joined = (parts: (string | false | null)[]) => parts.filter(Boolean).join(" · ");

/**
 * One language's open work, in the order it is usually taken: what is ready to ship, what
 * waits for a decision on its text, what players reported, what they heard in silence. Each
 * links to the page that already handles it; empty ones collect at the bottom as done.
 */
export default function TeamDashboard({ lang, data, access }: { lang: Lang; data: Dashboard; access: DashboardAccess }) {
  const date = useLocalDates();
  const to = (path: string) => localeHref(lang, path);
  // An admin page takes the team from `?lang=` and keeps the reader's site language.
  const siteLang = useLang();
  const t = useUiText().dashboard;
  const { contributions: c, reports, missing } = data;
  const reportTotal = CATEGORIES.reduce((sum, category) => sum + reports[category], 0);
  const contributionTotal = c.sections.quests + c.sections.readables + c.sections.places;

  const tasks: Task[] = [
    ...data.release.map((release) => ({
      key: `release:${release.section}`,
      count: release.count + release.textChanges,
      title: fill(t.release, { section: t.sections[release.section] }),
      detail: release.since
        ? joined([
            fill(t.releaseChanges, { n: (release.count + release.textChanges).toLocaleString() }),
            release.restored > 0 &&
              fill(t.releaseSplit, {
                added: (release.count - release.restored).toLocaleString(),
                restored: release.restored.toLocaleString(),
              }),
            release.textChanges > 0 && fill(t.releaseTextChanges, { n: release.textChanges.toLocaleString() }),
          ])
        : t.releaseNever,
      capabilities: ["admin" as const],
      href: localeHref(siteLang, `/admin/release?lang=${lang}`),
      action: t.reviewRelease,
    })),
    {
      key: "contributions",
      count: contributionTotal,
      title: t.contributions,
      detail: joined([
        c.sections.quests > 0 &&
          `${t.sections.quests} ${c.sections.quests}${
            c.quests.corrections
              ? fill(t.contributionsCorrections, {
                  n: c.quests.contributions.toLocaleString(),
                  m: c.quests.corrections.toLocaleString(),
                })
              : ""
          }`,
        c.sections.readables > 0 && `${t.sections.readables} ${c.sections.readables}`,
        c.sections.places > 0 && `${t.sections.places} ${c.sections.places}`,
      ]),
      capabilities: ["text"],
      href: access.contributions ? to("/contributions") : null,
      action: t.contributions,
    },
    {
      key: "reports",
      count: reportTotal,
      title: t.reports,
      detail: joined(CATEGORIES.map((category) => reports[category] > 0 && `${t.categories[category]} ${reports[category]}`)),
      capabilities: ["edit", "text"],
      href: access.reports ? to("/reports") : null,
      action: t.reports,
    },
    {
      key: "missing",
      count: missing.count,
      atLeast: missing.capped,
      title: t.missing,
      detail: joined([
        missing.capped ? t.missingCapped : t.missingHeard,
        missing.top && fill(t.missingTop, { line: missing.top.text ? `“${missing.top.text}”` : missing.top.lineId, n: missing.top.installs }),
      ]),
      capabilities: ["edit", "regenerate"],
      href: access.missing ? to("/missing-audio") : null,
      action: t.missing,
    },
  ];
  const open = tasks.filter((task) => task.count > 0);
  const done = tasks.filter((task) => task.count === 0);

  return (
    <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)]">
      <section className="bg-card rounded-lg border" aria-labelledby="open-heading">
        <h2 id="open-heading" className="flex items-baseline justify-between gap-3 border-b px-4 py-3 text-sm font-semibold">
          {fill(t.openIn, { lang: langName(lang) })}
          <span className="text-muted-foreground text-xs font-normal">
            {open.length === 0
              ? t.nothingWaiting
              : fill(open.length === 1 ? t.oneThingWaiting : t.thingsWaiting, { n: open.length.toLocaleString() })}
          </span>
        </h2>
        {open.map((task) => (
          <TaskRow key={task.key} task={task} holders={data.holders} t={t} />
        ))}
        {done.length > 0 && (
          <div className="text-muted-foreground flex items-start gap-3 px-4 py-3 text-sm">
            <Check className="mt-0.5 size-4 text-emerald-400" aria-hidden />
            <span>
              <span className="text-foreground font-medium">{t.clear}</span> {done.map((task) => task.title).join(", ")}
            </span>
          </div>
        )}
      </section>

      <section className="bg-card rounded-lg border" aria-labelledby="week-heading">
        <h2 id="week-heading" className="border-b px-4 py-3 text-sm font-semibold">
          {t.thisWeek}
        </h2>
        <dl className="grid grid-cols-3 border-b">
          {[
            [t.takesCut, data.week.takes],
            [t.contributionsAccepted, data.week.accepted],
            [t.releaseRuns, data.week.releases],
          ].map(([label, value], index) => (
            // The term first for a screen reader, the number first to the eye.
            <div key={label} className={cn("flex flex-col-reverse px-4 py-3", index > 0 && "border-l")}>
              <dt className="text-muted-foreground text-xs">{label}</dt>
              <dd className="text-xl font-semibold tracking-tight tabular-nums">{Number(value).toLocaleString()}</dd>
            </div>
          ))}
        </dl>
        {data.recent.length === 0 ? (
          <p className="text-muted-foreground px-4 py-4 text-sm">{fill(t.nothingYet, { lang: langName(lang) })}</p>
        ) : (
          <ul className="py-1">
            {data.recent.map((run) => {
              const { row } = run;
              const { what, quote } = run.count > 1 ? summary(run, t) : describe(row);
              // Each end on its own: a run from 23:40 to 00:20 spans two days.
              const at = (iso: string) =>
                date(iso, new Date(iso).toDateString() === new Date().toDateString() ? WHEN : DAY);
              return (
                <li key={row.id} className="grid grid-cols-[1.5rem_minmax(0,1fr)_auto] items-start gap-2.5 px-4 py-2 text-sm">
                  <Avatar name={row.actorName} className="border-card border-2" />
                  <span className="text-muted-foreground min-w-0">
                    <span className="text-foreground font-medium">{row.actorName || t.theSite}</span> {what}
                    {quote && <span className="block truncate text-xs">{quote}</span>}
                  </span>
                  <time dateTime={row.at} className="text-muted-foreground text-xs whitespace-nowrap tabular-nums">
                    {run.count > 1 && at(run.from) !== at(row.at) ? `${at(run.from)}–${at(row.at)}` : at(row.at)}
                  </time>
                </li>
              );
            })}
          </ul>
        )}
        {access.activity && (
          <div className="border-t px-4 py-2.5">
            <Link href={to("/activity")} className="text-primary-ink text-sm font-medium hover:underline">
              {t.allActivity}
            </Link>
          </div>
        )}
      </section>
    </div>
  );
}

/** What a run of several rows says, in one line: how many, of what, where. */
function summary(run: ActivityRun, t: UiText["dashboard"]): { what: string; quote: string | null } {
  const n = `${run.count.toLocaleString()}${run.atLeast ? "+" : ""}`;
  const where = run.row.source ? fill(t.inSection, { section: t.sections[run.row.source] }) : "";
  // Only foldable kinds make runs of more than one, and each of them has its words.
  const folded = (t.folded as Partial<Record<string, string>>)[run.row.kind] ?? FOLDABLE[run.row.kind]!;
  const words = fill(folded, { n, status: String(run.row.detail.status ?? "resolved") });
  return { what: `${words}${where}`, quote: null };
}

function TaskRow({ task, holders, t }: { task: Task; holders: Dashboard["holders"]; t: UiText["dashboard"] }) {
  const people = [
    ...new Map(task.capabilities.flatMap((capability) => holders[capability] ?? []).map((p) => [p.id, p])).values(),
  ];
  const named = people.map((person) => person.name ?? t.unnamed);
  const body = (
    <>
      <span className="text-primary-ink text-right text-2xl font-semibold tracking-tight tabular-nums">
        {task.count.toLocaleString()}
        {task.atLeast && "+"}
      </span>
      <span className="min-w-0">
        <span className="block font-semibold">{task.title}</span>
        {task.detail && <span className="text-muted-foreground block text-sm">{task.detail}</span>}
        <span className="mt-1.5 flex flex-wrap items-center gap-1.5">
          {task.capabilities.map((capability) => (
            <span key={capability} className={cn("rounded-full border px-2 py-px text-xs", CAPABILITY_COLOURS[capability])}>
              {t.capabilities[capability]}
            </span>
          ))}
          {people.length > 0 ? (
            <span className="ml-1 flex" title={named.join(", ")}>
              {people.slice(0, 5).map((person) => (
                <Avatar key={person.id} name={person.name} className="border-card -ml-1.5 border-2 first:ml-0" />
              ))}
            </span>
          ) : (
            <span className="text-destructive text-xs">{t.nobodyHolds}</span>
          )}
        </span>
      </span>
      <span className={cn("text-sm font-medium whitespace-nowrap", task.href ? "text-primary-ink" : "text-muted-foreground")}>
        {task.href ? `${task.action} →` : t.notYours}
      </span>
    </>
  );
  const className = "grid grid-cols-[3.25rem_minmax(0,1fr)_auto] items-center gap-4 border-b px-4 py-3.5";
  const linked = cn(className, "hover:bg-muted/20 focus-visible:bg-muted/20");
  return task.href ? (
    <Link href={task.href} className={linked}>
      {body}
    </Link>
  ) : (
    <div className={className}>{body}</div>
  );
}
