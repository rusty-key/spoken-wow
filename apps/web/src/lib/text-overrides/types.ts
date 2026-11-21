/** Browser-safe: the shapes of a team's own wording for a place, readable or boss line. */

export type NarratedSource = "places" | "readables" | "bosses";

export type TextOverride = {
  lineId: string;
  text: string;
  updatedAt: string;
  updatedBy: string | null;
  /** Null for a row saved without an original to compare, which never drifts. */
  originalHash: string | null;
};

/** What a catalogue entry carries for a line its team has rewritten. */
export type OverrideView = {
  text: string;
  drifted: boolean;
  updatedAt: string;
  updatedBy: string | null;
};
