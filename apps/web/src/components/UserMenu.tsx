"use client";

import Link from "@/components/LocaleLink";
import { useGrants } from "@/components/GrantsProvider";
import { useCan } from "@/components/useCan";
import { Menu } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import LanguageSwitcher from "@/components/LanguageSwitcher";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { signOut, useSession } from "@/lib/auth-client";
import { isAdmin, langsWhere } from "@/lib/permissions";

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

type MenuLink = { href: string; label: string };

/** A column of links for the burger, or a row for the header. */
function Links({ links, column, onPick }: { links: MenuLink[]; column?: boolean; onPick?: () => void }) {
  return links.map((link) => (
    <Button key={link.href} asChild variant="ghost" size="sm" className={column ? "justify-start" : undefined}>
      <Link href={link.href} onClick={onPick}>
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
        (may("text") || may("edit")) && { href: "/reports", label: "Reports" },
        may("text") && { href: "/contributions", label: "Contributions" },
        may("edit") && { href: "/missing-audio", label: "Missing audio" },
        // Who every NPC is holds in every language, so it is the global admin's alone.
        isAdmin(role) && { href: "/npcs", label: "NPCs" },
        // Who did what in this language: for whoever answers for the grants in it.
        may("admin") && { href: "/activity", label: "Activity" },
        // Any language the viewer looks after, not the page's alone: /admin shows them all, and
        // is gated the same way.
        langsWhere({ role, grants }, "admin").length > 0 && {
          href: "/admin",
          label: "Users",
        },
        // Everyone signed in has one, and for somebody who may regenerate it is where their key
        // lives - which is the thing standing between them and the Regenerate button.
        { href: "/profile", label: "Profile" },
      ].filter((link): link is MenuLink => Boolean(link));

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
              <Links links={links} column onPick={() => setBurger(false)} />
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
