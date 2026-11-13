"use client";

import type { ReactNode } from "react";

import { type LanguageInfo, registerLanguages } from "@/lib/lang";

/**
 * Teaches the browser's registry (lib/lang.ts) the languages beyond the built-in ones.
 *
 * Registers while rendering, not in an effect: a child rendered in the same pass, on the server
 * or in the browser, must already know a language's name.
 */
export function LanguagesProvider({ languages, children }: { languages: readonly LanguageInfo[]; children: ReactNode }) {
  registerLanguages(languages);
  return children;
}
