"use client";

import { useState } from "react";

import type { Lang } from "@/lib/lang";

import BrandIcon from "./BrandIcon";
import { CURSEFORGE } from "./links";

export type InstallLink = { label: string; href: string };
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

const TABS: { id: Tab; label: string; icon: "spoken" | "curseforge" | "github" }[] = [
  { id: "manager", label: "Spoken Manager", icon: "spoken" },
  { id: "curseforge", label: "CurseForge", icon: "curseforge" },
  { id: "manual", label: "By hand", icon: "github" },
];

const NEW_TAB = <span className="sr-only"> (opens in a new tab)</span>;

/** No game client runs in Italian, so its pack plays only once the language is chosen in Spoken. */
const ITALIAN_NOTE = "No game client runs in Italian: install the pack, then choose the language under Voice Language in Spoken's settings.";

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
  const [tab, setTab] = useState<Tab>("manager");
  const [lang, setLang] = useState<Lang>(initial);
  const chosen = languages.find((entry) => entry.code === lang) ?? languages[0];
  const maintained = languages.filter((entry) => entry.curseforge && entry.code !== "itIT");
  const italian = languages.find((entry) => entry.code === "itIT");

  return (
    <div>
      <div className="bn-tabs" role="tablist" aria-label="Ways to install Spoken">
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
            {entry.label}
            {entry.id === "manager" && <span className="bn-tag">Recommended</span>}
          </button>
        ))}
      </div>

      <div className="bn-panel" role="tabpanel" id="bn-panel" aria-labelledby={`bn-tab-${tab}`}>
        {tab === "manager" && (
          <>
            <p>
              Download the Manager, open it and press Install. It finds your game folder, installs Spoken
              and the voice packs for the languages you pick, and updates them when a new version comes
              out. An update downloads only the files that changed, so a new recording does not mean
              downloading the whole pack again.
            </p>
            <ul className="bn-pros">
              <li>Finds your game folder</li>
              <li>Updates download only what changed, not the whole pack</li>
              <li>Installs every pack, in any language</li>
              <li>Optional sharing sends the lines you collect, a few minutes after you log out</li>
              <li>Lists community voice packs</li>
            </ul>
            <div className="bn-dl">
              <a className="bn-btn bn-btn-primary" href={downloads.windows}>
                <BrandIcon name="windows" />
                Windows (.exe)
              </a>
              <a className="bn-btn" href={downloads.mac}>
                <BrandIcon name="apple" />
                macOS, Apple silicon (.dmg)
              </a>
              <a className="bn-btn" href={downloads.macIntel}>
                <BrandIcon name="apple" />
                macOS, Intel (.dmg)
              </a>
              <a className="bn-btn" href={downloads.linux}>
                <BrandIcon name="linux" />
                Linux (.AppImage)
              </a>
            </div>
            <p className="bn-note">
              Other files are on the{" "}
              <a href={managerUrl} target="_blank" rel="noreferrer">
                release page{NEW_TAB}
              </a>
              . If Windows SmartScreen stops the installer, choose More info, then Run anyway.
            </p>
            <p className="bn-note">For Italian, choose the language under Voice Language in Spoken&apos;s settings.</p>
          </>
        )}

        {tab === "curseforge" && (
          <>
            <p>
              Install the Spoken addon for your language in the CurseForge app. It pulls in Spoken and
              every voice pack for that language. It only works through the app: the website download
              of a meta addon is empty.
            </p>
            <ul className="bn-pros">
              <li>One meta addon per language</li>
              <li>Updates through the CurseForge app</li>
              <li className="no">Works only through the app</li>
              <li className="no">New packs can take longer to appear</li>
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
                  {NEW_TAB}
                </a>
              ))}
            </div>
            {italian?.curseforge && (
              <p className="bn-note">
                Italian is made by others and not maintained here:{" "}
                <a href={`${CURSEFORGE}/${italian.curseforge}`} target="_blank" rel="noreferrer">
                  Spoken Italian{NEW_TAB}
                </a>
                . {ITALIAN_NOTE}
              </p>
            )}
          </>
        )}

        {tab === "manual" && (
          <>
            <p>Pick your language, download each zip and unzip them into Interface/AddOns.</p>
            <ul className="bn-pros">
              <li>Plain zips from GitHub</li>
              <li>The only route for the 1.12 and 3.3.5 clients</li>
              <li className="no">You update every zip yourself</li>
            </ul>
            <label>
              <span className="sr-only">Language</span>
              <select
                className="bn-select"
                value={lang}
                onChange={(event) => setLang(event.target.value as Lang)}
              >
                {languages.map((entry) => (
                  <option key={entry.code} value={entry.code}>
                    {entry.name}
                  </option>
                ))}
              </select>
            </label>
            <div className="bn-manual">
              {chosen.rows.map((row) => (
                <div key={row.name} className="bn-pack">
                  <div>
                    <b>{row.name}</b>
                    <small>{row.note}</small>
                  </div>
                  <div className="bn-links-row">
                    {row.links.some((link) => link.label.startsWith("GitHub")) ? (
                      row.links.filter((link) => link.label.startsWith("GitHub") || link.label === "Wago").map((link) => (
                        <a key={link.href} className="bn-btn bn-btn-sm" href={link.href} target="_blank" rel="noreferrer">
                          {link.label !== "Wago" && <BrandIcon name="github" size={16} />}
                          {link.label}
                          {NEW_TAB}
                        </a>
                      ))
                    ) : (
                      <span className="none">No pack in this language yet</span>
                    )}
                  </div>
                </div>
              ))}
            </div>
            {chosen.code === "itIT" && (
              <p className="bn-note">{ITALIAN_NOTE}</p>
            )}
            <p className="bn-note">
              On the 1.12 and 3.3.5 clients, take the Spoken Quests zip from the release page.
              Spoken is inside it.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
