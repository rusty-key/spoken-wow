import { Chips } from "@/components/backstage/Tabs";
import type { PendingCounts } from "@/lib/contributions/pending";
import { SECTIONS, type Section } from "@/lib/contributions/query";
import { BASE_LANG, localeHref, type Lang } from "@/lib/lang";

const SECTION_LABELS: Record<Section, string> = {
  quests: "Quests & gossip",
  readables: "Readables",
  places: "Places",
};

/**
 * The sections of /contributions as chips, each with how many new rows wait in it, corrections to
 * lines the corpus has included. Links, not client state: each section is its own page. English
 * has no Names: its names are the corpus's.
 */
export default function ContributionsTabs({
  lang,
  section,
  pending,
  names,
}: {
  lang: Lang;
  section: Section | "names";
  pending?: PendingCounts;
  names?: number;
}) {
  return (
    <Chips
      label="Section"
      active={section}
      tabs={[
        ...SECTIONS.map((key) => ({
          value: key,
          label: SECTION_LABELS[key],
          href: localeHref(lang, `/contributions/${key}`),
          count: pending?.sections[key],
        })),
        ...(lang === BASE_LANG ? [] : [{ value: "names", label: "Names", href: localeHref(lang, "/contributions/names"), count: names }]),
      ]}
    />
  );
}
