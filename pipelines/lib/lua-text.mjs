/**
 * Prose as one Lua string literal. A raw newline or a lone backslash in a pack's generated Lua is a
 * syntax error, and the whole pack then fails to load.
 */
export function luaText(text) {
  const escaped = text
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "\\r")
    .replace(/\t/g, "\\t");
  return `"${escaped}"`;
}
