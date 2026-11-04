/**
 * Reads the output of scripts/manager/release.mjs for the log dialog. Browser-safe.
 *
 * The script prints `==> step n/m: name` before each step, then that step's own progress, and
 * ends with `==> released <version>: ...` or `==> nothing changed`; publish.mjs prints a
 * `<pack>: +added ~changed -removed` line per pack. Anything else is shown as it came.
 */

export type Tone = "plain" | "pack" | "add" | "change" | "remove" | "version" | "dim";

export type Segment = { text: string; tone: Tone };

export type LogLine = {
  /** 1-based, over the lines shown, which are the end of the output when it was cut. */
  no: number;
  kind: "step" | "final" | "error" | "plain";
  segments: Segment[];
  /** On a step line: which step it opens. */
  step?: { at: number; of: number; name: string };
};

const STEP = /^==> step (\d+)\/(\d+): (.+)$/;

/** What a line is coloured by: the earliest match on the line wins, the first listed on a tie. */
const TOKENS: { pattern: RegExp; tone: Tone }[] = [
  { pattern: /\bSpoken\w+/, tone: "pack" },
  { pattern: /(?<=\s|^)\+\d+\b/, tone: "add" },
  { pattern: /(?<=\s|^)~\d+\b/, tone: "change" },
  { pattern: /(?<=\s)-\d+\b/, tone: "remove" },
  { pattern: /\b\d+\.\d+\.\d+\b/, tone: "version" },
  { pattern: /\bhashing\b|\(dry run: nothing sent\)/, tone: "dim" },
];

/** A line cut into coloured runs; joined back, the segments are the line exactly. */
export function segments(text: string): Segment[] {
  const out: Segment[] = [];
  let rest = text;
  while (rest) {
    let best: { index: number; length: number; tone: Tone } | null = null;
    for (const { pattern, tone } of TOKENS) {
      const match = pattern.exec(rest);
      if (match && (!best || match.index < best.index)) best = { index: match.index, length: match[0].length, tone };
    }
    if (!best) {
      out.push({ text: rest, tone: "plain" });
      break;
    }
    if (best.index > 0) out.push({ text: rest.slice(0, best.index), tone: "plain" });
    out.push({ text: rest.slice(best.index, best.index + best.length), tone: best.tone });
    rest = rest.slice(best.index + best.length);
  }
  return out;
}

/** publish.mjs counts bytes, which nobody reads at 44410828; Copy and download keep the original. */
function readableBytes(text: string): string {
  return text.replace(/\b(\d{4,}) bytes\b/, (_, n: string) => {
    const bytes = Number(n);
    return bytes >= 1e6 ? `${(bytes / 1e6).toFixed(1)} MB` : `${(bytes / 1e3).toFixed(1)} KB`;
  });
}

export function parseLog(log: string): LogLine[] {
  const lines = log.replace(/\n$/, "").split("\n");
  if (lines.length === 1 && lines[0] === "") return [];
  return lines.map((text, index) => {
    const no = index + 1;
    const step = STEP.exec(text);
    if (step) {
      const [at, of, name] = [Number(step[1]), Number(step[2]), step[3]];
      return { no, kind: "step", step: { at, of, name }, segments: [{ text: `Step ${at} of ${of} · ${name}`, tone: "plain" }] };
    }
    if (/^==> (released|would release|nothing changed|done)/.test(text)) {
      return { no, kind: "final", segments: segments(text.slice(4)) };
    }
    if (/^error: /.test(text)) return { no, kind: "error", segments: [{ text, tone: "plain" }] };
    return { no, kind: "plain", segments: segments(readableBytes(text)) };
  });
}
