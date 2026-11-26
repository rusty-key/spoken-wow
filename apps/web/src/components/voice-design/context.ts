"use client";

import { createContext, useContext } from "react";

import type { Lang } from "@/lib/lang";
import type { Analysis, Design } from "@/lib/voice-design/types";

export type Playing = { src: string; title: string; meta?: string; subtitle?: string };

/** A prompt and preview text waiting in a slot's Design form: Gemini's draft, or an old version's. */
export type Draft = {
  prompt: string;
  previewText: string;
  analysisId: string | null;
  /** What Gemini heard, for a draft it revised from a review. */
  heard?: string;
  from: string;
};

export type Workbench = {
  lang: Lang;
  viewer: { id: string; designs: boolean; admin: boolean };
  keys: { elevenlabs: boolean; gemini: boolean };
  /** Credits per character the caller's model has been billed at. */
  rate: number;
  model: string;
  /** A sampled line's live take, by line id. */
  live: Record<string, string>;
  playing: Playing | null;
  play: (clip: Playing) => void;
  drafts: Record<string, Draft>;
  setDraft: (slot: string, draft: Draft | null) => void;
  updateDesign: (design: Design) => void;
  updateAnalysis: (analysis: Analysis) => void;
};

export const WorkbenchContext = createContext<Workbench | null>(null);

export function useWorkbench(): Workbench {
  const value = useContext(WorkbenchContext);
  if (!value) throw new Error("useWorkbench outside the workbench");
  return value;
}

/** POST or DELETE to a workbench route; the parsed body, or throws with the route's own error. */
export async function send<T>(url: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const response = await fetch(url, {
    method: init.method ?? "POST",
    headers: init.body instanceof FormData || init.body === undefined ? undefined : { "Content-Type": "application/json" },
    body: init.body instanceof FormData ? init.body : init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  const body = (await response.json().catch(() => ({}))) as T & { error?: string };
  if (!response.ok) throw new Error(body.error ?? `${response.status}`);
  return body;
}
