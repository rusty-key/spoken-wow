// CSV, whole-file: quoted fields may span lines, because lore text does.
//
// pipelines/lib/wago.mjs reads the client's tables. A translation sheet is prose --
// paragraphs, quotes, commas -- so this one reads the whole text with one state
// machine and writes it back the same way. RFC 4180: comma-separated, double quotes around anything that needs
// them, a quote doubled inside. Spreadsheets read and write exactly this.

/** rows as objects keyed by the header row. A blank final line is ignored. */
export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  // A leading BOM is what Excel writes; it is not part of the first header.
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;

  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          quoted = false;
        }
      } else {
        field += ch;
      }
    } else if (ch === '"' && field === "") {
      quoted = true;
    } else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && src[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += ch;
    }
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  if (quoted) throw new Error("unterminated quote at end of file");

  const [header, ...body] = rows;
  if (!header) return { header: [], rows: [] };
  return {
    header,
    rows: body
      .filter((cells) => cells.some((cell) => cell !== ""))
      .map((cells) => Object.fromEntries(header.map((name, i) => [name, cells[i] ?? ""]))),
  };
}

function cell(value) {
  const s = value === null || value === undefined ? "" : String(value);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** The header, then one line per row in header order. */
export function toCsv(header, rows) {
  const lines = [header.map(cell).join(",")];
  for (const row of rows) lines.push(header.map((name) => cell(row[name])).join(","));
  return lines.join("\n") + "\n";
}
