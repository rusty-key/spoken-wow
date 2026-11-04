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
import { SiteTextProvider } from "@/components/landing/SiteTextProvider";
import { LOCALES, type Lang } from "@/lib/lang";
import { pageLang } from "@/lib/lang-server";
import { packFor, type Section } from "@/lib/packs";
import { fill } from "@/lib/site-text/format";
import WithLink from "@/lib/site-text/WithLink";
import { nativeName } from "@/lib/site-text/names";
import { siteText, type SiteText } from "@/lib/site-text";
import "@/components/landing/landing.css";

export async function generateMetadata({ params }: { params: Promise<{ lang: string }> }): Promise<Metadata> {
  const { meta } = await siteText(await pageLang(params));
  return { title: meta.title, description: meta.description };
}

const RELEASES = `${GITHUB}/releases`;
const MANAGER_URL = `${RELEASES}/tag/manager-latest`;
const MANAGER_FILES = `${RELEASES}/download/manager-latest/Spoken-Manager`;
const MANAGER_DOWNLOADS = {
  windows: `${MANAGER_FILES}-Setup.exe`,
  mac: `${MANAGER_FILES}-mac-arm64.dmg`,
  macIntel: `${MANAGER_FILES}-mac-x64.dmg`,
  linux: `${MANAGER_FILES}-linux.AppImage`,
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

const SECTIONS: Section[] = ["quests", "places", "readables", "bosses"];

function installRows(lang: Lang, t: SiteText["install"]): InstallRow[] {
  const rows: InstallRow[] = [
    {
      name: t.addon,
      note: t.addonNote,
      links: [
        { kind: "curseforge", label: "CurseForge", href: `${CURSEFORGE}/spoken-player` },
        { kind: "wago", label: "Wago", href: `${WAGO}/spoken-quests` },
        { kind: "github", label: "GitHub", href: github("spoken/") },
      ],
    },
  ];
  for (const section of SECTIONS) {
    const pack = packFor(section, lang);
    const links: InstallLink[] = [];
    if (pack?.split) {
      for (const part of pack.split) {
        links.push({ kind: "curseforge", label: fill(t.curseforgePart, { part: part.label }), href: `${CURSEFORGE}/${part.slug}` });
      }
    } else if (pack?.curseforge) {
      links.push({ kind: "curseforge", label: "CurseForge", href: `${CURSEFORGE}/${pack.curseforge}` });
    }
    if (pack) links.push({ kind: "github", label: pack.split ? t.githubAll : "GitHub", href: github(pack.release) });
    rows.push({ name: fill(t.packName, { name: t.sections[section].name }), note: t.sections[section].note, links });
  }
  return rows;
}

const NEW_TAB = (text: string) => <span className="sr-only">{text}</span>;

export default async function Page({ params }: { params: Promise<{ lang: string }> }) {
  const lang = await pageLang(params);
  const t = await siteText(lang);
  const newTab = NEW_TAB(t.newTab);
  const languages: InstallLanguage[] = LOCALES.map(({ code }) => ({
    code,
    name: nativeName(code),
    curseforge: META[code] ?? null,
    rows: installRows(code, t.install),
  }));

  return (
    <SiteTextProvider text={t}>
      <div className={`bn ${display.variable} ${body.variable}`}>
        <a className="bn-skip" href="#main">
          {t.skip}
        </a>
        <header className="bn-nav">
          <div className="bn-wrap">
            <Link href="/" className="bn-brand" aria-label="Spoken">
              <Image src="/landing/icons/spoken-192.png" alt="" width={96} height={96} priority unoptimized />
              <span className="bn-brand-name bn-display">Spoken</span>
            </Link>
            <nav className="bn-links" aria-label={t.nav.sections}>
              {NAV.map((link) => (
                <a key={link.href} href={link.href}>
                  {t.nav[link.key]}
                </a>
              ))}
            </nav>
            <div className="bn-nav-end">
              <LanguageSwitcher variant="landing" label={t.nav.language} />
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
                  <h1 className="bn-display">{t.hero.title}</h1>
                  <p className="bn-lede">{t.hero.lede}</p>
                  <div className="bn-cta">
                    <a className="bn-btn bn-btn-primary bn-btn-lg" href="#install">
                      {t.hero.install}
                    </a>
                    <a className="bn-btn bn-btn-lg bn-btn-ghost" href="#gallery">
                      {t.hero.gallery}
                    </a>
                  </div>
                  <p className="bn-fine">{t.hero.managerRuns}</p>
                  <p className="bn-fine bn-works">{t.hero.worksWith}</p>
                  <div className="bn-logos">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img className="bn-logo-forever" src="/landing/games/logo-forever.png" alt={t.hero.foreverAlt} />
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img className="bn-logo-era" src="/landing/games/logo-era.png" alt={t.hero.eraAlt} />
                  </div>
                </div>
                <HeroLine />
              </div>
            </div>
          </section>

          <section className="bn-section" id="voices">
            <div className="bn-wrap">
              <div className="bn-head">
                <h2 className="bn-display">{t.voices.title}</h2>
                <p>{t.voices.intro}</p>
              </div>
              <Showcase />
              <div className="bn-facts">
                <div>
                  <h3>{t.voices.subtitlesTitle}</h3>
                  <p>{t.voices.subtitles}</p>
                </div>
                <div>
                  <h3>{t.voices.languagesTitle}</h3>
                  <p>{t.voices.languages}</p>
                </div>
                <div>
                  <h3>{t.voices.reportsTitle}</h3>
                  <p>{t.voices.reports}</p>
                </div>
              </div>

              <div className="bn-compendium">
                <div>
                  <h3 className="bn-display bn-h3">{t.voices.compendiumTitle}</h3>
                  <p className="bn-lead">{t.voices.compendium}</p>
                  <ul className="bn-compendium-tabs" aria-label={t.voices.compendiumTabs}>
                    <li>
                      <img src="/landing/icons/game-quests.png" alt="" width={32} height={32} />
                      {t.showcase.quests.title}
                    </li>
                    <li>
                      <img src="/landing/icons/game-places.png" alt="" width={32} height={32} />
                      {t.showcase.places.title}
                    </li>
                    <li>
                      <img src="/landing/icons/game-readables.png" alt="" width={32} height={32} />
                      {t.showcase.readables.title}
                    </li>
                    <li>
                      <img src="/landing/icons/game-bosses.png" alt="" width={32} height={32} />
                      {t.showcase.bosses.title}
                    </li>
                  </ul>
                  <ul className="bn-list">
                    <li>{t.voices.compendiumOpens}</li>
                    <li>{t.voices.compendiumText}</li>
                  </ul>
                </div>
                <figure className="bn-compendium-shot">
                  <img
                    src="/landing/gallery/compendium-places.webp"
                    alt={t.voices.compendiumShotAlt}
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
                  <h2 className="bn-display bn-h2">{t.manager.title}</h2>
                  <p className="bn-lead">{t.manager.lead}</p>
                  <div className="bn-cta">
                    <a className="bn-btn bn-btn-primary bn-btn-lg" href={MANAGER_URL} target="_blank" rel="noreferrer">
                      {t.manager.download}
                      {newTab}
                    </a>
                  </div>
                  <p className="bn-note">{t.manager.files}</p>
                </div>
                <ol className="bn-steps">
                  <li>
                    <strong>{t.manager.step1}</strong>
                    <span>{t.manager.step1Text}</span>
                  </li>
                  <li>
                    <strong>{t.manager.step2}</strong>
                    <span>{t.manager.step2Text}</span>
                  </li>
                  <li>
                    <strong>{t.manager.step3}</strong>
                    <span>{t.manager.step3Text}</span>
                  </li>
                </ol>
              </div>

              <div className="bn-stage">
                <ManagerWindow label={t.manager.windowLabel} />
              </div>
            </div>
          </section>

          <section className="bn-section" id="install">
            <div className="bn-wrap">
              <div className="bn-head">
                <h2 className="bn-display">{t.install.title}</h2>
                <p>{t.install.intro}</p>
              </div>
              <InstallTabs languages={languages} initial={lang} managerUrl={MANAGER_URL} downloads={MANAGER_DOWNLOADS} />
            </div>
          </section>

          <section className="bn-section bn-section-alt" id="gallery">
            <div className="bn-wrap">
              <div className="bn-head">
                <h2 className="bn-display">{t.gallery.title}</h2>
              </div>
              <Gallery />
            </div>
          </section>

          <section className="bn-section" id="fits">
            <div className="bn-wrap">
              <div className="bn-head">
                <h2 className="bn-display">{t.fits.title}</h2>
                <p>{t.fits.intro}</p>
              </div>

              <div className="bn-fits">
                <div className="bn-fit">
                  <h3>{t.fits.languagesTitle}</h3>
                  <ul className="bn-chips">
                    {languages.map((entry) => (
                      <li key={entry.code}>{entry.name}</li>
                    ))}
                  </ul>
                  <p>{t.fits.languages}</p>
                </div>

                <div className="bn-fit">
                  <h3>{t.fits.addonsTitle}</h3>
                  <dl className="bn-addons">
                    <div>
                      <Image src="/landing/addons/dialogueui.png" alt="" width={48} height={48} unoptimized />
                      <dt>DialogueUI</dt>
                      <dd>{t.fits.dialogueUi}</dd>
                    </div>
                    <div>
                      <Image src="/landing/addons/ellesmereui.png" alt="" width={48} height={48} unoptimized />
                      <dt>EllesmereUI</dt>
                      <dd>{t.fits.ellesmereUi}</dd>
                    </div>
                    <div>
                      <Image src="/landing/addons/leatrix-plus.png" alt="" width={48} height={48} unoptimized />
                      <dt>Leatrix Plus</dt>
                      <dd>{t.fits.leatrixPlus}</dd>
                    </div>
                    <div>
                      <Image src="/landing/addons/leatrix-maps.png" alt="" width={48} height={48} unoptimized />
                      <dt>Leatrix Maps</dt>
                      <dd>{t.fits.leatrixMaps}</dd>
                    </div>
                  </dl>
                </div>

                <div className="bn-fit">
                  <h3>{t.fits.versionsTitle}</h3>
                  <p>{t.fits.versions}</p>
                </div>
              </div>
            </div>
          </section>

          <section className="bn-section bn-section-alt" id="backstage">
            <div className="bn-wrap">
              <div className="bn-head">
                <h2 className="bn-display">{t.backstage.title}</h2>
                <p>{t.backstage.intro}</p>
              </div>
              <ol className="bn-flow">
                {t.backstage.flow.map((step) => (
                  <li key={step.title}>
                    <b>{step.title}</b>
                    <span>{step.text}</span>
                  </li>
                ))}
              </ol>
              <div className="bn-backstage">
                <div>
                  <h3 className="bn-display bn-h3">{t.backstage.workTitle}</h3>
                  <ul className="bn-list">
                    {t.backstage.work.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                  <p className="bn-note">
                    <WithLink text={t.backstage.roles} link={<Link href="/contribute">{t.backstage.upload}</Link>} />
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
                <h2 className="bn-display">{t.community.title}</h2>
                <p>{t.community.intro}</p>
              </div>
              <div className="bn-community">
                <div>
                  <h3>{t.community.shareTitle}</h3>
                  <p>{t.community.share}</p>
                </div>
                <div>
                  <h3>{t.community.packTitle}</h3>
                  <p>{t.community.pack}</p>
                </div>
                <div>
                  <h3>{t.community.helpTitle}</h3>
                  <p>{t.community.help}</p>
                  <a className="bn-btn bn-btn-primary bn-btn-sm" href={DISCORD} target="_blank" rel="noreferrer">
                    <BrandIcon name="discord" />
                    {t.community.discord}
                    {newTab}
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
            <nav aria-label={t.footer.label}>
              <a href={RELEASES} target="_blank" rel="noreferrer">
                <BrandIcon name="github" size={16} />
                {t.footer.releases}
                {newTab}
              </a>
              <a href={GITHUB} target="_blank" rel="noreferrer">
                <BrandIcon name="github" size={16} />
                GitHub{newTab}
              </a>
              <a href={DISCORD} target="_blank" rel="noreferrer">
                <BrandIcon name="discord" size={16} />
                Discord{newTab}
              </a>
              <Link href={BACKSTAGE_HREF}>{t.footer.browse}</Link>
              <Link href="/contribute">{t.footer.contribute}</Link>
            </nav>
            <p>{t.footer.disclaimer}</p>
          </div>
        </footer>
      </div>
    </SiteTextProvider>
  );
}
