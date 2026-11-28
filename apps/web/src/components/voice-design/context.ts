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
  keys: { elevenlabs: boolean; gemini: boolean; anthropic: boolean };
  /** Credits per character the caller's model has been billed at. */
  rate: number;
  model: string;
  /** A sampled line's live take, by line id. */
  live: Record<string, string>;
  /** Starts the clip, or pauses or resumes it when it is the one already in the player. */
  play: (clip: Playing) => void;
  isPlaying: (src: string) => boolean;
  drafts: Record<string, Draft>;
  setDraft: (slot: string, draft: Draft | null) => void;
  /** Voice Remix's settings, one set for the page; every remix sends them. */
  remixSettings: RemixSettings;
  setRemixSettings: (settings: RemixSettings) => void;
  /** `live` holds the live takes of lines the design was just voiced on. */
  updateDesign: (designs: Design | Design[], live?: Record<string, string>) => void;
  updateAnalysis: (analysis: Analysis) => void;
  /** Drops a deleted version from its slot, so the one before is the slot's newest again. */
  removeDesign: (design: Design) => void;
};

export const WorkbenchContext = createContext<Workbench | null>(null);

export function useWorkbench(): Workbench {
  const value = useContext(WorkbenchContext);
  if (!value) throw new Error("useWorkbench outside the workbench");
  return value;
}

/** A version's preview or sample line, or a line a showing kept. */
export const designAudioUrl = (lang: Lang, sha256: string) => withLang(lang, `/api/voices/design/audio/${sha256}`);

/**
 * POST or DELETE to a workbench route; the parsed body, or throws with the route's own error.
 * A failure without one came from nginx or Cloudflare, not the route (the app went away or timed
 * out mid-request), so the error names the request, the status and what the proxy said.
 */
export async function send<T>(url: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const method = init.method ?? "POST";
  const response = await fetch(url, {
    method,
    headers: init.body instanceof FormData || init.body === undefined ? undefined : { "Content-Type": "application/json" },
    body: init.body instanceof FormData ? init.body : init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  const text = await response.text().catch(() => "");
  let body: T & { error?: string };
  try {
    body = JSON.parse(text) as T & { error?: string };
  } catch {
    body = {} as T & { error?: string };
  }
  if (response.ok) return body;
  if (body.error) throw new Error(body.error);
  const path = url.replace(/^https?:\/\/[^/]+/, "").split("?")[0];
  const said = text.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim().slice(0, 300);
  const status = `${response.status}${response.statusText ? ` ${response.statusText}` : ""}`;
  throw new Error(`${method} ${path} answered ${status}, not from the route${said ? `: ${said}` : ""} (${new Date().toISOString()})`);
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

export async function designFrom(lang: Lang, slot: string, draft: Draft): Promise<Design[]> {
  const { design, retired } = await send<{ design: Design; retired: Design[] }>(withLang(lang, "/api/voices/design"), {
    body: {
      slot,
      prompt: draft.prompt,
      previewText: draft.previewText,
      analysisId: draft.analysisId,
      revisionHeard: draft.heard ?? null,
      archetype: draft.archetype ?? null,
    },
  });
  return [design, ...retired];
}

type RemixDraft = Draft & Required<Pick<Draft, "remix">>;

function sendRemix<T = object>(lang: Lang, route: string, draft: RemixDraft, settings: RemixSettings) {
  if (!draft.changes?.trim()) throw new Error("Gemini said no changes to remix with");
  return send<T & { design: Design; retired: Design[] }>(withLang(lang, `/api/voices/design/${draft.remix.id}/${route}`), {
    body: {
      changes: draft.changes,
      prompt: draft.prompt,
      previewText: draft.previewText,
      settings,
      revisionHeard: draft.heard ?? null,
      archetype: draft.archetype ?? null,
    },
  });
}

export async function remixFrom(lang: Lang, draft: RemixDraft, settings: RemixSettings): Promise<Design[]> {
  const { design, retired } = await sendRemix(lang, "remix", draft, settings);
  return [design, ...retired];
}

export async function designAndRemixFrom(lang: Lang, draft: RemixDraft, settings: RemixSettings): Promise<Design[]> {
  const { design, retired } = await sendRemix(lang, "design-and-remix", draft, settings);
  return [design, ...retired];
}
