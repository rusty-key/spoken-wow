import type { Lang } from "@/lib/lang";

/** Browser-safe: the panel imports it, and store.ts is server-only. */
export const RELEASE_SECTIONS = ["quests", "places", "readables", "bosses"] as const;

export type ReleaseSection = (typeof RELEASE_SECTIONS)[number];

export function isReleaseSection(value: unknown): value is ReleaseSection {
  return typeof value === "string" && (RELEASE_SECTIONS as readonly string[]).includes(value);
}

export type ReleaseState = "dispatching" | "running" | "done" | "failed";

/** What the panel draws of a run; another team's active run carries only the first four. */
export type RunView = {
  section: string;
  lang: Lang;
  state: ReleaseState;
  /** False for another team's run. */
  own: boolean;
  githubUrl?: string | null;
  step?: string | null;
  error?: string | null;
};

export type ReleaseView = { active: RunView | null; recent: RunView[] };
