"use client";

import type { ReactNode } from "react";

import { type LanguageInfo, registerLanguages } from "@/lib/lang";

/**
 * Teaches the browser's registry (lib/lang.ts) the languages beyond the built-in ones.
 *
 * Registers while rendering, not in an effect: a child rendered in the same pass must already
 * know a language's name. Browser only: on the server loadLanguages owns the shared registry, and
 * a render carrying an older snapshot must not overwrite it.
 */
export function LanguagesProvider({ languages, children }: { languages: readonly LanguageInfo[]; children: ReactNode }) {
  if (typeof window !== "undefined") registerLanguages(languages);
  return children;
}
