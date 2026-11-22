"use client";

import { createContext, useContext } from "react";

import { EN, type UiText } from "@/lib/ui-text/en";

/**
 * Backstage's words, for client components.
 *
 * In the reader's interface language (readingLang), never `?lang=`, which names the team an
 * admin page acts on. Defaulted to English rather than throwing, so a component rendered
 * outside the layout (a test, a story) still reads.
 */
const Context = createContext<UiText>(EN);

export function UiTextProvider({ text, children }: { text: UiText; children: React.ReactNode }) {
  return <Context.Provider value={text}>{children}</Context.Provider>;
}

export function useUiText(): UiText {
  return useContext(Context);
}
