/**
 * What a report carries beside its address: the contribute envelope the addon put in the
 * report link's #e1= fragment, reduced to its fields and text.
 *
 * Client-safe, like envelope.ts: the report form reads the fragment in the browser, and the
 * triage rows render it there.
 */
import { parseEnvelope, type Envelope } from "@/lib/contributions/envelope";
import type { Source } from "@/lib/sections";

export type ReportContext = { fields: Record<string, string>; text: string | null };

/**
 * The context in a raw envelope, or null when it is not one of `source`'s.
 *
 * A context that fails its checks is dropped rather than refusing the report: the complaint is
 * the report, and the context only helps read it.
 */
export function contextFrom(raw: unknown, source: Source): ReportContext | null {
  const envelope = envelopeFor(raw, source);
  return envelope && { fields: envelope.fields, text: envelope.text };
}

/** The parsed envelope behind contextFrom, for a caller that needs more of it than the context. */
export function envelopeFor(raw: unknown, source: Source): Envelope | null {
  if (typeof raw !== "string" || !raw) return null;
  const parsed = parseEnvelope(raw);
  return parsed.ok && parsed.value.source === source ? parsed.value : null;
}

/**
 * The Spoken release this site was built from: the version in Spoken.toc, which a release PR
 * bumps on master, where the site deploys from. Null in a build that could not read it.
 */
export const LATEST_VERSION: string | null = process.env.NEXT_PUBLIC_SPOKEN_VERSION || null;

/** "SpokenQuests 3.4.0" from the addon field's "SpokenQuests/3.4.0". */
export function addonLabel(context: ReportContext): string | undefined {
  return context.fields.addon?.replace("/", " ");
}

const VERSION = /^\d+(\.\d+)*(-[\w.]+)?$/;

/** "3.4.0" from "SpokenQuests/3.4.0", or null for a source checkout's "dev". */
export function addonVersion(context: ReportContext | null): string | null {
  const version = context?.fields.addon?.split("/")[1];
  return version && VERSION.test(version) ? version : null;
}

/**
 * The newest version among the player's packs in the language they were hearing, or null:
 * "none" when no pack speaks it, and nothing at all from an addon older than the field.
 */
export function packVersion(context: ReportContext | null): string | null {
  const version = context?.fields.packVersion;
  return version && VERSION.test(version) ? version : null;
}

/**
 * The version of the one folder the line played from, where the addon names it. A release bumps
 * only the folders it changed, so this, not packVersion, says whether the player has the line's
 * newest recording.
 */
export function folderVersion(context: ReportContext | null): string | null {
  const version = context?.fields.packFolderVersion;
  return version && VERSION.test(version) ? version : null;
}

/** A release that gave a pack a version, and when it started building from the live takes. */
export type PackRelease = { version: string; at: string };

/** Per pack language, the version one section's newest release gave its pack. */
export type PackVersions = Record<string, string>;

/**
 * The player's pack version and the newer one released in its language, or null when the pack
 * is current, unknown, or its language was never released from the site.
 *
 * Compared with the newest version among the player's folders of that language, while a release
 * bumps only the folders it changed. A player without the folder a release touched is told of an
 * update that brings them nothing; the triage flag says "might" for that reason.
 */
export function outdatedPack(
  context: ReportContext | null,
  latest: PackVersions,
): { version: string; latest: string } | null {
  const version = packVersion(context);
  const newest = context?.fields.pack && latest[context.fields.pack];
  return version && newest && isOlder(version, newest) ? { version, latest: newest } : null;
}

/**
 * What the report page can tell a player about the line before they report it: their pack
 * against the newest, and where the live take stands against both.
 *
 * `shipsIn` is the first release that started after the take was recorded, null when none has
 * yet. `inYours` is whether that release is no newer than the player's pack, null when that
 * cannot be told: no pack version, or a take older than every release on record, which an
 * earlier release outside the site may already have carried. The take's time is when it was
 * generated; a take restored later counts from then.
 */
export type LineNews = {
  version: string | null;
  /**
   * Whether `version` is the line's own folder's. A release bumps only the folders it changed, so
   * then `latest` is the release that carries this line's newest recording, not the newest
   * release, which may have left the folder alone.
   */
  exact: boolean;
  latest: string | null;
  recordedAt: string;
  shipsIn: string | null;
  inYours: boolean | null;
};

export function lineNews(
  context: ReportContext | null,
  releases: PackRelease[] | undefined,
  recordedAt: string | null,
): LineNews | null {
  if (!context || !recordedAt) return null;
  const exact = folderVersion(context);
  const version = exact ?? packVersion(context);
  const list = releases ?? [];
  const recorded = Date.parse(recordedAt);
  const after = list.filter((release) => Date.parse(release.at) > recorded);
  const ships = after.at(-1) ?? null;
  // Every release after the take means it may have shipped in one before the site's first.
  const inYours =
    !version || !list.length
      ? null
      : !ships
        ? false
        : !isOlder(version, ships.version)
          ? true
          : after.length < list.length
            ? false
            : null;
  // A folder's version is weighed against the release carrying the take, which changed that
  // folder; the newest release may have left it alone.
  const newest = exact ? (inYours === false ? ships?.version : null) : list[0]?.version;
  return {
    version,
    exact: exact !== null,
    latest: version && newest && isOlder(version, newest) ? newest : null,
    recordedAt,
    shipsIn: ships?.version ?? null,
    inYours,
  };
}

/**
 * Whether `version` is older than `latest`, numerically by part. A pre-release (3.0.0-beta.2)
 * is older than its release, as the betas shipped before 3.0.0.
 */
export function isOlder(version: string, latest: string): boolean {
  const [core, pre] = version.split("-", 2);
  const [latestCore, latestPre] = latest.split("-", 2);
  const a = core.split(".").map(Number);
  const b = latestCore.split(".").map(Number);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const diff = (a[i] ?? 0) - (b[i] ?? 0);
    if (diff) return diff < 0;
  }
  if (pre && !latestPre) return true;
  if (!pre || !latestPre) return false;
  return pre.localeCompare(latestPre, undefined, { numeric: true }) < 0;
}

/** The context's version when this site knows of a newer release, else null. */
export function outdatedVersion(context: ReportContext | null): string | null {
  const version = addonVersion(context);
  return version && LATEST_VERSION && isOlder(version, LATEST_VERSION) ? version : null;
}

/**
 * The context as short labelled facts, in the order a reader weighs them. The NPC field is
 * "<id> <name>" as the addon writes it.
 */
export function contextFacts(context: ReportContext): { label: string; value: string }[] {
  const f = context.fields;
  const facts: { label: string; value: string }[] = [];
  const add = (label: string, value: string | undefined) => {
    if (value) facts.push({ label, value });
  };
  add("Addon", addonLabel(context));
  add("Client", f.build);
  add("Language", f.locale && f.pack && f.pack !== f.locale ? `${f.locale}, hearing ${f.pack}` : f.locale);
  add(
    "Pack",
    f.packFolder
      ? `${f.packFolder} ${f.packFolderVersion ?? ""}`.trim()
      : f.packVersion && (f.packVersion === "none" ? "none installed" : f.packVersion),
  );
  add("NPC", f.npc);
  add("Quest", f.quest && [f.quest, f.event, f.title].filter(Boolean).join(" "));
  add("Book", f.book && (f.number ? `${f.book}, page ${f.number}` : f.book));
  add("Place", [f.zone, f.key].filter(Boolean).join(" · ") || undefined);
  add("Seen", [f.kind, f.creature, f.sex && SEX[f.sex]].filter(Boolean).join(", ") || undefined);
  return facts;
}

/** UnitSex: 1 unknown, 2 male, 3 female. */
const SEX: Record<string, string> = { "1": "", "2": "male", "3": "female" };
