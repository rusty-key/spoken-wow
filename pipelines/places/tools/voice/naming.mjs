// Line identity and audio file paths, derived here and nowhere else.
//
// The addon resolves a clip through a generated lookup table, so a filename that
// drifts by one character plays silence rather than failing loudly. This is the
// lesson ../wow-voiceover/tts_cli/naming.py documents, applied to one voice.
//
//   lineId   z:{mapID}                 s:{mapID}:{canonicalKey}
//   file     {mapID}/zone              {mapID}/{slug}
//
// The lookup table stores `file` without an extension; the addon appends ".mp3".

import { createHash } from "node:crypto";

export function lineId(entry) {
  return entry.key ? `s:${entry.mapID}:${entry.key}` : `z:${entry.mapID}`;
}

// The canonical key is already lower-cased, apostrophe-stripped and
// punctuation-collapsed by normaliseKey in tools/lib/wiki.mjs, so this only has
// to make it path-safe. Keys are unique per zone by construction, but the slug
// transform could still collide, so a collision is disambiguated by hash rather
// than silently overwriting a file that cost money to make.
export function slugFor(key) {
  const slug = key.replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "");
  return slug === "" ? hashOf(key) : slug;
}

function hashOf(text) {
  return createHash("sha1").update(text, "utf8").digest("hex").slice(0, 6);
}

export function filePathFor(entry) {
  const base = entry.key ? slugFor(entry.key) : "zone";
  return `${entry.mapID}/${base}`;
}

// Assigns every entry a file, resolving slug collisions within a zone. Returns a
// Map of lineId -> file path.
export function assignFiles(entries) {
  const taken = new Map(); // "mapID/slug" -> lineId that claimed it
  const files = new Map();

  for (const entry of entries) {
    let file = filePathFor(entry);
    if (taken.has(file) && taken.get(file) !== lineId(entry)) {
      file = `${entry.mapID}/${slugFor(entry.key)}-${hashOf(entry.key)}`;
    }
    taken.set(file, lineId(entry));
    files.set(lineId(entry), file);
  }
  return files;
}

// What the manifest compares against to decide a line is stale. Hashing the
// spoken text rather than the display text means a pronunciation rule change
// correctly invalidates the lines it affects.
export function textHash(spokenText) {
  return createHash("sha1").update(spokenText, "utf8").digest("hex");
}
