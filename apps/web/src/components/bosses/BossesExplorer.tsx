"use client";

import { useMemo } from "react";

import { useUiText } from "@/components/UiTextProvider";

import { bossesSection } from "@/components/bosses/sections";
import { Explorer } from "@/components/places/Explorer";
import type { InstanceFacet } from "@/lib/bosses/catalogue";
import type { TeamView } from "@/lib/teams/view";

/**
 * The bosses explorer, configured on the client: a section carries functions, which a server
 * page cannot hand to a client component, so the page sends the facets and this builds it.
 */
export function BossesExplorer({ instances, ...view }: { instances: InstanceFacet[] } & TeamView) {
  const words = useUiText().sectionLabels.bosses;
  const section = useMemo(() => bossesSection(instances, words), [instances, words]);
  return <Explorer section={section} {...view} />;
}
