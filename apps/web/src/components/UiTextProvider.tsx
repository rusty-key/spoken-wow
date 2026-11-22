"use client";

import { createContext, useContext } from "react";

import { EN, type UiText } from "@/lib/ui-text/en";

/**
 * Backstage's words, for client components.
 *
 * The layout provides them from the `[lang]` segment, which is the page's reading language --
 * never `?lang=`, which is the language a team maintains. Defaulted to English rather than
 * throwing, so a component rendered outside the layout (a test, a story) still reads.
 */
const Context = createContext<UiText>(EN);

export function UiTextProvider({ text, children }: { text: UiText; children: React.ReactNode }) {
  return <Context.Provider value={text}>{children}</Context.Provider>;
}

export function useUiText(): UiText {
  return useContext(Context);
}
