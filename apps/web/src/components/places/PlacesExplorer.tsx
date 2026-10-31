"use client";

import { useMemo } from "react";

import { Explorer } from "@/components/places/Explorer";
import { placesSection } from "@/components/places/sections";
import type { ZoneFacet } from "@/lib/places/catalogue";

/**
 * The places explorer, configured on the client: a section carries functions, which a server
 * page cannot hand to a client component, so the page sends the facets and this builds it.
 */
export function PlacesExplorer({ zones }: { zones: ZoneFacet[] }) {
  const section = useMemo(() => placesSection(zones), [zones]);
  return <Explorer section={section} />;
}
