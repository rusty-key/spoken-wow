"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { createContext, useContext, useId, useState } from "react";

import { useLang } from "@/components/LangProvider";
import { useUiText } from "@/components/UiTextProvider";
import { useSession } from "@/lib/auth-client";
import { isAdmin } from "@/lib/permissions";
import { fill } from "@/lib/site-text/format";
import { pickedHref } from "@/lib/teams/view";
import type { TeamChoice, ViewedTeam } from "@/lib/teams/viewing";
import { cn } from "@/lib/utils";

/**
 * True below the site owner's acting banner, whose picker is then the page's one: a second
 * select could show another value. The read-only note still shows.
 */
const BannerPicker = createContext(false);

/** For the layout, a server component, which cannot render a context's provider itself. */
export function BannerShown({ shown, children }: { shown: boolean; children: React.ReactNode }) {
  return <BannerPicker value={shown}>{children}</BannerPicker>;
}

/**
 * Which team's takes the explorer plays, where the language has several teams, and a note
 * while it is another team's: that view is read-only. A site owner's pick is also the team they
 * act inside: it is saved first, so the view that follows is their own. Through the router,
 * not a history write, and refreshed, since the page and the layout resolve the view and the
 * acting team on the server.
 */
export default function TeamPicker({
  teams,
  viewed,
  home,
  className = "mb-3",
}: {
  /** As teamsVoicing lists them. */
  teams: TeamChoice[];
  viewed: ViewedTeam | null;
  /** The default team's slug, named by leaving `team` out of the address. */
  home: string | null;
  className?: string;
}) {
  const id = useId();
  const t = useUiText().catalogue.team;
  const lang = useLang();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const { data: session } = useSession();
  const [error, setError] = useState<string | null>(null);
  const bannerShows = useContext(BannerPicker);
  if (teams.length < 2 || viewed === null) return null;
  // A visitor in none of the teams starts on the first, which is not their own: no way back to it.
  const homeTeam = teams.find((team) => team.slug === home && team.slug !== viewed.slug);
  const note = !viewed.own && (
    <p className="text-muted-foreground">
      {fill(t.listening, { name: viewed.name })}
      {homeTeam && (
        <>
          {" "}
          <Link href={pickedHref(pathname, params, homeTeam.slug, home)} scroll={false} className="underline">
            {fill(t.back, { name: homeTeam.name })}
          </Link>
        </>
      )}
    </p>
  );
  if (bannerShows) return note ? <div className={cn("text-sm", className)}>{note}</div> : null;

  async function pick(slug: string) {
    setError(null);
    if (!isAdmin(session?.user.role)) {
      router.push(pickedHref(pathname, params, slug, home), { scroll: false });
      return;
    }
    const from = window.location.pathname + window.location.search;
    const response = await fetch("/api/teams/acting", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ lang, team: slug }),
    }).catch(() => null);
    const body = (await response?.json().catch(() => ({}))) as { home?: string | null; error?: string } | undefined;
    if (!response?.ok) {
      setError(body?.error ?? t.failed);
      return;
    }
    // Moved on while the save was in flight: the new page takes the saved team, and pushing the
    // address the pick began on would undo that move.
    if (window.location.pathname + window.location.search !== from) {
      router.refresh();
      return;
    }
    router.push(pickedHref(pathname, params, slug, body?.home ?? null), { scroll: false });
    router.refresh();
  }

  return (
    <div className={cn("flex flex-wrap items-center gap-x-3 gap-y-1 text-sm", className)}>
      <span className="flex items-center gap-2">
        <label htmlFor={id} className="text-muted-foreground">
          Team
        </label>
        <select
          id={id}
          className="border-input bg-background h-8 rounded-md border px-2 text-sm"
          value={viewed.slug}
          onChange={(event) => void pick(event.target.value)}
        >
          {teams.map((team) => (
            <option key={team.id} value={team.slug}>
              {team.name}
            </option>
          ))}
        </select>
      </span>
      {note}
      {error && <p className="text-destructive">{error}</p>}
    </div>
  );
}
