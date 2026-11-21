/**
 * What a batch will cost, and what it did cost.
 *
 * ElevenLabs does not bill the characters you send. It bills round(characters * rate), and
 * the rate belongs to the plan rather than the request - 0.55 on the account this was built
 * against, and half that for the flash and turbo models, so a 310-character line cost 170.
 *
 * That rate cannot be read from the API and must not be hardcoded: it is a property of
 * someone's plan and discounts, and a constant here would quietly misprice every batch the
 * day either changes. So the rate is *learned* from what this account has actually been
 * charged, which the `character-cost` response header reports exactly.
 *
 * Until there is anything to learn from, estimates use 1 credit per character. That is the
 * documented list rate and an upper bound on every plan observed, which is the right
 * direction to be wrong in when the number is there to stop someone spending a month's
 * budget by accident.
 *
 * fish.audio bills differently and simply: list price in dollars per UTF-8 byte, with no
 * plan in between. A fish.audio Rate is dollars per character, so an estimate is the same
 * multiplication whichever provider it is for; the bytes-per-character of the language is
 * folded into the rate, learned from past fish.audio takes the same way credits are (see
 * calibration.ts). Credits and dollars are never added together anywhere.
 *
 * Everything here is pure and free of node imports, because the confirm dialog is a client
 * component and must show the same figure the server would. Reading the calibration out of
 * Postgres lives in calibration.ts.
 */
/** Credits per character before any plan discount. Deliberately pessimistic. */
export const LIST_RATE = 1;

/**
 * How many recent takes to calibrate from.
 *
 * Enough to survive one odd measurement, short enough that a plan change shows up within a
 * batch or two rather than being averaged away for months.
 */
export const CALIBRATION_SAMPLE = 50;

export type Rate = {
  /** Credits per character, or dollars per character when `unit` is "usd". */
  rate: number;
  /** ElevenLabs credits when absent, which every rate was before fish.audio. */
  unit?: "credits" | "usd";
  /** No price is known for this model at all, so nothing can be estimated. */
  unknown?: boolean;
  /** How many past takes this came from. Zero means the fallback is in use. */
  samples: number;
  modelId: string | null;
};

/**
 * Round half to even, which is what ElevenLabs appears to do.
 *
 * Math.round would be wrong in both directions on a rate of 0.55, and the two cases that
 * pin it down disagree about which way "half" goes:
 *
 *    50 chars -> 27.5  -> billed 28   (half up, and half to even, both give 28)
 *   310 chars -> 170.5 -> billed 170  (half up gives 171; only half to even gives 170)
 *
 * Every measured pair fits this rule and no other simple one. It is still an inference from
 * a handful of observations rather than documented behaviour, and being one credit out on an
 * estimate costs nothing - the actual figure comes from the response header either way.
 */
export function roundHalfToEven(value: number): number {
  const floor = Math.floor(value);
  const remainder = value - floor;
  if (remainder > 0.5) return floor + 1;
  if (remainder < 0.5) return floor;
  return floor % 2 === 0 ? floor : floor + 1;
}

export function estimateCredits(characters: number, rate: number): number {
  return roundHalfToEven(characters * rate);
}

export type Estimate = {
  lines: number;
  /** Distinct audio files, which is what actually gets generated. */
  files: number;
  characters: number;
  /** Whole credits, for an ElevenLabs rate. Zero for a fish.audio one. */
  credits: number;
  /**
   * Dollars, for a fish.audio rate. Null for an ElevenLabs one, and for a fish.audio model
   * with no known price. Never rounded to cents.
   */
  usd: number | null;
  rate: Rate;
};

/**
 * Cost of regenerating a set of lines.
 *
 * Counts distinct files, not lines: 1,076 files in the corpus are spoken by more than one
 * NPC, so a naive per-line total would overstate a quest containing two lines that share an
 * mp3 - and the batch only generates each file once.
 */
export function estimate(
  lines: { characters: number; file: string }[],
  rate: Rate,
): Estimate {
  const byFile = new Map<string, number>();
  for (const line of lines) {
    if (!byFile.has(line.file)) byFile.set(line.file, line.characters);
  }

  const characters = [...byFile.values()].reduce((sum, count) => sum + count, 0);

  return totals({ lines: lines.length, files: byFile.size, characters }, rate);
}

/**
 * The same estimate, from figures already counted.
 *
 * For a caller that has the totals but not the lines. The places section is one: its search
 * already sums the characters it matched, every line there has a file of its own, and
 * shipping 1,353 per-line records to the browser to add them up again would be work for an
 * answer it was already given.
 *
 * Not a shortcut past the per-file counting above, which exists because 1,076 quests files
 * are spoken by more than one NPC -- a caller using this one is asserting it has already
 * done that counting, or that its lines and files are the same set.
 */
export function totals(
  counted: { lines: number; files: number; characters: number },
  rate: Rate,
): Estimate {
  if (rate.unit === "usd") {
    return { ...counted, credits: 0, usd: rate.unknown ? null : counted.characters * rate.rate, rate };
  }
  return {
    ...counted,
    credits: estimateCredits(counted.characters, rate.rate),
    usd: null,
    rate,
  };
}
