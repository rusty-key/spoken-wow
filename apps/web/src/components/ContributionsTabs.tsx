import { SECTIONS, type Section as ContributionSection } from "@/lib/contributions/query";
import { localeHref, type Lang } from "@/lib/lang";

import { LinkTabs } from "@/components/StatusTabs";

const SECTION_LABELS: Record<Section, string> = {
  quests: "Quests",
  gossip: "Gossip",
  books: "Books",
  zones: "Zones",
};

const QUEST_VIEWS = [
  { key: "contributions", label: "Contributions", href: "/contributions/quests" },
  { key: "corrections", label: "Corrections", href: "/contributions/quests/corrections" },
] as const;

type Section = ContributionSection;
type View = (typeof QUEST_VIEWS)[number]["key"];

/**
 * The sections of /contributions, and under Quests its two views: lines the corpus lacks and
 * corrections to lines it has, which only quests can have. Links, not client state: each is
 * its own page with its own gate.
 */
export default function ContributionsTabs({
  lang,
  section,
  view,
}: {
  lang: Lang;
  section: Section;
  view?: View;
}) {
  const sections = SECTIONS.map((key) => ({
    key,
    label: SECTION_LABELS[key],
    href: `/contributions/${key}`,
  }));
  return (
    <>
      <LinkTabs label="Contributions" tabs={localised(lang, sections)} active={section} />
      {section === "quests" ? (
        <LinkTabs label="Quests" tabs={localised(lang, QUEST_VIEWS)} active={view ?? "contributions"} />
      ) : null}
    </>
  );
}

function localised(lang: Lang, tabs: readonly { key: string; label: string; href: string }[]) {
  return tabs.map((tab) => ({ value: tab.key, label: tab.label, href: localeHref(lang, tab.href) }));
}
