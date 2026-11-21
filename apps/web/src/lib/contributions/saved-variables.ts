/**
 * The envelopes inside the saved variables file the addon gathers into.
 *
 * The addon's background gathering (addons/Spoken/Gather.lua) keeps every envelope it
 * would have offered a Contribute link for, and the game writes them into
 * WTF/Account/<account>/SavedVariables/SpokenContributions.lua as Lua string literals. The player
 * uploads that file as it is, so this reads it as it is: every string literal in it, decoded,
 * and kept when it is an envelope. Nothing depends on where in the table the strings sit, so a
 * later change to the store's shape cannot make an older file unreadable.
 *
 * Browser-safe on purpose: the page runs this to preview the upload before anything is sent,
 * and only the envelopes -- never the rest of the file -- leave the player's machine. The Spoken
 * Manager imports this file too (manager/electron.vite.config.ts, `@site-contributions`), to
 * read the same file the same way, so it imports nothing and passes the manager's stricter
 * compiler settings.
 */

const ENVELOPE_PREFIX = "!SPOKEN";

/** Gather.lua's CAP, and the most one request to the batch route takes. */
export const MAX_ENVELOPES = 2000;

// A double-quoted Lua string: anything but a quote or backslash, or a backslash and whatever
// it escapes, a real newline included (Lua's own %q writes one after a backslash). The game
// writes double quotes only, so long brackets and single quotes are not looked for.
const LITERAL = /"((?:[^"\\]|\\[\s\S])*)"/g;

const SIMPLE: Record<string, number> = {
  n: 10,
  r: 13,
  t: 9,
  a: 7,
  b: 8,
  f: 12,
  v: 11,
  "\\": 92,
  '"': 34,
  "'": 39,
  "\n": 10,
};

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/**
 * One literal's body, unescaped. Built as bytes rather than characters because a `\ddd`
 * escape is a byte, and a multi-byte character written that way only means something once
 * its bytes are decoded together. The text between escapes is copied a run at a time.
 */
export function decodeLuaString(body: string): string {
  // Runs as encoded chunks, escapes as single bytes, joined once at the end: spreading a run
  // into a number[] would pass every byte of it as a function argument.
  const parts: Uint8Array[] = [];
  const byte = (value: number) => parts.push(Uint8Array.of(value));
  let from = 0;
  for (let at = body.indexOf("\\"); at !== -1; at = body.indexOf("\\", from)) {
    if (at > from) parts.push(encoder.encode(body.slice(from, at)));
    const next = body[at + 1];
    const digits = /^\d{1,3}/.exec(body.slice(at + 1, at + 4));
    if (digits) {
      byte(Number(digits[0]) & 0xff);
      from = at + 1 + digits[0].length;
    } else if (next === "\r" && body[at + 2] === "\n") {
      byte(10);
      from = at + 3;
    } else if (next !== undefined && SIMPLE[next] !== undefined) {
      byte(SIMPLE[next]);
      from = at + 2;
    } else {
      // An escape Lua 5.1 would reject. Kept literally rather than dropped: an envelope this
      // mangles fails its checksum and is reported, which is better than one silently altered.
      byte(92);
      from = at + 1;
    }
  }
  if (from < body.length) parts.push(encoder.encode(body.slice(from)));
  const joined = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    joined.set(part, offset);
    offset += part.length;
  }
  return decoder.decode(joined);
}

/** Every distinct envelope in the file, in the order the file holds them. */
export function envelopesFromSavedVariables(source: string): string[] {
  const seen = new Set<string>();
  for (const match of source.matchAll(LITERAL)) {
    // Checked before decoding: almost every string in the file is a setting's value, and the
    // prefix has no escapes in it to get in the way.
    const body = match[1] ?? "";
    if (!body.startsWith(ENVELOPE_PREFIX)) continue;
    seen.add(decodeLuaString(body));
  }
  return [...seen];
}
