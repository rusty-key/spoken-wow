/**
 * What an envelope becomes once it is accepted for storage.
 *
 * `key` is a triage key and never a frozen line id. `q:33:accept`, `b:{pageTextID}` and
 * `z:{mapID}` name lines that exist; a contribution is about one that does not, which is why a
 * page is keyed on the checksum its client computed. An id is assigned only if triage accepts
 * the row and the pipeline mints one.
 *
 * Server-side only: the hash below reaches for node:crypto, and the browser half of this lives
 * in contributions.ts.
 */
import { createHash } from "node:crypto";

import { normaliseText } from "@readables-tools/lib/text.mjs";

import { clientLang } from "@/lib/lang";

import { checkEnvelope, type Submission } from "./contributions";
import type { Envelope } from "./envelope";

export function submissionFrom(envelope: Envelope, raw: string, description?: string | null): Submission | null {
  // The key/text rules live in contributions.ts's checkEnvelope, not here, so the paste-box
  // preview can run the same check and refuse before Send rather than after a 400 -- see
  // ContributeForm.tsx's previewOf.
  const check = checkEnvelope(envelope);
  if (!check.ok) return null;

  const { locale: sent = "enUS", build = "", ...meta } = envelope.fields;
  // Stored as the site's language, so an enGB player's line lands on the English page and
  // dedups against the enUS player who sent the same one.
  const locale = clientLang(sent);
  if (!locale) return null;
  // A places envelope carries no text -- the client has none to give -- so its contribution is
  // the description the player wrote on the page, kept where every other source keeps its text.
  const written = envelope.source === "places" ? description : envelope.text;
  const text = written ? normaliseText(written) : null;

  const dedup = dedupOf(envelope.source, check.key, locale, text);
  return { source: envelope.source, key: check.key, locale, build, text, meta, raw, dedup };
}

/** What makes two pastes one row: the same text under the same key and language. */
export function dedupOf(source: string, key: string, locale: string, text: string | null): string {
  return createHash("sha256").update([source, key, locale, text ?? ""].join("\u0000")).digest("hex");
}
