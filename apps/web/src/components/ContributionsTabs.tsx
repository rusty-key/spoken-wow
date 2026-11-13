import { SECTIONS, type Section } from "@/lib/contributions/query";
import type { PendingCounts } from "@/lib/contributions/pending";
import { localeHref, type Lang } from "@/lib/lang";

import { LinkTabs } from "@/components/StatusTabs";

const SECTION_LABELS: Record<Section, string> = {
  quests: "Quests",
  readables: "Readables",
  places: "Places",
};

function viewsOf(section: "quests" | "readables") {
  return [
    { key: "contributions", label: "Contributions", href: `/contributions/${section}` },
    { key: "corrections", label: "Corrections", href: `/contributions/${section}/corrections` },
  ] as const;
}

type View = ReturnType<typeof viewsOf>[number]["key"];

/**
 * The sections of /contributions, and under Quests and Readables their two views: lines the corpus
 * lacks and corrections to lines it has, which only quests and readables can have. Links, not
 * client state: each is its own page with its own gate. Each tab carries how many new rows wait in it,
 * when given.
 */
export default function ContributionsTabs({
  lang,
  section,
  view,
  pending,
}: {
  lang: Lang;
  section: Section;
  view?: View;
  pending?: PendingCounts;
}) {
  const sections = SECTIONS.map((key) => ({
    key,
    label: counted(SECTION_LABELS[key], pending?.sections[key]),
    href: `/contributions/${key}`,
  }));
  return (
    <>
      <LinkTabs label="Contributions" tabs={localised(lang, sections)} active={section} />
      {section === "quests" || section === "readables" ? (
        <LinkTabs
          label={SECTION_LABELS[section]}
          tabs={localised(
            lang,
            viewsOf(section).map((tab) => ({ ...tab, label: counted(tab.label, pending?.[section][tab.key]) })),
          )}
          active={view ?? "contributions"}
        />
      ) : null}
    </>
  );
}

function counted(label: string, count: number | undefined): string {
  return count === undefined ? label : `${label} (${count})`;
}

function localised(lang: Lang, tabs: readonly { key: string; label: string; href: string }[]) {
  return tabs.map((tab) => ({ value: tab.key, label: tab.label, href: localeHref(lang, tab.href) }));
}
