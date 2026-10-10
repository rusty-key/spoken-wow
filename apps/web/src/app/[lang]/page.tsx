import type { Metadata } from "next";
import Image from "next/image";

import Link from "@/components/LocaleLink";
import { isClientLang, LOCALES, langName, type Lang } from "@/lib/lang";
import { pageLang } from "@/lib/lang-server";
import { packFor, PACKS, type Section } from "@/lib/packs";
import { cn } from "@/lib/utils";
import { Contained } from "@/components/Width";

export const metadata: Metadata = { title: "Spoken" };

const CURSEFORGE = "https://www.curseforge.com/wow/addons";
const WAGO = "https://addons.wago.io/addons";
const GITHUB_RELEASES = "https://github.com/rusty-key/spoken-wow/releases?q=";
const DISCORD = "https://discord.gg/HEGUgn6Yf";

/**
 * Discord's mark, from Simple Icons (CC0). Inline rather than from lucide-react, which
 * carries no brand icons. Filled with Discord's own blurple (#5865F2) from its brand kit.
 */
function DiscordIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="#5865F2" aria-hidden="true" className={className}>
      <path d="M20.317 4.3698a19.7913 19.7913 0 00-4.8851-1.5152.0741.0741 0 00-.0785.0371c-.211.3753-.4447.8648-.6083 1.2495-1.8447-.2762-3.68-.2762-5.4868 0-.1636-.3933-.4058-.8742-.6177-1.2495a.077.077 0 00-.0785-.037 19.7363 19.7363 0 00-4.8852 1.515.0699.0699 0 00-.0321.0277C.5334 9.0458-.319 13.5799.0992 18.0578a.0824.0824 0 00.0312.0561c2.0528 1.5076 4.0413 2.4228 5.9929 3.0294a.0777.0777 0 00.0842-.0276c.4616-.6304.8731-1.2952 1.226-1.9942a.076.076 0 00-.0416-.1057c-.6528-.2476-1.2743-.5495-1.8722-.8923a.077.077 0 01-.0076-.1277c.1258-.0943.2517-.1923.3718-.2914a.0743.0743 0 01.0776-.0105c3.9278 1.7933 8.18 1.7933 12.0614 0a.0739.0739 0 01.0785.0095c.1202.099.246.1981.3728.2924a.077.077 0 01-.0066.1276 12.2986 12.2986 0 01-1.873.8914.0766.0766 0 00-.0407.1067c.3604.698.7719 1.3628 1.225 1.9932a.076.076 0 00.0842.0286c1.961-.6067 3.9495-1.5219 6.0023-3.0294a.077.077 0 00.0313-.0552c.5004-5.177-.8382-9.6739-3.5485-13.6604a.061.061 0 00-.0312-.0286zM8.02 15.3312c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9555-2.4189 2.157-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.9555 2.4189-2.1569 2.4189zm7.9748 0c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9554-2.4189 2.1569-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.946 2.4189-2.1568 2.4189Z" />
    </svg>
  );
}

/**
 * The front door, written for a player rather than a developer: what this is, where to hear
 * it, and how to install it.
 *
 * Top to bottom: the logo and one sentence, the Discord invite, a button per explorer, then
 * the install section. That leads with Spoken Everything, because a player using an addon
 * manager in English needs nothing else, and follows with one table of every addon and every
 * sound pack by language for everybody else.
 *
 * THREE CHANNELS, AND NOT EVERYTHING IS ON ALL OF THEM. The slugs are identical on CurseForge
 * and Wago, so one slug addresses both -- but a sound pack is hundreds of megabytes and Wago's
 * upload endpoint refuses a file that size, and most languages' packs have no CurseForge
 * project yet. Every addon and every pack has a GitHub release, so GitHub is the one link
 * nearly every cell carries. The link is the releases query rather than a tag, so it does not
 * go stale the next time the audio is built.
 */
/** An addon as it is offered: CurseForge always, Wago when it is there, GitHub by tag prefix. */
type Addon = {
  slug: string;
  label: string;
  description: string;
  wago?: boolean;
  release?: string;
  /** The section whose sound packs it plays; none for the player itself. */
  section?: Section;
};

const ADDONS: Addon[] = [
  // First, since every other row needs it.
  {
    slug: "spoken-player",
    label: "Spoken Player",
    description: "Plays the audio for the other addons. Required by all of them.",
    wago: true,
    release: "spoken/",
  },
  {
    slug: "spoken-quests",
    label: "Spoken Quests",
    description: "Voices quest and gossip dialogue.",
    wago: true,
    release: "quests/",
    section: "quests",
  },
  {
    slug: "spoken-zones",
    label: "Spoken Zones",
    description: "Narrates the lore of each zone as you enter it.",
    wago: true,
    release: "zones/",
    section: "zones",
  },
  {
    slug: "spoken-books",
    label: "Spoken Books",
    description: "Reads books, letters and notes aloud.",
    wago: true,
    release: "books/",
    section: "books",
  },
];

/**
 * The explorers. Each carries the addon's own icon, the same art CurseForge and the in-game
 * addon list show -- the exported SVGs from pipelines/*, copied into public/icons/.
 */
const EXPLORERS = [
  { href: "/quests", icon: "/icons/quests.svg", title: "Quests" },
  // Quests' icon until gossip has its own addon, and with it its own art.
  { href: "/gossip", icon: "/icons/quests.svg", title: "Gossip" },
  { href: "/zones", icon: "/icons/zones.svg", title: "Zones" },
  { href: "/books", icon: "/icons/books.svg", title: "Books" },
];

/** The languages with at least one pack, in the site's order: the table's columns. */
const PACK_LANGS: Lang[] = LOCALES.map((locale) => locale.code).filter((code) =>
  PACKS.some((pack) => pack.lang === code),
);

/**
 * Pack languages no game client runs in (Italian). Every other pack plays on a client in its
 * language without being asked; these play only once a player picks them, so the table says so.
 */
const CHOSEN_LANGS: Lang[] = PACK_LANGS.filter((code) => !isClientLang(code));

const linkClass = "hover:text-foreground underline underline-offset-2";

function External({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noreferrer" className={linkClass}>
      {children}
    </a>
  );
}

const github = (release: string) => `${GITHUB_RELEASES}${encodeURIComponent(release)}`;

export default async function Page({ params }: { params: Promise<{ lang: string }> }) {
  const lang = await pageLang(params);

  return (
    <main className="pt-12 pb-24">
      <Contained>
        <div className="text-center">
          <h1>
            {/* Intrinsic 1024x187, the header's logo at hero size. */}
            <Image
              src="/logo.png"
              alt="Spoken WoW"
              width={350}
              height={64}
              priority
              className="mx-auto h-16 w-auto"
            />
          </h1>
          <p className="text-muted-foreground mx-auto mt-4 max-w-xl text-sm">
            Addons that make World of Warcraft Classic more immersive by voicing quest dialogue,
            zone lore and books. Install them from the links below, or open an explorer to hear the
            lines first.
          </p>
          <a
            href={DISCORD}
            target="_blank"
            rel="noreferrer"
            className="text-muted-foreground hover:text-foreground mt-4 inline-flex items-center gap-2 text-sm transition-colors"
          >
            <DiscordIcon className="h-5 w-5" />
            <span>
              Want to help or have feedback?{" "}
              <span className="text-foreground font-medium underline underline-offset-2">
                Join us on Discord
              </span>
            </span>
          </a>

          <nav className="mt-8 flex flex-wrap justify-center gap-3">
            {EXPLORERS.map((explorer) => (
              <Link
                key={explorer.href}
                href={explorer.href}
                className="hover:bg-accent inline-flex items-center gap-2.5 rounded-lg border px-5 py-3 font-medium transition-colors"
              >
                {/* Plain img, not next/image: fixed-size SVGs, which the optimiser passes
                    through untouched anyway. */}
                <img src={explorer.icon} alt="" width={28} height={28} className="h-7 w-7" />
                {explorer.title}
              </Link>
            ))}
          </nav>
        </div>

        <h2 className="mt-16 text-2xl font-semibold">How to install</h2>

        <div className="mt-4 text-sm">
          <p>
            Install <External href={`${CURSEFORGE}/spoken`}>Spoken Everything</External> from
            CurseForge or WowUp-CF if you use one of these managers. It brings in every addon and
            its English audio.
          </p>
          <p className="text-muted-foreground mt-1">
            <span aria-hidden="true">⚠️</span>{" "}
            <span className="text-foreground font-medium">Don&apos;t download and install it by hand.</span>{" "}
            It&apos;s a meta package and won&apos;t work on its own. For a manual install, see below.
          </p>
        </div>

        <div className="text-muted-foreground my-8 flex items-center gap-4 text-xs font-medium tracking-widest uppercase">
          <span className="h-px flex-1 bg-border" />
          or
          <span className="h-px flex-1 bg-border" />
        </div>

        <p className="text-muted-foreground mb-3 text-sm">
          Pick the addons you want and a sound pack in your language for each.
        </p>

        {/* A real table, scrolled inside its own box on a narrow screen so the page itself never
            scrolls sideways. Each pack cell stacks its links, which keeps eight language
            columns narrow enough to fit a desktop. */}
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full text-left text-xs">
            <thead className="text-muted-foreground">
              <tr className="border-b">
                <th rowSpan={2} className="px-3 py-2 font-medium">
                  Addon
                </th>
                <th rowSpan={2} className="min-w-48 px-3 py-2 font-medium">
                  Description
                </th>
                <th rowSpan={2} className="px-3 py-2 font-medium">
                  Download
                </th>
                <th colSpan={PACK_LANGS.length} className="border-l px-3 py-2 text-center font-medium">
                  Sound packs
                </th>
              </tr>
              <tr className="border-b">
                {PACK_LANGS.map((code, index) => (
                  <th
                    key={code}
                    className={cn(
                      "px-3 py-2 font-medium whitespace-nowrap",
                      index === 0 && "border-l",
                      code === lang && "text-foreground",
                    )}
                  >
                    {langName(code)}
                    {!isClientLang(code) && "*"}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {ADDONS.map((addon) => (
                <tr key={addon.slug} className="border-b last:border-b-0 align-top">
                  <td className="px-3 py-3 text-sm font-medium whitespace-nowrap">{addon.label}</td>
                  <td className="text-muted-foreground px-3 py-3">{addon.description}</td>
                  <td className="text-muted-foreground px-3 py-3">
                    <span className="flex flex-col gap-1">
                      <External href={`${CURSEFORGE}/${addon.slug}`}>CurseForge</External>
                      {addon.wago && <External href={`${WAGO}/${addon.slug}`}>Wago</External>}
                      {addon.release && <External href={github(addon.release)}>GitHub</External>}
                    </span>
                  </td>
                  {addon.section ? (
                    PACK_LANGS.map((code, index) => {
                      const pack = packFor(addon.section!, code);
                      return (
                        <td
                          key={code}
                          className={cn(
                            "text-muted-foreground px-3 py-3",
                            index === 0 && "border-l",
                            code === lang && "bg-accent/40",
                          )}
                        >
                          {pack ? (
                            <span className="flex flex-col gap-1">
                              {pack.split ? (
                                // Two to a line, so the English column is no wider than the rest.
                                <span className="flex flex-col gap-1">
                                  <span>CurseForge:</span>
                                  <span className="grid grid-cols-[auto_auto] justify-start gap-x-2 gap-y-1">
                                    {pack.split.map((part) => (
                                      <External key={part.slug} href={`${CURSEFORGE}/${part.slug}`}>
                                        {part.label}
                                      </External>
                                    ))}
                                  </span>
                                </span>
                              ) : (
                                pack.curseforge && (
                                  <External href={`${CURSEFORGE}/${pack.curseforge}`}>CurseForge</External>
                                )
                              )}
                              {pack.split ? (
                                // The bundle of the same four packs, as one download.
                                <span>
                                  GitHub: <External href={github(pack.release)}>All</External>
                                </span>
                              ) : (
                                <External href={github(pack.release)}>GitHub</External>
                              )}
                            </span>
                          ) : (
                            <span className="text-muted-foreground/40">—</span>
                          )}
                        </td>
                      );
                    })
                  ) : (
                    <td
                      colSpan={PACK_LANGS.length}
                      className="text-muted-foreground/60 border-l px-3 py-3 text-center"
                    >
                      No sound pack needed
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {CHOSEN_LANGS.length > 0 && (
          <p className="text-muted-foreground mt-2 text-xs">
            * No game client runs in {CHOSEN_LANGS.map(langName).join(" or ")}: install the pack,
            then choose the language under Voice Language in the addon&apos;s settings.
          </p>
        )}
      </Contained>
    </main>
  );
}
