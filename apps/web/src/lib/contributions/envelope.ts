/**
 * The reader for the envelope addons/Spoken/Contribute.lua writes.
 *
 * THE TWO MUST AGREE EXACTLY, and the fixtures under tests/fixtures/contributions are what
 * holds them together -- the Lua writes them, this reads them, and a format change that
 * touches only one side fails in the commit that makes it. The same arrangement, and the same
 * reason, as Spoken_Readables/Checksum.lua and pipelines/readables/tools/lib/naming.mjs.
 *
 * Free of node imports: the paste box is a client component and previews the parse before
 * anything is sent.
 */

/** Large enough for a long quest, small enough that a pasted log is refused rather than stored. */
export const MAX_BYTES = 64 * 1024;

export const SOURCES = ["quests", "places", "readables"] as const;
export type EnvelopeSource = (typeof SOURCES)[number];

/**
 * The keys addons released before the rename write, and every raw envelope stored before it
 * carries. Read as the new key forever: a player can paste from a years-old saved file.
 */
const LEGACY_SOURCES: Record<string, EnvelopeSource> = { zones: "places", books: "readables" };

export function isEnvelopeSource(value: unknown): value is EnvelopeSource {
  return typeof value === "string" && (SOURCES as readonly string[]).includes(value);
}

export type Envelope = {
  source: EnvelopeSource;
  fields: Record<string, string>;
  text: string | null;
};

export type ParseError = "version" | "source" | "checksum" | "truncated" | "oversize" | "malformed";

type Result = { ok: true; value: Envelope } | { ok: false; error: ParseError };

const MODULUS = 2147483647;
const FACTOR = 31;

/**
 * The Lua writer's checksum, over bytes rather than characters.
 *
 * TextEncoder, not charCodeAt: string.byte on the client walks UTF-8 bytes, so a Cyrillic
 * quest -- the exact case this feature exists for -- would differ on every character otherwise.
 */
export function checksum(body: string): number {
  const bytes = new TextEncoder().encode(body);
  let sum = bytes.length % MODULUS;
  for (const b of bytes) {
    sum = (sum * FACTOR + b) % MODULUS;
  }
  return sum;
}

export function parseEnvelope(raw: string): Result {
  // Cheap pre-filter: UTF-8 spends at least one byte per UTF-16 unit, so a string already
  // longer than MAX_BYTES in units cannot be under MAX_BYTES in bytes either. That rejects the
  // actual attack shape -- someone pasting megabytes -- without allocating a full encode of it.
  // It is only sufficient, not exact: a shorter string can still exceed MAX_BYTES once
  // multi-byte characters are counted, so the precise check below still runs when this one
  // doesn't already decide it.
  if (raw.length > MAX_BYTES) {
    return { ok: false, error: "oversize" };
  }
  if (new TextEncoder().encode(raw).length > MAX_BYTES) {
    return { ok: false, error: "oversize" };
  }
  // Postgres text cannot hold NUL, and one in a file would fail every line stored beside it.
  if (raw.includes("\u0000")) {
    return { ok: false, error: "malformed" };
  }

  // A paste picks up blank lines and \r\n at both ends and neither is the player's fault.
  const normalised = raw.replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim() + "\n";

  const closed = normalised.match(/^([\s\S]*\n)sum=(\d+)\n$/);
  if (!closed) return { ok: false, error: "truncated" };
  const [, body, sum] = closed;

  const lines = body.split("\n");
  const header = lines.shift() ?? "";
  const headerMatch = header.match(/^!SPOKEN(\d+) (\S+)$/);
  if (!headerMatch) return { ok: false, error: "malformed" };
  if (headerMatch[1] !== "1") return { ok: false, error: "version" };

  const source = LEGACY_SOURCES[headerMatch[2]] ?? (headerMatch[2] as EnvelopeSource);
  if (!SOURCES.includes(source)) return { ok: false, error: "source" };

  // The checksum is verified before the body is trusted, but after the header: a 2.x envelope
  // should say so rather than reporting a checksum failure at someone who pasted correctly.
  if (checksum(body) !== Number(sum)) return { ok: false, error: "checksum" };

  const fields: Record<string, string> = {};
  let text: string | null = null;

  while (lines.length) {
    const line = lines.shift()!;
    if (line === "") continue;

    if (line === "text<<") {
      const collected: string[] = [];
      let closedFence = false;
      while (lines.length) {
        const inner = lines.shift()!;
        if (inner === ">>") {
          closedFence = true;
          break;
        }
        // One backslash off a line the writer escaped, so a page whose own words are ">>"
        // survives the round trip.
        collected.push(/^\\+>>$/.test(inner) ? inner.slice(1) : inner);
      }
      if (!closedFence) return { ok: false, error: "truncated" };
      text = collected.join("\n");
      continue;
    }

    const split = line.indexOf("=");
    if (split <= 0) return { ok: false, error: "malformed" };
    fields[line.slice(0, split)] = line.slice(split + 1);
  }

  return { ok: true, value: { source, fields, text } };
}

/**
 * The envelope written back out, as Contribute.lua's Envelope writes it: for an envelope the
 * site kept only parsed, as a report keeps its context, and now stores as a contribution's raw.
 * Parsing what this writes gives the same envelope back.
 */
export function formatEnvelope(envelope: Envelope): string {
  const out = [`!SPOKEN1 ${envelope.source}`];
  for (const [key, value] of Object.entries(envelope.fields)) out.push(`${key}=${value}`);
  if (envelope.text) {
    out.push("text<<", ...envelope.text.split("\n").map((line) => (/^\\*>>$/.test(line) ? `\\${line}` : line)), ">>");
  }
  const body = out.join("\n") + "\n";
  return `${body}sum=${checksum(body)}\n`;
}

export type DecodeError = "malformed" | "corrupt" | "unsupported";
type DecodeResult = { ok: true; text: string } | { ok: false; error: DecodeError };

/**
 * The reader for the `#e1=` fragment addons/Spoken/Contribute.lua's Link builds:
 * base64url -> raw deflate -> the same plaintext parseEnvelope already reads.
 *
 * Deliberately stops at plaintext rather than also calling parseEnvelope: ContributeForm feeds
 * this text into the exact state a paste already populates, so previewOf's parseEnvelope ->
 * checkEnvelope path runs once, the same way for a link and a paste, instead of this file
 * running it a second time for the link and throwing that parse away. Kept in this node-free
 * file, not a server route -- the fragment never leaves the browser (it is stripped from the
 * URL and read only in memory), so there is no server round trip to decode it on, and never
 * should be: sending it anywhere is the exact request-log/8k-limit exposure the link exists to
 * avoid.
 *
 * Async because DecompressionStream is a stream API with no synchronous form; every caller
 * already awaits the fetch this replaces, so that costs nothing a paste didn't already have.
 */
/**
 * The payload of a #e1= fragment, taken out of the address bar as it is read so the game text
 * does not linger in history or get shared onward. Null when the address carries none.
 */
export function takeFragment(): string | null {
  const hash = window.location.hash;
  if (!hash.startsWith("#e1=")) return null;
  window.history.replaceState(null, "", window.location.pathname + window.location.search);
  return hash.slice("#e1=".length);
}

export async function decodeFragment(fragment: string): Promise<DecodeResult> {
  // Older Safari (pre-16.4) has no DecompressionStream at all. Reported plainly rather than
  // thrown -- ContributeForm's job is to say so and point at the paste box, not to crash on
  // load for a player who did nothing wrong.
  if (typeof DecompressionStream === "undefined") {
    return { ok: false, error: "unsupported" };
  }
  if (!fragment) {
    return { ok: false, error: "malformed" };
  }

  let bytes: Uint8Array<ArrayBuffer>;
  try {
    // '-'/'_' back to the standard alphabet, then padded to a multiple of 4: atob only speaks
    // RFC 4648 base64, not the url-safe, unpadded form Contribute.lua's Base64URL emits.
    const standard = fragment.replace(/-/g, "+").replace(/_/g, "/");
    const padded = standard + "=".repeat((4 - (standard.length % 4)) % 4);
    const binary = atob(padded);
    // Not Uint8Array.from(binary, ...): TypeScript infers that as Uint8Array<ArrayBufferLike>,
    // which DecompressionStream's writer (typed for a concrete ArrayBuffer) then refuses.
    bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
  } catch {
    // atob throws on a fragment that was truncated mid-copy or edited by hand -- a player
    // action, not a bug, so it is reported the same way a bad paste is.
    return { ok: false, error: "corrupt" };
  }

  try {
    const stream = new DecompressionStream("deflate-raw");
    const writer = stream.writable.getWriter();
    // Chained rather than run in parallel with the read below: a write/close error (corrupt
    // deflate) otherwise surfaces as an unhandled rejection on this promise at the same time
    // the read below rejects with the same error, since nothing here awaits it directly.
    const written = writer.write(bytes).then(() => writer.close());
    const [inflated] = await Promise.all([new Response(stream.readable).arrayBuffer(), written]);
    return { ok: true, text: new TextDecoder("utf-8", { fatal: true }).decode(inflated) };
  } catch {
    // Bytes that are valid base64url but not valid deflate, or valid deflate that isn't valid
    // UTF-8 -- either way, not this format, and not this reader's job to guess at.
    return { ok: false, error: "corrupt" };
  }
}
