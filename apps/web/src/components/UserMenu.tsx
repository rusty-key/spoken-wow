"use client";

import Link from "@/components/LocaleLink";
import { useGrants, usePendingPacks } from "@/components/GrantsProvider";
import { useLang } from "@/components/LangProvider";
import { useCan } from "@/components/useCan";
import { Menu, ShieldCheck } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import LanguageSwitcher, { useOfferedLanguages } from "@/components/LanguageSwitcher";
import PendingCount, { packsWaiting } from "@/components/PendingCount";

import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { signOut, useSession } from "@/lib/auth-client";
import { stripLang } from "@/lib/lang";
import { isAdmin, langsWhere, roleLabel } from "@/lib/permissions";
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

type MenuLink = {
  href: string;
  label: string;
  admin?: boolean;
  count?: { value: number; title: string };
};

/** Must match site-nav.css's breakpoint, where the row of links gives way to the burger. */
const NARROW = "(max-width: 1023px)";

/**
 * How a link relates to the page the reader is on: "page" when it opens that page, "section" when
 * the page is under it (Admin on /admin/packs), so assistive tech hears "current page" only once.
 */
function where(href: string, path: string): "page" | "section" | null {
  const target = href.split("?")[0];
  if (path === target) return "page";
  return path.startsWith(`${target}/`) ? "section" : null;
}

function Links({
  links,
  column,
  path,
  onPick,
}: {
  links: MenuLink[];
  column?: boolean;
  path: string;
  onPick?: () => void;
}) {
  return links.map((link) => {
    const here = where(link.href, path);
    return (
      <Link
        key={link.href}
        href={link.href}
        onClick={onPick}
        aria-current={here === "page" ? "page" : undefined}
        data-section={here === "section" ? "" : undefined}
        className={cn(column && "sn-item", link.admin && "sn-admin")}
      >
        {/* Gold and a shield, so the way into the admin pages does not read as one more section. */}
        {link.admin && <ShieldCheck aria-hidden />}
        {link.label}
        {link.count && <PendingCount {...link.count} />}
      </Link>
    );
  });
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
  const path = stripLang(usePathname()).path;
  const { data: session, isPending } = useSession();
  // Controlled, so choosing a link closes the menu: a Radix popover stays open across a
  // client-side navigation otherwise, hanging over the page it just opened.
  const [open, setOpen] = useState(false);
  const [burger, setBurger] = useState(false);
  // What this person may do in the page's language. Only that one: a Portuguese translator
  // on an English page is a member there, and is offered what a member is.
  const may = useCan();
  const grants = useGrants();
  const [pendingPacks] = usePendingPacks();
  const lang = useLang();
  // Asked once for both switches, the row's and the burger's.
  const offered = useOfferedLanguages();

  // A menu whose trigger the breakpoint hides would stay open over the page, so crossing it closes
  // both and, if focus was in a menu, hands it to the trigger that is now shown.
  const crossed = useRef(false);
  useEffect(() => {
    const narrow = window.matchMedia(NARROW);
    const onChange = () => {
      const inMenu = document.activeElement?.closest(".sn-pop");
      crossed.current = Boolean(inMenu);
      setOpen(false);
      setBurger(false);
      if (inMenu) {
        requestAnimationFrame(() =>
          document.querySelector<HTMLElement>(narrow.matches ? ".sn-burger" : ".sn .bn-links a")?.focus(),
        );
      }
    };
    narrow.addEventListener("change", onChange);
    return () => narrow.removeEventListener("change", onChange);
  }, []);
  const keepFocus = (event: Event) => {
    if (!crossed.current) return;
    event.preventDefault();
    crossed.current = false;
  };

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
        // Not per language: a pack names its own.
        { href: "/packs", label: "My packs" },
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
            // Always 0 for a team's admin: only a site admin decides packs.
            count: packsWaiting(pendingPacks),
          },
        ]
      : [];

  function signOutAndRefresh() {
    setOpen(false);
    setBurger(false);
    signOut().then(() => router.refresh());
  }

  const account = session ? (
    <div className="sn-account">
      <span>{session.user.email}</span>
      <span className="sn-role">{roleLabel(role)}</span>
    </div>
  ) : null;

  const signIn: MenuLink[] = [
    { href: "/login", label: "Sign in" },
    { href: "/register", label: "Register" },
  ];

  return (
    <>
      <nav className="bn-links" aria-label="Sections">
        <Links links={SECTIONS} path={path} />
        <Links links={admin} path={path} />
      </nav>
      <div className="bn-nav-end">
        <div className="sn-wide">
          <LanguageSwitcher offered={offered} />
        </div>
        {/* Nothing until the session resolves, so a signed-in reader never sees "Sign in" flash. */}
        {isPending ? null : !session ? (
          <div className="sn-wide sn-signin">
            <Link className="bn-btn bn-btn-sm" href="/login">
              Sign in
            </Link>
            <Link className="bn-btn bn-btn-primary bn-btn-sm" href="/register">
              Register
            </Link>
          </div>
        ) : (
          <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
              <button type="button" className="bn-btn bn-btn-sm sn-wide">
                Profile
              </button>
            </PopoverTrigger>
            <PopoverContent align="end" className="bn-theme sn-pop" onCloseAutoFocus={keepFocus}>
              {account}
              <Links links={links} column path={path} onPick={() => setOpen(false)} />
              <div className="sn-rule" />
              <button type="button" className="sn-item" onClick={signOutAndRefresh}>
                Sign out
              </button>
            </PopoverContent>
          </Popover>
        )}

        <Popover open={burger} onOpenChange={setBurger}>
          <PopoverTrigger asChild>
            <button type="button" className="sn-burger" aria-label="Menu">
              <Menu size={20} aria-hidden />
            </button>
          </PopoverTrigger>
          <PopoverContent align="end" className="bn-theme sn-pop" onCloseAutoFocus={keepFocus}>
            <div className="sn-pop-lang">
              <LanguageSwitcher offered={offered} />
            </div>
            <Links links={SECTIONS} column path={path} onPick={() => setBurger(false)} />
            <div className="sn-rule" />
            {isPending ? null : session ? (
              <>
                {account}
                <Links links={[...admin, ...links]} column path={path} onPick={() => setBurger(false)} />
                <div className="sn-rule" />
                <button type="button" className="sn-item" onClick={signOutAndRefresh}>
                  Sign out
                </button>
              </>
            ) : (
              <Links links={signIn} column path={path} onPick={() => setBurger(false)} />
            )}
          </PopoverContent>
        </Popover>
      </div>
    </>
  );
}
