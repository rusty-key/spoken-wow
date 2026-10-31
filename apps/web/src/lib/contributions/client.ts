/**
 * Which game client a contribution came from, read off the envelope's `build=` field alone.
 *
 * `build` is "<version>/<build number>" straight out of GetBuildInfo() -- every addon has sent it
 * since the first envelope, so every stored row can be classified, not just new ones. The
 * version's major.minor is unique per client that is in play today:
 *
 *   1.15.x  Classic Era, Hardcore and Season of Discovery (one client; the build cannot tell
 *           them apart)
 *   1.60.x  WoW: Forever (1.16 and up, allowing for its later builds)
 *   2.5.x   TBC Anniversary
 *   10+     retail
 *   1.12.1, 2.4.3, 3.3.5  the three legacy clients
 *
 * Anything else (another Classic progression, say) is "other", labelled with its version so it
 * is still readable.
 *
 * Node-free: ContributionTable and NpcEditor, client components, import the filters for their
 * dropdowns.
 */
export const CLIENT_FAMILIES = ["era", "anniversary", "retail", "forever", "legacy", "other"] as const;

export type ClientFamily = (typeof CLIENT_FAMILIES)[number];

export const CLIENT_FAMILY_LABELS: Record<ClientFamily, string> = {
  era: "Classic Era",
  anniversary: "TBC Anniversary",
  retail: "Retail",
  forever: "Forever",
  legacy: "Legacy client",
  other: "Other",
};

export function isClientFamily(value: unknown): value is ClientFamily {
  return typeof value === "string" && (CLIENT_FAMILIES as readonly string[]).includes(value);
}

/**
 * The clients the project voices for. Every other family is still taken in and stored, but goes
 * to the "low effort" bin, which no list shows until it is asked for.
 */
export const FOCUS_FAMILIES: readonly ClientFamily[] = ["era", "forever"];

/** The two bins, then single families, then everything. */
export const CLIENT_FILTERS = ["focus", "low-effort", ...CLIENT_FAMILIES, "all"] as const;

export type ClientFilter = (typeof CLIENT_FILTERS)[number];

export const DEFAULT_CLIENT_FILTER: ClientFilter = "focus";

export const CLIENT_BIN_LABELS: Record<"focus" | "low-effort", string> = {
  focus: "Era + Forever",
  "low-effort": "Low effort",
};

/** The `client` query parameter as a filter: the focus bin for anything unrecognised or absent. */
export function clientFilterOf(value: unknown): ClientFilter {
  return (CLIENT_FILTERS as readonly unknown[]).includes(value) ? (value as ClientFilter) : DEFAULT_CLIENT_FILTER;
}

/**
 * Whether a row from `family` is in view. Null is a row no client sent, such as an NPC the
 * extract named: it belongs with the focus bin and with no single family.
 */
export function matchesClient(family: ClientFamily | null, filter: ClientFilter): boolean {
  if (filter === "all") return true;
  if (filter === "focus") return family === null || FOCUS_FAMILIES.includes(family);
  if (filter === "low-effort") return family !== null && !FOCUS_FAMILIES.includes(family);
  return family === filter;
}

export type ClientSummary = {
  family: ClientFamily;
  /** e.g. "Classic Era 1.15.7" -- the family plus the version, what the table shows. */
  label: string;
  /** The version half of `build`, or null when the envelope's was missing or "?". */
  version: string | null;
  /** The build-number half, or null likewise. */
  buildNumber: string | null;
};

const LEGACY_VERSIONS = new Set(["1.12.1", "2.4.3", "3.3.5"]);

function familyOf(version: string): ClientFamily {
  if (LEGACY_VERSIONS.has(version)) return "legacy";
  const match = /^(\d+)\.(\d+)/.exec(version);
  if (!match) return "other";
  const major = Number(match[1]);
  const minor = Number(match[2]);
  if (major >= 10) return "retail";
  if (major === 1 && minor >= 13 && minor <= 15) return "era";
  if (major === 1 && minor >= 16) return "forever";
  if (major === 2 && minor === 5) return "anniversary";
  return "other";
}

export function clientOf(build: string | null | undefined): ClientSummary {
  const [rawVersion = "", rawNumber = ""] = (build ?? "").trim().split("/", 2);
  const version = rawVersion && rawVersion !== "?" ? rawVersion : null;
  const buildNumber = rawNumber && rawNumber !== "?" ? rawNumber : null;
  if (!version) return { family: "other", label: "Unknown client", version, buildNumber };
  const family = familyOf(version);
  return { family, label: `${CLIENT_FAMILY_LABELS[family]} ${version}`, version, buildNumber };
}
