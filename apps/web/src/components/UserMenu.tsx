"use client";

import Link from "@/components/LocaleLink";
import { useGrants } from "@/components/GrantsProvider";
import { useLang } from "@/components/LangProvider";
import { useCan } from "@/components/useCan";
import { Menu, ShieldCheck } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import LanguageSwitcher from "@/components/LanguageSwitcher";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { signOut, useSession } from "@/lib/auth-client";
import { canSubmitPacks, isAdmin, langsWhere } from "@/lib/permissions";
import { triages } from "@/lib/reports/reports";
import { cn } from "@/lib/utils";

/**
 * What every visitor gets, signed in or not: the explorers, and the page an addon's
 * Contribute button leads to -- which is also where a player uploads what they gathered, and
 * had no way in from the site itself.
 */
const SECTIONS = [
  { href: "/quests", label: "Quests" },
  { href: "/places", label: "Places" },
  { href: "/bosses", label: "Bosses" },
  { href: "/readables", label: "Readables" },
  { href: "/contribute", label: "Contribute" },
];

type MenuLink = { href: string; label: string; admin?: boolean };

/** A column of links for the burger, or a row for the header. */
function Links({ links, column, onPick }: { links: MenuLink[]; column?: boolean; onPick?: () => void }) {
  return links.map((link) => (
    <Button
      key={link.href}
      asChild
      variant="ghost"
      size="sm"
      className={cn(column && "justify-start", link.admin && "text-primary-ink hover:text-primary-ink")}
    >
      <Link href={link.href} onClick={onPick}>
        {/* Gold and a shield, so the way into the admin pages does not read as one more section. */}
        {link.admin && <ShieldCheck aria-hidden />}
        {link.label}
      </Link>
    </Button>
  ));
}

/**
 * The session indicator in the header.
 *
 * It reads the session in the browser rather than through a server component on purpose:
 * an RSC session read in the root layout would opt every page into dynamic rendering and
 * put a database round trip in front of every page view of a tool that is otherwise served
 * entirely off disk.
 */
export default function UserMenu() {
  const router = useRouter();
  const { data: session, isPending } = useSession();
  // Controlled, so choosing a link closes the menu: a Radix popover stays open across a
  // client-side navigation otherwise, hanging over the page it just opened.
  const [open, setOpen] = useState(false);
  const [burger, setBurger] = useState(false);
  // What this person may do in the page's language. Only that one: a Portuguese translator
  // on an English page is a member there, and is offered what a member is.
  const may = useCan();
  const grants = useGrants();
  const lang = useLang();

  // Rendering nothing until the session resolves avoids a "Sign in" flash for a user who
  // is in fact signed in.
  if (isPending) return null;

  const role = session?.user.role;
  // Everything only a signed-in person can reach, in one menu rather than a header row that
  // grew a button per role until it wrapped.
  const links: MenuLink[] = !session
    ? []
    : [
        // Anybody who spends in the page's language: it is where they choose their generator.
        // canViewVoices, in the page's language like the rest.
        (may("regenerate") || may("configure")) && {
          href: "/voices",
          label: "Voices",
        },
        // Each of these is the page's language's own, and gated on the same capability there as
        // the page it opens -- so a link is never offered to a page that would answer 404.
        may("configure") && { href: "/lexicon", label: "Pronunciation" },
        triages(may) && { href: "/reports", label: "Reports" },
        may("text") && { href: "/contributions", label: "Contributions" },
        may("edit") && { href: "/missing-audio", label: "Missing audio" },
        // Who every NPC is holds in every language, so it is the global admin's alone.
        isAdmin(role) && { href: "/npcs", label: "NPCs" },
        // Who did what in this language: for whoever answers for the grants in it.
        may("admin") && { href: "/activity", label: "Activity" },
        // Global like the role: a pack names its own language.
        canSubmitPacks(role) && { href: "/packs", label: "My packs" },
        // Everyone signed in has one, and for somebody who may regenerate it is where their key
        // lives - which is the thing standing between them and the Regenerate button.
        { href: "/profile", label: "Profile" },
      ].filter((link): link is MenuLink => Boolean(link));

  // In the header row rather than the menu: it is where an admin works, not a setting. Any
  // language the viewer looks after counts, as /admin's own gate does, and it opens that
  // language's dashboard when the page is in one of them.
  const administered = session ? langsWhere({ role, grants }, "admin") : [];
  const admin: MenuLink[] =
    administered.length > 0
      ? [
          {
            // A site admin administers every language, and their way in is the list of everyone; a
            // team's admin lands on their team's dashboard.
            href: isAdmin(role)
              ? "/admin"
              : administered.includes(lang)
                ? `/admin/dashboard?lang=${lang}`
                : "/admin/dashboard",
            label: "Admin",
            admin: true,
          },
        ]
      : [];

  function signOutAndRefresh() {
    setOpen(false);
    setBurger(false);
    signOut().then(() => router.refresh());
  }

  const account = session ? (
    <div className="flex items-center justify-between gap-2 px-2 py-1.5">
      <span className="text-muted-foreground truncate text-xs">{session.user.email}</span>
      <Badge variant="outline" className="uppercase">
        {role ?? "member"}
      </Badge>
    </div>
  ) : null;

  return (
    <>
      {/* A phone has no room for a row of links: everything, the language switch included,
          folds into one menu below md. */}
      <Popover open={burger} onOpenChange={setBurger}>
        <PopoverTrigger asChild>
          <Button variant="ghost" size="icon" className="md:hidden" aria-label="Menu">
            <Menu />
          </Button>
        </PopoverTrigger>
        <PopoverContent align="end" className="flex w-64 flex-col gap-0.5 p-1.5 md:hidden">
          <div className="px-1 py-1">
            <LanguageSwitcher />
          </div>
          <Links links={SECTIONS} column onPick={() => setBurger(false)} />
          <div className="bg-border my-1 h-px" />
          {session ? (
            <>
              {account}
              <Links links={[...admin, ...links]} column onPick={() => setBurger(false)} />
              <Button variant="ghost" size="sm" className="justify-start" onClick={signOutAndRefresh}>
                Sign out
              </Button>
            </>
          ) : (
            <Links
              links={[
                { href: "/login", label: "Sign in" },
                { href: "/register", label: "Register" },
              ]}
              column
              onPick={() => setBurger(false)}
            />
          )}
        </PopoverContent>
      </Popover>

      {!session ? (
        <nav className="hidden items-center gap-1 md:flex">
          <Links links={SECTIONS} />
          <Button asChild variant="ghost" size="sm">
            <Link href="/login">Sign in</Link>
          </Button>
          <Button asChild variant="outline" size="sm">
            <Link href="/register">Register</Link>
          </Button>
        </nav>
      ) : (
        <nav className="hidden items-center gap-1 md:flex">
          <Links links={SECTIONS} />
          <Links links={admin} />
          <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
              <Button variant="outline" size="sm" className="ml-1">
                Profile
              </Button>
            </PopoverTrigger>
            <PopoverContent className="flex w-56 flex-col gap-0.5 p-1.5">
              {account}
              <Links links={links} column onPick={() => setOpen(false)} />
              <Button variant="ghost" size="sm" className="justify-start" onClick={signOutAndRefresh}>
                Sign out
              </Button>
            </PopoverContent>
          </Popover>
        </nav>
      )}
    </>
  );
}
