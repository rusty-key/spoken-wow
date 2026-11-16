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
  section: ReleaseSection;
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
  /** The output was longer than `log`, which is its end. */
  logCut?: boolean;
  /** ISO times: when it was pressed, and when it settled. */
  startedAt?: string;
  finishedAt?: string | null;
  /** Who pressed it, by name; null when they have none, or their account is gone. */
  by?: string | null;
};

/** One line whose audio went live since the section's last release. */
export type PendingChange = {
  file: string;
  lineId: string | null;
  version: number;
  /** ISO: when it went live. */
  at: string;
  /** Who cut it, to filter by; `by` is their name, null when they have none or are gone. */
  byId: string | null;
  by: string | null;
  /** A newly cut take, or an older version put back. */
  kind: "new" | "restored";
  /** What the line belongs to and says, in the language; null before it has a text row. */
  title: string | null;
  text: string | null;
};

export type PendingView = {
  /** ISO start of the run this counts from; null when nothing was released from here yet. */
  since: string | null;
  count: number;
  /** Of `count`, the older versions put back; the rest are new takes. */
  restored: number;
  /**
   * Lines whose text, name or ignore changed with no new audio, which the release also sends:
   * a correction to a quest's title ships in the lookup, not in a take.
   */
  textChanges: number;
  /** Who made the changes, most first; a null name has none, or is an account since deleted. */
  people: { id: string | null; name: string | null; count: number }[];
  /** The newest of them, up to a limit. */
  changes: PendingChange[];
};

export type ReleaseView = {
  active: RunView | null;
  recent: RunView[];
  /**
   * Per section, its newest run that released, however far back: what players have, as far as
   * the site knows. `recent` is only the latest few runs of every section together.
   */
  released: Record<string, RunView>;
  /**
   * Whether a press may choose patch, minor or major. A release on this machine bumps as asked;
   * one dispatched to GitHub Actions takes no bump, so offering one would be a choice ignored.
   */
  bumpable: boolean;
  /** Per section: what a release would send that players do not have yet. */
  pending: Record<string, PendingView>;
};
