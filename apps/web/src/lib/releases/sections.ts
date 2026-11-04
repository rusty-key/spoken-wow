import type { Lang } from "@/lib/lang";

/** Browser-safe: the panel imports it, and store.ts is server-only. */
export const RELEASE_SECTIONS = ["quests", "places", "readables", "bosses"] as const;

export type ReleaseSection = (typeof RELEASE_SECTIONS)[number];

export function isReleaseSection(value: unknown): value is ReleaseSection {
  return typeof value === "string" && (RELEASE_SECTIONS as readonly string[]).includes(value);
}

export const RELEASE_BUMPS = ["patch", "minor", "major"] as const;

export type ReleaseBump = (typeof RELEASE_BUMPS)[number];

export function isReleaseBump(value: unknown): value is ReleaseBump {
  return typeof value === "string" && (RELEASE_BUMPS as readonly string[]).includes(value);
}

export type ReleaseState = "dispatching" | "running" | "done" | "unchanged" | "failed";

export function isSettled(state: ReleaseState): state is "done" | "unchanged" | "failed" {
  return state === "done" || state === "unchanged" || state === "failed";
}

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
  /** The version it released. */
  version?: string | null;
  /** The end of the output, for a run this machine ran. */
  log?: string | null;
  /** ISO times: when it was pressed, and when it settled. */
  startedAt?: string;
  finishedAt?: string | null;
  /** Who pressed it, by name or address; null once their account is gone. */
  by?: string | null;
};

export type ReleaseView = { active: RunView | null; recent: RunView[] };
