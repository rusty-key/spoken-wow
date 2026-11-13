"use client";

import { useMemo } from "react";

import { bossesSection } from "@/components/bosses/sections";
import { Explorer } from "@/components/places/Explorer";
import type { InstanceFacet } from "@/lib/bosses/catalogue";

/**
 * The bosses explorer, configured on the client: a section carries functions, which a server
 * page cannot hand to a client component, so the page sends the facets and this builds it.
 */
export function BossesExplorer({ instances }: { instances: InstanceFacet[] }) {
  const section = useMemo(() => bossesSection(instances), [instances]);
  return <Explorer section={section} />;
}
