"use client";

import { createContext, useContext } from "react";

import { EN, type UiText } from "@/lib/ui-text/en";

/**
 * Backstage's words for client components, in the reader's interface language, never `?lang=`.
 * English by default, so a component rendered outside the layout (a test) still reads.
 */
const Context = createContext<UiText>(EN);

export function UiTextProvider({ text, children }: { text: UiText; children: React.ReactNode }) {
  return <Context.Provider value={text}>{children}</Context.Provider>;
}

export function useUiText(): UiText {
  return useContext(Context);
}
