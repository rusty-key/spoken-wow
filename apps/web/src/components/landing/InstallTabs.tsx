"use client";

import { useState } from "react";

import type { Lang } from "@/lib/lang";
import { fill } from "@/lib/site-text/format";
import WithLink from "@/lib/site-text/WithLink";

import BrandIcon from "./BrandIcon";
import { CURSEFORGE } from "./links";
import { useSiteText } from "./SiteTextProvider";

export type InstallLink = { kind: "curseforge" | "wago" | "github"; label: string; href: string };
export type InstallRow = { name: string; note: string; links: InstallLink[] };
export type InstallLanguage = {
  code: Lang;
  name: string;
  /** The language's CurseForge meta addon, or null where Spoken does not maintain one. */
  curseforge: string | null;
  /** Everything a manual install of this language takes, one row per download. */
  rows: InstallRow[];
};

type Tab = "manager" | "curseforge" | "manual";

const TABS: { id: Tab; icon: "spoken" | "curseforge" | "github" }[] = [
  { id: "manager", icon: "spoken" },
  { id: "curseforge", icon: "curseforge" },
  { id: "manual", icon: "github" },
];

/**
 * The three ways in: the Manager, a CurseForge meta addon per language, or a zip per pack.
 * The manual tab starts on the page's language, and the choice is a select rather than a table.
 */
export default function InstallTabs({
  languages,
  initial,
  managerUrl,
  downloads,
}: {
  languages: InstallLanguage[];
  initial: Lang;
  managerUrl: string;
  downloads: { windows: string; mac: string; macIntel: string; linux: string };
}) {
  const text = useSiteText();
  const t = text.install;
  const newTab = <span className="sr-only">{text.newTab}</span>;
  const [tab, setTab] = useState<Tab>("manager");
  const [lang, setLang] = useState<Lang>(initial);
  const chosen = languages.find((entry) => entry.code === lang) ?? languages[0];
  const maintained = languages.filter((entry) => entry.curseforge && entry.code !== "itIT");
  const italian = languages.find((entry) => entry.code === "itIT");
  const tabLabel = { manager: t.tabManager, curseforge: t.tabCurseforge, manual: t.tabManual };

  return (
    <div>
      <div className="bn-tabs" role="tablist" aria-label={t.waysLabel}>
        {TABS.map((entry) => (
          <button
            key={entry.id}
            type="button"
            role="tab"
            id={`bn-tab-${entry.id}`}
            aria-selected={tab === entry.id}
            aria-controls="bn-panel"
            tabIndex={tab === entry.id ? 0 : -1}
            className="bn-tab"
            onClick={() => setTab(entry.id)}
            onKeyDown={(event) => {
              const step = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
              const index = event.key === "Home" ? 0 : event.key === "End" ? TABS.length - 1 : -1;
              if (!step && index < 0) return;
              event.preventDefault();
              const here = TABS.findIndex((candidate) => candidate.id === entry.id);
              const next = TABS[index >= 0 ? index : (here + step + TABS.length) % TABS.length];
              setTab(next.id);
              document.getElementById(`bn-tab-${next.id}`)?.focus();
            }}
          >
            {entry.icon === "spoken" ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img className="bn-brand-icon" src="/landing/icons/spoken-192.png" alt="" width={20} height={20} />
            ) : (
              <BrandIcon name={entry.icon} />
            )}
            {tabLabel[entry.id]}
            {entry.id === "manager" && <span className="bn-tag">{t.recommended}</span>}
          </button>
        ))}
      </div>

      <div className="bn-panel" role="tabpanel" id="bn-panel" aria-labelledby={`bn-tab-${tab}`}>
        {tab === "manager" && (
          <>
            <p>{t.managerText}</p>
            <ul className="bn-pros">
              {t.managerPros.map((pro) => (
                <li key={pro}>{pro}</li>
              ))}
            </ul>
            <div className="bn-dl">
              <a className="bn-btn bn-btn-primary" href={downloads.windows}>
                <BrandIcon name="windows" />
                {t.windows}
              </a>
              <a className="bn-btn" href={downloads.mac}>
                <BrandIcon name="apple" />
                {t.macArm}
              </a>
              <a className="bn-btn" href={downloads.macIntel}>
                <BrandIcon name="apple" />
                {t.macIntel}
              </a>
              <a className="bn-btn" href={downloads.linux}>
                <BrandIcon name="linux" />
                {t.linux}
              </a>
            </div>
            <p className="bn-note">
              <WithLink
                text={t.otherFiles}
                link={
                  <a href={managerUrl} target="_blank" rel="noreferrer">
                    {t.releasePage}
                    {newTab}
                  </a>
                }
              />
            </p>
            <p className="bn-note">{t.italianVoice}</p>
          </>
        )}

        {tab === "curseforge" && (
          <>
            <p>{t.curseforgeText}</p>
            <ul className="bn-pros">
              {t.curseforgePros.map((pro, i) => (
                <li key={pro} className={i >= 2 ? "no" : undefined}>
                  {pro}
                </li>
              ))}
            </ul>
            <div className="bn-langs">
              {maintained.map((entry) => (
                <a
                  key={entry.code}
                  className="bn-btn"
                  href={`${CURSEFORGE}/${entry.curseforge}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  <BrandIcon name="curseforge" />
                  {entry.name}
                  {newTab}
                </a>
              ))}
            </div>
            {italian?.curseforge && (
              <p className="bn-note">
                <WithLink
                  text={fill(t.italianOthers, { note: t.italianNote })}
                  link={
                    <a href={`${CURSEFORGE}/${italian.curseforge}`} target="_blank" rel="noreferrer">
                      {t.italianLink}
                      {newTab}
                    </a>
                  }
                />
              </p>
            )}
          </>
        )}

        {tab === "manual" && (
          <>
            <p>{t.manualText}</p>
            <ul className="bn-pros">
              {t.manualPros.map((pro, i) => (
                <li key={pro} className={i === 2 ? "no" : undefined}>
                  {pro}
                </li>
              ))}
            </ul>
            <label>
              <span className="sr-only">{text.nav.language}</span>
              <select className="bn-select" value={lang} onChange={(event) => setLang(event.target.value as Lang)}>
                {languages.map((entry) => (
                  <option key={entry.code} value={entry.code}>
                    {entry.name}
                  </option>
                ))}
              </select>
            </label>
            <div className="bn-manual">
              {chosen.rows.map((row) => {
                const downloads = row.links.filter((link) => link.kind !== "curseforge");
                return (
                  <div key={row.name} className="bn-pack">
                    <div>
                      <b>{row.name}</b>
                      <small>{row.note}</small>
                    </div>
                    <div className="bn-links-row">
                      {row.links.some((link) => link.kind === "github") ? (
                        downloads.map((link) => (
                          <a key={link.href} className="bn-btn bn-btn-sm" href={link.href} target="_blank" rel="noreferrer">
                            {link.kind === "github" && <BrandIcon name="github" size={16} />}
                            {link.label}
                            {newTab}
                          </a>
                        ))
                      ) : (
                        <span className="none">{t.noPack}</span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
            {chosen.code === "itIT" && <p className="bn-note">{t.italianNote}</p>}
            <p className="bn-note">{t.oldClients}</p>
          </>
        )}
      </div>
    </div>
  );
}
