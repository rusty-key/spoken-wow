import type { Lang } from "@/lib/lang";

/** Browser-safe: the panel imports it, and store.ts is server-only. */
export const RELEASE_SECTIONS = ["quests", "places", "readables", "bosses"] as const;

export type ReleaseSection = (typeof RELEASE_SECTIONS)[number];

export function isReleaseSection(value: unknown): value is ReleaseSection {
  return typeof value === "string" && (RELEASE_SECTIONS as readonly string[]).includes(value);
}

/**
 * What a team that is not official, or not the language's privileged team, is told when it asks to
 * release where team releases are closed (SPOKEN_TEAM_RELEASES): on production until the Manager and
 * Spoken that list a team's packs have shipped (docs/platform/TEAMS.md, *Releases*).
 */
export const TEAM_RELEASES_CLOSED =
  "Releases for your team are not open on this site yet; your takes stay on the site.";

export const RELEASE_BUMPS = ["patch", "minor", "major"] as const;

export type ReleaseBump = (typeof RELEASE_BUMPS)[number];

export function isReleaseBump(value: unknown): value is ReleaseBump {
  return typeof value === "string" && (RELEASE_BUMPS as readonly string[]).includes(value);
}

/**
 * A run waits `queued` while another is active, then runs. A staged release (a team that is not
 * official) ends `awaiting_review`, then `done` once a site owner approves it and its promotion
 * runs, `rejected`, or `superseded` by a newer staged version of the same pack.
 */
export type ReleaseState =
  | "queued"
  | "dispatching"
  | "running"
  | "awaiting_review"
  | "done"
  | "unchanged"
  | "failed"
  | "rejected"
  | "superseded";

/** A release builds and publishes; a promote lists a staged release a site owner approved; a delist unlists a team's pack. */
export type ReleaseKind = "release" | "promote" | "delist";

/** The one run site-wide that holds the lock. */
export function isActive(state: ReleaseState): boolean {
  return state === "dispatching" || state === "running";
}

/** Whether its job is over: nothing the job reports changes it, though a review still may (awaiting_review). */
export function isSettled(state: ReleaseState): boolean {
  return !isActive(state) && state !== "queued";
}

/** Waiting on somebody else: another run to end, or a site owner. */
export function isWaiting(state: ReleaseState): boolean {
  return state === "queued" || state === "awaiting_review";
}

/** What the panel draws of a run; another team's active run carries only the first four. */
export type RunView = {
  /** Absent for another team's active run. */
  id?: string;
  section: ReleaseSection;
  lang: Lang;
  state: ReleaseState;
  kind?: ReleaseKind;
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
  /** A site owner's reason for not approving it. */
  reviewNote?: string | null;
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

/** A team, as the review page names it. */
export type ReviewTeam = { id: string; slug: string; name: string };

/** A team's staged version waiting for a site owner, with what it changes as the team counts it. */
export type WaitingVersion = {
  id: string;
  team: ReviewTeam;
  lang: Lang;
  section: ReleaseSection;
  version: string | null;
  /** Who pressed Release, by name. */
  by: string | null;
  /** ISO: when it was pressed. */
  pressedAt: string;
  /** Why the last approval did not list it. */
  error: string | null;
  /** Approved, and its promotion has not finished. */
  approving: boolean;
  pending: PendingView;
};

/** A team's pack that is on the channel: its newest approved version in a section and language. */
export type LiveTeamPack = {
  team: ReviewTeam;
  lang: Lang;
  section: ReleaseSection;
  version: string | null;
  /** ISO: when players got it. */
  releasedAt: string;
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
  /** Whether a press while another release runs waits its turn (on this machine), rather than being refused. */
  queues: boolean;
  /** Per section: what a release would send that players do not have yet. */
  pending: Record<string, PendingView>;
};
