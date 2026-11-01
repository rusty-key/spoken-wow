// The store pages' frontmatter: a deliberately small YAML subset, `key: value` and `key:`
// followed by `- item` lines. Enough for the fields the pages carry, and a parser that cannot
// express anything else is a parser nobody has to reason about when a page stops rendering.
//
// Shared by scripts/descriptions.mjs, which writes the pages out, and scripts/lib/packs.mjs,
// which reads the sound packs off them.
export function parseFrontmatter(text, file) {
  if (!text.startsWith("---\n")) {
    throw new Error(`${file}: no frontmatter block`);
  }
  const end = text.indexOf("\n---\n", 3);
  if (end === -1) {
    throw new Error(`${file}: frontmatter is not closed`);
  }

  const meta = {};
  let listKey = null;

  for (const raw of text.slice(4, end).split("\n")) {
    const line = raw.replace(/\s+$/, "");
    if (!line || line.startsWith("#")) continue;

    if (line.startsWith("  - ")) {
      if (!listKey) throw new Error(`${file}: list item outside a key: ${line}`);
      meta[listKey].push(line.slice(4).trim());
      continue;
    }

    const match = line.match(/^([a-zA-Z][a-zA-Z0-9_]*):\s*(.*)$/);
    if (!match) throw new Error(`${file}: cannot parse frontmatter line: ${line}`);

    const [, key, value] = match;
    if (value === "") {
      meta[key] = [];
      listKey = key;
    } else {
      meta[key] = value;
      listKey = null;
    }
  }

  return { meta, body: text.slice(end + 5).trim() + "\n" };
}

// Two shapes, because a block is either whole lines or part of a sentence, and getting the
// newlines wrong shows up as a blank row in the middle of a markdown table.
const ONLY_LINES =
  /^[ \t]*<!--\s*only:(curseforge|wago)\s*-->[ \t]*\r?\n([\s\S]*?)^[ \t]*<!--\s*\/only\s*-->[ \t]*\r?\n/gm;
const ONLY_INLINE = /<!--\s*only:(curseforge|wago)\s*-->([\s\S]*?)<!--\s*\/only\s*-->/g;

export function forStore(body, store) {
  const keep = (_, named, inner) => (named === store ? inner : "");
  return body.replace(ONLY_LINES, keep).replace(ONLY_INLINE, keep);
}
