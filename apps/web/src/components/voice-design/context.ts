"use client";

import { createContext, useContext } from "react";

import { withLang, type Lang } from "@/lib/lang";
import type { Revision } from "@/lib/voice-design/gemini";
import type { RemixSettings } from "@/lib/voice-design/limits";
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
  /** Set for a remix: the version whose voice is remixed, and the changes to make to it. */
  remix?: { id: string; version: number };
  changes?: string;
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
  /** Voice Remix's settings, one set for the page; every remix sends them. */
  remixSettings: RemixSettings;
  setRemixSettings: (settings: RemixSettings) => void;
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
    changes: revision.changes,
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

/** Voice Remix of the draft's version, kept as the slot's next version. */
export async function remixFrom(lang: Lang, draft: Draft, settings: RemixSettings): Promise<Design> {
  if (!draft.remix) throw new Error("not a remix");
  if (!draft.changes?.trim()) throw new Error("Gemini said no changes to remix with");
  const { design } = await send<{ design: Design }>(withLang(lang, `/api/voices/design/${draft.remix.id}/remix`), {
    body: { changes: draft.changes, previewText: draft.previewText, settings, revisionHeard: draft.heard ?? null, archetype: draft.archetype ?? null },
  });
  return design;
}
