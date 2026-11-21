"use client";

import { createContext, useContext } from "react";

import type { SiteText } from "@/lib/site-text/en";

const TextContext = createContext<SiteText | null>(null);

export function SiteTextProvider({ text, children }: { text: SiteText; children: React.ReactNode }) {
  return <TextContext.Provider value={text}>{children}</TextContext.Provider>;
}

export function useSiteText(): SiteText {
  const text = useContext(TextContext);
  if (!text) throw new Error("useSiteText needs a SiteTextProvider above it");
  return text;
}
