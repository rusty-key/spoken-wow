"use client";

import { createContext, useContext } from "react";

import { withLang, type Lang } from "@/lib/lang";
import type { Revision } from "@/lib/voice-design/gemini";
import type { Analysis, Design } from "@/lib/voice-design/types";

export type Playing = { src: string; title: string; meta?: string; subtitle?: string };

/** A prompt and preview text waiting in a slot's Design form: Gemini's draft, or an old version's. */
export type Draft = {
  prompt: string;
  previewText: string;
  analysisId: string | null;
  /** What Gemini heard, for a draft it revised from a review, and who the voice is for. */
  heard?: string;
  archetype?: string;
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
  /** Starts the clip, or pauses or resumes it when it is the one already in the player. */
  play: (clip: Playing) => void;
  /** Whether this clip is in the player and sounding. */
  isPlaying: (src: string) => boolean;
  drafts: Record<string, Draft>;
  setDraft: (slot: string, draft: Draft | null) => void;
  /** `live` holds the live takes of lines the design was just voiced on. */
  updateDesign: (design: Design, live?: Record<string, string>) => void;
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

/** `from` labels the draft in the form. */
export async function requestRevision(lang: Lang, design: Design, from: string): Promise<Draft> {
  const { revision } = await send<{ revision: Revision & { archetype: string } }>(withLang(lang, `/api/voices/design/${design.id}/revise`));
  return {
    prompt: revision.prompt,
    previewText: revision.preview_text,
    analysisId: null,
    heard: revision.heard,
    archetype: revision.archetype,
    from,
  };
}

export async function designFrom(lang: Lang, slot: string, draft: Draft): Promise<Design> {
  const { design } = await send<{ design: Design }>(withLang(lang, "/api/voices/design"), {
    body: {
      slot,
      prompt: draft.prompt,
      previewText: draft.previewText,
      analysisId: draft.analysisId,
      revisionHeard: draft.heard ?? null,
      archetype: draft.archetype ?? null,
    },
  });
  return design;
}
