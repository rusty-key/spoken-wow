import type { ReactNode } from "react";

import { Tabs } from "@/components/backstage/Tabs";
import { langName, localeHref, type Lang } from "@/lib/lang";

export type AudioSection = "quests" | "places" | "bosses" | "readables";

const SECTIONS: { value: AudioSection; label: string; lede: string }[] = [
  {
    value: "quests",
    label: "Quests & gossip",
    lede: "Every quest and gossip line and what NPCs say after a quest. Search, listen, and fix a line.",
  },
  {
    value: "places",
    label: "Places",
    lede: "The lore read when you enter a zone or subzone. Written for Spoken, so it can be corrected here.",
  },
  {
    value: "bosses",
    label: "Bosses",
    lede: "The story told when a dungeon or raid boss falls. Written for Spoken, so it can be corrected here.",
  },
  {
    value: "readables",
    label: "Readables",
    lede: "Every book, letter and plaque, page by page. Blizzard's words, corrected only where a narrator would stumble.",
  },
];

/**
 * The four audio pages as one place: a title naming the language, the section tabs, and the
 * section's catalogue below. Each tab keeps the team being viewed, so switching section does not
 * quietly switch whose takes are shown.
 */
export default function AudioPage({
  lang,
  section,
  team,
  children,
}: {
  lang: Lang;
  section: AudioSection;
  team?: string;
  children: ReactNode;
}) {
  const current = SECTIONS.find((each) => each.value === section)!;
  const suffix = team ? `?team=${encodeURIComponent(team)}` : "";
  return (
    <main className="bs pb-36">
      <div className="bn-wrap">
        <div className="bs-head">
          <div className="min-w-0">
            <h1 className="bs-title">{langName(lang)} audio</h1>
            <p className="bs-lede">{current.lede}</p>
          </div>
        </div>
        <Tabs
          label="Sections"
          active={section}
          tabs={SECTIONS.map((each) => ({
            value: each.value,
            label: each.label,
            href: localeHref(lang, `/${each.value}${suffix}`),
          }))}
        />
      </div>
      {children}
    </main>
  );
}

/** What a section says while its tables are empty, inside the same frame. */
export function AudioPageEmpty({ children }: { children: ReactNode }) {
  return (
    <div className="bn-wrap">
      <p className="bs-lede mt-6 max-w-xl">{children}</p>
    </div>
  );
}
