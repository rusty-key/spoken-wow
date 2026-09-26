import type { Metadata } from "next";
import { notFound } from "next/navigation";

import ActivityTable from "@/components/ActivityTable";
import { isCategory } from "@/lib/activity/kinds";
import { activityActors, isDay, listActivity, type Cursor } from "@/lib/activity/store";
import { viewerOf } from "@/lib/grants/store";
import { pageLang } from "@/lib/lang-server";
import { can, isAdmin } from "@/lib/permissions";
import { isSource } from "@/lib/sections";
import { currentSession } from "@/lib/session";

export const metadata: Metadata = { title: "Activity · Spoken" };

// Every act lands here as it happens; nothing about it can be cached between views.
export const dynamic = "force-dynamic";

/**
 * "at|id", as the table's Older link writes it. Anything else reads as the first page rather
 * than as an error: a stale or hand-edited link should still land somewhere useful.
 */
function cursorOf(raw: string | undefined): Cursor | undefined {
  if (!raw) return undefined;
  const bar = raw.lastIndexOf("|");
  const at = raw.slice(0, bar);
  const id = raw.slice(bar + 1);
  if (bar < 1 || !/^\d+$/.test(id) || Number.isNaN(Date.parse(at))) return undefined;
  return { at, id };
}

export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ lang: string }>;
  searchParams: Promise<{
    category?: string;
    actor?: string;
    source?: string;
    from?: string;
    to?: string;
    before?: string;
  }>;
}) {
  const lang = await pageLang(params);
  const session = await currentSession();

  // 404 rather than a redirect, like /reports: the log names who did what, and a member has
  // no business learning it exists. Language admins only -- the people who hand out grants
  // in a language are the ones who answer for what those grants were used to do.
  const viewer = await viewerOf(session);
  if (!session || !can(viewer, "admin", lang)) notFound();

  const raw = await searchParams;
  const filter = {
    category: isCategory(raw.category) ? raw.category : undefined,
    actorId: raw.actor || undefined,
    source: isSource(raw.source) ? raw.source : undefined,
    from: isDay(raw.from) ? raw.from : undefined,
    to: isDay(raw.to) ? raw.to : undefined,
  };
  // Account events (roles, bans, removals) span every language and name ban reasons, so only
  // a global admin sees them; an admin in this language alone does not.
  const global = isAdmin(viewer?.role);

  const [{ rows, next }, actors] = await Promise.all([
    listActivity({ lang, ...filter, before: cursorOf(raw.before), global }),
    activityActors(lang, global),
  ]);

  return (
    <main className="mx-auto max-w-6xl px-5 pt-6 pb-24">
      <h1 className="text-xl font-semibold">Activity</h1>
      <p className="text-muted-foreground mt-1 mb-5 text-sm">
        Everything done in this language, newest first, and who did it: takes cut and put
        back, text and pronunciation changes, voices, and who was given what. Changes that
        apply to every language are listed here too. Anything older than this log was
        rebuilt from what the site kept, so restores and removals before it began are missing.
      </p>

      <ActivityTable
        rows={rows}
        next={next ? `${next.at}|${next.id}` : null}
        paged={Boolean(raw.before)}
        filter={filter}
        actors={actors}
      />
    </main>
  );
}
