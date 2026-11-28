/**
 * The measurements of the game reference, a line's live take and the same line in a designed
 * version, as one table a model reads beside the audio or the picture.
 */
import type { Measures } from "./types";

export type Evidence = {
  reference: Measures | null;
  live: Measures | null;
  sample: Measures | null;
  /** The designed version's column, "v3". */
  label: string;
};

const ROWS: { key: keyof Measures; label: string; digits: number }[] = [
  { key: "f0Hz", label: "F0, mean pitch (Hz)", digits: 0 },
  { key: "f0RangeSt", label: "F0 range (semitones)", digits: 1 },
  { key: "voicedPerSec", label: "voiced segments per second (pace)", digits: 2 },
  { key: "pauseRate", label: "pauses of 150 ms+ per second of speech (phrasing)", digits: 2 },
  { key: "pauseMeanSec", label: "mean pause (s)", digits: 2 },
  { key: "f0SdSt", label: "pitch movement (semitones; low = monotone, high = sing-song)", digits: 1 },
  { key: "phraseEndSt", label: "phrase ends (semitones; below 0 falls, above 0 rises)", digits: 1 },
  { key: "loudnessSdDb", label: "loudness swing while speaking (dB; stress and emphasis)", digits: 1 },
  { key: "hnrDb", label: "HNR (dB; low = rough, raspy)", digits: 1 },
  { key: "jitter", label: "jitter", digits: 3 },
  { key: "shimmerDb", label: "shimmer (dB)", digits: 2 },
  { key: "h1h2Db", label: "H1-H2 (dB; high = breathy)", digits: 1 },
  { key: "f1Hz", label: "F1 (Hz)", digits: 0 },
  { key: "f2Hz", label: "F2 (Hz)", digits: 0 },
  { key: "f3Hz", label: "F3 (Hz)", digits: 0 },
  { key: "alphaRatioDb", label: "alpha ratio (dB; higher = brighter)", digits: 1 },
  { key: "hammarbergDb", label: "Hammarberg index (dB; higher = darker)", digits: 1 },
  { key: "ess", label: "s-level (5-10 kHz share; live takes sit near 0.07)", digits: 3 },
  { key: "decay", label: "room tail (dB after a phrase)", digits: 1 },
  { key: "level", label: "speech level (dBFS)", digits: 1 },
  { key: "durationSec", label: "duration (s)", digits: 2 },
];

/** New over live for the same text: above 1 the version speaks the line more slowly. */
export function durationRatio(evidence: Pick<Evidence, "live" | "sample">): number | null {
  const live = evidence.live?.durationSec;
  const sample = evidence.sample?.durationSec;
  return live && sample ? sample / live : null;
}

/** A markdown table, or "" when nothing was measured. */
export function evidenceTable(evidence: Evidence): string {
  const columns = [
    ["reference (game)", evidence.reference],
    ["live take", evidence.live],
    [evidence.label, evidence.sample],
  ] as const;
  const rows = ROWS.filter((row) => columns.some(([, m]) => typeof m?.[row.key] === "number")).map(
    (row) =>
      `| ${row.label} | ${columns
        .map(([, m]) => {
          const value = m?.[row.key];
          return typeof value === "number" ? value.toFixed(row.digits) : "-";
        })
        .join(" | ")} |`,
  );
  if (rows.length === 0) return "";
  const ratio = durationRatio(evidence);
  return [
    `| measure | ${columns.map(([label]) => label).join(" | ")} |`,
    `|---|${columns.map(() => "---").join("|")}|`,
    ...rows,
    ...(ratio === null ? [] : [`\nDuration of the same line, ${evidence.label} / live take: ${ratio.toFixed(2)} (above 1 is slower).`]),
  ].join("\n");
}
