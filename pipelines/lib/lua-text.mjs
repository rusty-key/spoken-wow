/** Escapes control bytes too: a raw newline is a syntax error that stops a whole pack loading. */
export function quote(text) {
  return `"${String(text).replace(/\\/g, "\\\\").replace(/"/g, '\\"')
    .replace(/[\x00-\x1f\x7f]/g, (char) => `\\${char.charCodeAt(0).toString().padStart(3, "0")}`)}"`;
}
