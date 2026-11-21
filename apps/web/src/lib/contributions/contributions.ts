/**
 * What a contribution is, in terms both the server and the browser can hold.
 *
 * Free of node imports on purpose, as lib/reports/reports.ts is: the paste form is a client
 * component and needs COMPLAINT_MAX (and, below, checkEnvelope, so the preview can refuse what
 * submission.ts would). Importing anything that reaches for node would drag it into the
 * browser bundle. The hashing that submissionFrom needs lives in submission.ts for exactly
 * that reason.
 */
import type { Envelope, EnvelopeSource } from "./envelope";

export const STATUSES = ["new", "accepted", "rejected"] as const;
export type ContributionStatus = (typeof STATUSES)[number];

/** The most rows one api/contributions/resolve-many request resolves; the page sends more in chunks of this. */
export const RESOLVE_MANY_MAX = 200;

/** One row's answer from api/contributions/resolve-many. */
export type ResolveManyResult = { ok: true } | { ok: false; error: string };

export function isStatus(value: unknown): value is ContributionStatus {
  return typeof value === "string" && (STATUSES as readonly string[]).includes(value);
}

/** The same cap the reports body carries, for the same reason. */
export const COMPLAINT_MAX = 4000;

/**
 * A places contribution's description of the place: required, since the addon can name a place
 * but has nothing to say about it, and the description is the whole contribution. The floor is
 * what separates a sentence from "idk"; the ceiling is COMPLAINT_MAX's, for the same reason.
 */
export const DESCRIPTION_MIN = 20;
export const DESCRIPTION_MAX = COMPLAINT_MAX;

/** The description a places contribution needs, trimmed, or null when it is too short to keep. */
export function descriptionFrom(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim().slice(0, DESCRIPTION_MAX);
  return trimmed.length >= DESCRIPTION_MIN ? trimmed : null;
}

/** A bare digit string: the id fields below, never validated by the writer, must be this. */
const DIGITS = /^\d+$/;

export type EnvelopeCheck = { ok: true; key: string } | { ok: false; message: string };

/**
 * The triage key per source, and why an envelope cannot make one -- in words a player reading
 * the paste-box preview can act on, not the parser's vocabulary ("incomplete" told them
 * nothing). submission.ts calls this for the same key, so there is exactly one place that
 * knows what a valid envelope looks like; previously the preview only ran parseEnvelope and
 * let submission.ts's stricter rules -- this function -- reject silently at Send.
 *
 * A gossip envelope has no quest, by design -- it is an NPC saying something the corpus has
 * never heard -- so it keys on the creature id alone.
 *
 * This is a public, unauthenticated paste box, not a channel the addon controls: nothing stops
 * someone typing quest="npc" by hand, which -- unvalidated -- would produce "npc:12345" and
 * collide with a real gossip key for creature 12345. Every id component is therefore required
 * to be digits before it goes in the key; an envelope that fails this is malformed rather than
 * merely unlucky, so it is rejected outright rather than falling back to a different branch.
 *
 * `subzone` is free text from the client and can't be digit-checked, but that's safe here: once
 * `map` is digits-only it can never itself contain the ":" separator, so the first ":" in the
 * key always marks the exact end of `map` no matter what `subzone` contains (including more
 * colons). Two different (map, subzone) pairs can never produce the same key string. A subzone
 * of "" -- the open part of a zone, which is the normal case and the main places gap, not an
 * edge case -- keys on the bare map instead, mirroring the frozen `z:{mapID}` / `s:{mapID}:{key}`
 * split the design already draws; existing.ts's corpusLookup reads a colon-less key back the
 * same way.
 */
export function checkEnvelope(envelope: Envelope): EnvelopeCheck {
  const f = envelope.fields;

  if (envelope.source === "quests") {
    if (f.quest && f.event) {
      if (!DIGITS.test(f.quest)) {
        return { ok: false, message: "The quest id is not a number -- this paste was edited by hand." };
      }
      return withText(envelope, `${f.quest}:${f.event}`);
    }
    // The writer emits this field as "<id> <name>", e.g. "12345 Deathguard Linnea", so a
    // trailing name is the normal case and can't be rejected the way quest/page/map are.
    // Requiring the digit run to end at a space or the string's end -- not "all digits" --
    // is what stops a hand-written "123abc" from smuggling in a non-numeric id.
    const npc = f.npc?.match(/^(\d+)(?:\s|$)/)?.[1];
    if (!npc) {
      return { ok: false, message: "This has neither a quest and moment nor an NPC to key it on." };
    }
    return withText(envelope, `npc:${npc}`);
  }

  if (envelope.source === "readables") {
    if (!f.page) return { ok: false, message: "This has no page id to key it on." };
    if (!DIGITS.test(f.page)) {
      return { ok: false, message: "The page id is not a number -- this paste was edited by hand." };
    }
    return withText(envelope, f.page);
  }

  if (!f.map) return { ok: false, message: "This has no map to key it on." };
  if (!DIGITS.test(f.map)) {
    return { ok: false, message: "The map id is not a number -- this paste was edited by hand." };
  }
  return withText(envelope, f.subzone ? `${f.map}:${f.subzone}` : f.map);
}

function withText(envelope: Envelope, key: string): EnvelopeCheck {
  if (envelope.source === "places") {
    // Places carries no text because the client has none to give; one that does wasn't written
    // by our addon, so it's rejected rather than silently kept under a key whose triage view
    // won't show it.
    if (envelope.text != null) {
      return { ok: false, message: "This carries text, but a places paste from the addon never does." };
    }
  } else if (!envelope.text?.trim()) {
    // For quests and readables the text is the entire payload, so one without it is a report, not
    // a contribution. Whitespace counts as none: the addon fences a lone space, which
    // normalises to an empty row.
    return { ok: false, message: "This has no text, which for quests and readables is the whole point of the paste." };
  }
  return { ok: true, key };
}

export type Submission = {
  source: EnvelopeSource;
  key: string;
  locale: string;
  build: string;
  text: string | null;
  meta: Record<string, string>;
  raw: string;
  dedup: string;
};
