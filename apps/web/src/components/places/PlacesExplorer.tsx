"use client";

import { useMemo } from "react";

import { Explorer } from "@/components/places/Explorer";
import { useUiText } from "@/components/UiTextProvider";
import { placesSection } from "@/components/places/sections";
import type { ZoneFacet } from "@/lib/places/catalogue";
import type { TeamView } from "@/lib/teams/view";

/**
 * The places explorer, configured on the client: a section carries functions, which a server
 * page cannot hand to a client component, so the page sends the facets and this builds it.
 */
export function PlacesExplorer({ zones, ...view }: { zones: ZoneFacet[] } & TeamView) {
  const words = useUiText().sectionLabels.places;
  const section = useMemo(() => placesSection(zones, words), [zones, words]);
  return <Explorer section={section} {...view} />;
}
