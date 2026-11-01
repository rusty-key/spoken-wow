/** Browser-safe: the panel and the route share one list, and store.ts is server-only. */
export const RELEASE_SECTIONS = ["quests", "places", "readables", "bosses"] as const;

export type ReleaseSection = (typeof RELEASE_SECTIONS)[number];

export function isReleaseSection(value: unknown): value is ReleaseSection {
  return typeof value === "string" && (RELEASE_SECTIONS as readonly string[]).includes(value);
}

/** What the panel draws of a run; another team's active run carries only the first four. */
export type RunView = {
  section: string;
  lang: string;
  state: "dispatching" | "running" | "done" | "failed";
  /** False for another team's run, which shows no link, step or error. */
  own: boolean;
  id?: string;
  githubUrl?: string | null;
  step?: string | null;
  error?: string | null;
};

export type ReleaseView = { active: RunView | null; recent: RunView[] };
