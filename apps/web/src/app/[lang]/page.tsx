import type { Metadata } from "next";
import Image from "next/image";

import Link from "@/components/LocaleLink";
import LanguageSwitcher from "@/components/LanguageSwitcher";
import { BACKSTAGE_HREF } from "@/components/landing/backstage";
import { body, display } from "@/components/landing/fonts";
import BrandIcon from "@/components/landing/BrandIcon";
import Gallery from "@/components/landing/Gallery";
import HeroLine from "@/components/landing/HeroLine";
import InstallTabs, { type InstallLanguage, type InstallLink, type InstallRow } from "@/components/landing/InstallTabs";
import { CURSEFORGE, GITHUB, WAGO } from "@/components/landing/links";
import LoginPanel from "@/components/landing/LoginPanel";
import ManagerWindow from "@/components/landing/ManagerWindow";
import NavMenu from "@/components/landing/NavMenu";
import { NAV } from "@/components/landing/nav";
import NavSession from "@/components/landing/NavSession";
import Showcase from "@/components/landing/Showcase";
import { LOCALES, type Lang } from "@/lib/lang";
import { pageLang } from "@/lib/lang-server";
import { packFor, type Section } from "@/lib/packs";
import "@/components/landing/landing.css";

export const metadata: Metadata = {
  title: "Spoken: voiced quests, lore and books for World of Warcraft",
  description:
    "Spoken reads quest dialogue, NPC greetings, zone lore and in-world books aloud in WoW: Forever and Classic Era. Install it with the Spoken Manager, CurseForge or by hand.",
};

const RELEASES = `${GITHUB}/releases`;
const MANAGER_URL = `${RELEASES}/tag/manager-latest`;
const MANAGER_VERSION = "0.1.2";
const MANAGER_FILES = `${RELEASES}/download/manager-latest/Spoken-Manager`;
const MANAGER_DOWNLOADS = {
  windows: `${MANAGER_FILES}-Setup-${MANAGER_VERSION}.exe`,
  mac: `${MANAGER_FILES}-${MANAGER_VERSION}-mac-arm64.dmg`,
  macIntel: `${MANAGER_FILES}-${MANAGER_VERSION}-mac-x64.dmg`,
  linux: `${MANAGER_FILES}-${MANAGER_VERSION}-linux.AppImage`,
};
const DISCORD = "https://discord.gg/KgeQhjv9Rd";

/** CurseForge's one meta addon per language: Spoken, plus every voice pack in it. */
const META: Partial<Record<Lang, string>> = {
  enUS: "spoken-english",
  deDE: "spoken-german",
  esES: "spoken-spanish-eu",
  esMX: "spoken-spanish-al",
  frFR: "spoken-french",
  itIT: "spoken-italian",
  ptBR: "spoken-portuguese",
  ruRU: "spoken-russian",
  koKR: "spoken-korean",
  zhCN: "spoken-chinese-simplified",
  zhTW: "spoken-chinese-traditional",
};

const github = (release: string) => `${RELEASES}?q=${encodeURIComponent(release)}`;

const SECTIONS: { section: Section; name: string; note: string }[] = [
  { section: "quests", name: "Quests and Gossip", note: "Quest dialogue and what NPCs say" },
  { section: "places", name: "Places", note: "Lore of each zone" },
  { section: "readables", name: "Readables", note: "Books, letters and notes" },
  { section: "bosses", name: "Bosses", note: "The story of each dungeon and raid boss" },
];

function installRows(lang: Lang): InstallRow[] {
  const rows: InstallRow[] = [
    {
      name: "Spoken",
      note: "The addon. Required.",
      links: [
        { label: "CurseForge", href: `${CURSEFORGE}/spoken-player` },
        { label: "Wago", href: `${WAGO}/spoken-quests` },
        { label: "GitHub", href: github("spoken/") },
      ],
    },
  ];
  for (const { section, name, note } of SECTIONS) {
    const pack = packFor(section, lang);
    const links: InstallLink[] = [];
    if (pack?.split) {
      for (const part of pack.split) {
        links.push({ label: `CurseForge: ${part.label}`, href: `${CURSEFORGE}/${part.slug}` });
      }
    } else if (pack?.curseforge) {
      links.push({ label: "CurseForge", href: `${CURSEFORGE}/${pack.curseforge}` });
    }
    if (pack) links.push({ label: pack.split ? "GitHub: all" : "GitHub", href: github(pack.release) });
    rows.push({ name: `${name} voices`, note, links });
  }
  return rows;
}

const LANGUAGES: InstallLanguage[] = LOCALES.map(({ code, name }) => ({
  code,
  name,
  curseforge: META[code] ?? null,
  rows: installRows(code),
}));

const FLOW = [
  {
    title: "Players send lines",
    text: "Optional sharing in the Manager, or the Contribute page, sends quest, NPC and book text that has no voice yet.",
  },
  { title: "The team reviews", text: "Contributions are checked and translated where they need it." },
  { title: "Voices are made", text: "Recordings are generated on this website and checked by listeners." },
  { title: "Packs are updated", text: "New recordings ship as voice pack updates, which the Manager installs." },
];

const NEW_TAB = <span className="sr-only"> (opens in a new tab)</span>;

export default async function Page({ params }: { params: Promise<{ lang: string }> }) {
  const lang = await pageLang(params);

  return (
    <div className={`bn ${display.variable} ${body.variable}`}>
      <a className="bn-skip" href="#main">
        Skip to content
      </a>
      <header className="bn-nav">
        <div className="bn-wrap">
          <Link href="/" className="bn-brand" aria-label="Spoken">
            <Image src="/landing/icons/spoken-192.png" alt="" width={96} height={96} priority unoptimized />
            <span className="bn-brand-name bn-display">Spoken</span>
          </Link>
          <nav className="bn-links" aria-label="Sections">
            {NAV.map((link) => (
              <a key={link.href} href={link.href}>
                {link.label}
              </a>
            ))}
          </nav>
          <div className="bn-nav-end">
            <LanguageSwitcher />
            <NavSession />
            <NavMenu />
          </div>
        </div>
      </header>

      <main id="main" tabIndex={-1}>
        <section className="bn-hero">
          <div className="bn-hero-art">
            <Image src="/landing/hero.jpg" alt="" fill priority sizes="100vw" quality={80} />
          </div>
          <div className="bn-wrap">
            <div className="bn-hero-grid">
              <div>
                <h1 className="bn-display">Spoken reads World of Warcraft aloud</h1>
                <p className="bn-lede">
                  Quest dialogue, NPC greetings, zone lore and in-world books, voiced in ten languages with
                  subtitles on screen. Spoken is a free addon for WoW: Forever and Classic Era.
                </p>
                <div className="bn-cta">
                  <a className="bn-btn bn-btn-primary bn-btn-lg" href="#install">
                    Install Spoken
                  </a>
                  <a className="bn-btn bn-btn-lg bn-btn-ghost" href="#gallery">
                    See the gallery
                  </a>
                </div>
                <p className="bn-fine">The Spoken Manager runs on Windows, macOS and Linux.</p>
                <p className="bn-fine bn-works">Works with</p>
                <div className="bn-logos">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img className="bn-logo-forever" src="/landing/games/logo-forever.png" alt="World of Warcraft: Forever" />
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img className="bn-logo-era" src="/landing/games/logo-era.png" alt="World of Warcraft Classic Era" />
                </div>
              </div>
              <HeroLine />
            </div>
          </div>
        </section>

        <section className="bn-section" id="voices">
          <div className="bn-wrap">
            <div className="bn-head">
              <h2 className="bn-display">What Spoken voices</h2>
              <p>Four parts, each with its own on/off switch in the settings. Pick one to see what it does.</p>
            </div>
            <Showcase />
            <div className="bn-facts">
              <div>
                <h3>Subtitles and windows</h3>
                <p>
                  Show the words as subtitles, in a small window or in a large one. Words can be
                  highlighted as they are spoken. Every line has Stop and Replay.
                </p>
              </div>
              <div>
                <h3>Languages</h3>
                <p>
                  English, German, Spanish (Spain and Latin America), French, Portuguese, Russian, Korean
                  and both Chinese scripts. Italian is made by the community.
                </p>
              </div>
              <div>
                <h3>Reports</h3>
                <p>
                  If a line has a wrong word or voice, the Report button sends it to the people who
                  correct it. The fix comes in an update.
                </p>
              </div>
            </div>

            <div className="bn-compendium">
              <div>
                <h3 className="bn-display bn-h3">Azeroth&apos;s Compendium</h3>
                <p className="bn-lead">
                  Every quest, place story, readable and boss story in one window, with a search box. Play
                  any of them without going there.
                </p>
                <ul className="bn-compendium-tabs" aria-label="Tabs in the Compendium">
                  <li>
                    <img src="/landing/icons/game-quests.png" alt="" width={32} height={32} />
                    Quests
                  </li>
                  <li>
                    <img src="/landing/icons/game-places.png" alt="" width={32} height={32} />
                    Places
                  </li>
                  <li>
                    <img src="/landing/icons/game-readables.png" alt="" width={32} height={32} />
                    Readables
                  </li>
                  <li>
                    <img src="/landing/icons/game-bosses.png" alt="" width={32} height={32} />
                    Bosses
                  </li>
                </ul>
                <ul className="bn-list">
                  <li>Opens from the minimap menu, with /sp compendium, or from the Place Story button beside the world map</li>
                  <li>Text size and the text language are set on Spoken&apos;s page</li>
                </ul>
              </div>
              <figure className="bn-compendium-shot">
                <img
                  src="/landing/gallery/compendium-places.webp"
                  alt="The Compendium on its Places tab: the zones and areas in a list on the left, and the story of Shadowglen on the right"
                  width={1109}
                  height={731}
                  loading="lazy"
                  decoding="async"
                />
              </figure>
            </div>
          </div>
        </section>

        <section className="bn-section bn-section-alt" id="manager">
          <div className="bn-wrap">
            <div className="bn-manager">
              <div>
                <h2 className="bn-display bn-h2">Spoken Manager</h2>
                <p className="bn-lead">
                  A desktop app for Windows, macOS and Linux. It installs and updates Spoken and its voice
                  packs for every WoW install on your computer. An update downloads only the files that
                  changed, not the whole pack again.
                </p>
                <div className="bn-cta">
                  <a className="bn-btn bn-btn-primary bn-btn-lg" href={MANAGER_URL} target="_blank" rel="noreferrer">
                    Download the Manager{NEW_TAB}
                  </a>
                </div>
                <p className="bn-note">Windows .exe, macOS .dmg or Linux .AppImage, from the GitHub release page.</p>
              </div>
              <ol className="bn-steps">
                <li>
                  <strong>It finds your games</strong>
                  <span>Forever and Classic Era each get a card.</span>
                </li>
                <li>
                  <strong>You choose the languages</strong>
                  <span>Install Spoken and the voice packs you want with one button.</span>
                </li>
                <li>
                  <strong>Updates are one button</strong>
                  <span>New versions and new recordings show up as an Update button on the card.</span>
                </li>
              </ol>
            </div>

            <div className="bn-stage">
              <ManagerWindow />
            </div>

          </div>
        </section>

        <section className="bn-section" id="install">
          <div className="bn-wrap">
            <div className="bn-head">
              <h2 className="bn-display">Install Spoken</h2>
              <p>Choose one. Each installs Spoken and the voice packs for your language. Restart the game afterwards.</p>
            </div>
            <InstallTabs languages={LANGUAGES} initial={lang} managerUrl={MANAGER_URL} downloads={MANAGER_DOWNLOADS} />
          </div>
        </section>

        <section className="bn-section bn-section-alt" id="gallery">
          <div className="bn-wrap">
            <div className="bn-head">
              <h2 className="bn-display">Gallery</h2>
            </div>
            <Gallery />
          </div>
        </section>

        <section className="bn-section" id="fits">
          <div className="bn-wrap">
            <div className="bn-head">
              <h2 className="bn-display">Fits the way you play</h2>
              <p>Spoken follows your game&apos;s language and works alongside the addons that change how quests look.</p>
            </div>

            <div className="bn-fits">
              <div className="bn-fit">
                <h3>Voice languages</h3>
                <ul className="bn-chips">
                  {LANGUAGES.map((entry) => (
                    <li key={entry.code}>{entry.name}</li>
                  ))}
                </ul>
                <p>
                  Menus and settings follow the game&apos;s text language. The language you hear is a separate
                  choice, Voice Language, and plays once its voice pack is installed. Italian is made by the
                  community.
                </p>
              </div>

              <div className="bn-fit">
                <h3>Addons it works with</h3>
                <dl className="bn-addons">
                  <div>
                    <Image src="/landing/addons/dialogueui.png" alt="" width={48} height={48} unoptimized />
                    <dt>DialogueUI</dt>
                    <dd>
                      Adds a Listen button and marks the words being read inside its window. Its own
                      settings are left alone.
                    </dd>
                  </div>
                  <div>
                    <Image src="/landing/addons/ellesmereui.png" alt="" width={48} height={48} unoptimized />
                    <dt>EllesmereUI</dt>
                    <dd>Spoken&apos;s windows, scroll bars and Compendium can draw in its flat look and font.</dd>
                  </div>
                  <div>
                    <Image src="/landing/addons/leatrix-plus.png" alt="" width={48} height={48} unoptimized />
                    <dt>Leatrix Plus</dt>
                    <dd>
                      Quests it accepts or turns in for you are still read. Auto turn-in addons work the same
                      way.
                    </dd>
                  </div>
                  <div>
                    <Image src="/landing/addons/leatrix-maps.png" alt="" width={48} height={48} unoptimized />
                    <dt>Leatrix Maps</dt>
                    <dd>The Place Story panel sits beside the map frame Leatrix draws.</dd>
                  </div>
                </dl>
              </div>

              <div className="bn-fit">
                <h3>Game versions</h3>
                <p>
                  WoW: Forever and Classic Era. On the 1.12 and 3.3.5 clients Spoken starts in the
                  Large Window, and 3.3.5 can switch to subtitles.
                </p>
              </div>
            </div>
          </div>
        </section>

        <section className="bn-section bn-section-alt" id="backstage">
          <div className="bn-wrap">
            <div className="bn-head">
              <h2 className="bn-display">Backstage</h2>
              <p>Every voice in Spoken starts as a line a player sent in. Backstage is where the team takes it from there.</p>
            </div>
            <ol className="bn-flow">
              {FLOW.map((step) => (
                <li key={step.title}>
                  <b>{step.title}</b>
                  <span>{step.text}</span>
                </li>
              ))}
            </ol>
            <div className="bn-backstage">
              <div>
                <h3 className="bn-display bn-h3">Work on the voices</h3>
                <ul className="bn-list">
                  <li>Generate and replace voice recordings for quests, gossip, zones and books</li>
                  <li>Translate lines and set how names and words are pronounced</li>
                  <li>Review player reports and the lines players contributed</li>
                </ul>
                <p className="bn-note">
                  What you can change depends on your role in each language. Without an account you can
                  still browse the lines and <Link href="/contribute">upload the lines you collected</Link>.
                </p>
              </div>
              <LoginPanel />
            </div>
          </div>
        </section>

        <section
          className="bn-section bn-band bn-band-tall"
          id="community"
          style={{ "--art": "url(/landing/art-anniversary.jpg)", "--art-pos": "40% 40%" } as React.CSSProperties}
        >
          <div className="bn-wrap">
            <div className="bn-head">
              <h2 className="bn-display">Community</h2>
              <p>Forever keeps adding quests and NPCs. Spoken learns the new text from players.</p>
            </div>
            <div className="bn-community">
              <div>
                <h3>Share what you find</h3>
                <p>
                  Sharing is optional. Turn it on in the Manager and Spoken sends the quest and NPC text it has no voice
                  for, so it can be recorded.
                </p>
              </div>
              <div>
                <h3>Make a voice pack</h3>
                <p>
                  Another narrator, a missing language or fixes to an official pack. Packs are listed on
                  the Manager&apos;s Community page.
                </p>
              </div>
              <div>
                <h3>Get help</h3>
                <p>Help, bug reports and ideas have their own channels on Discord, in every language Spoken supports.</p>
                <a className="bn-btn bn-btn-primary bn-btn-sm" href={DISCORD} target="_blank" rel="noreferrer">
                  <BrandIcon name="discord" />
                  Join the Discord{NEW_TAB}
                </a>
              </div>
            </div>
          </div>
        </section>
      </main>

      <footer className="bn-footer">
        <div className="bn-wrap">
          <Link href="/" className="bn-brand" aria-label="Spoken">
            <Image src="/landing/icons/spoken-192.png" alt="" width={64} height={64} unoptimized />
            <span className="bn-brand-name bn-display">Spoken</span>
          </Link>
          <nav aria-label="Footer">
            <a href={RELEASES} target="_blank" rel="noreferrer">
              <BrandIcon name="github" size={16} />
              Releases{NEW_TAB}
            </a>
            <a href={GITHUB} target="_blank" rel="noreferrer">
              <BrandIcon name="github" size={16} />
              GitHub{NEW_TAB}
            </a>
            <a href={DISCORD} target="_blank" rel="noreferrer">
              <BrandIcon name="discord" size={16} />
              Discord{NEW_TAB}
            </a>
            <Link href={BACKSTAGE_HREF}>Browse the lines</Link>
            <Link href="/contribute">Contribute</Link>
          </nav>
          <p>
            Spoken is a fan project and is not affiliated with or endorsed by Blizzard Entertainment.
            World of Warcraft and the game artwork shown here belong to Blizzard Entertainment.
          </p>
        </div>
      </footer>
    </div>
  );
}
