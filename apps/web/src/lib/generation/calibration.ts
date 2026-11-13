/**
 * What this account has actually been charged, which is what estimates are calibrated from.
 *
 * Split out of billing.ts because that file's arithmetic is shared with the browser, and a
 * `pg` import anywhere in a client component's graph fails the production build with an
 * error neither pnpm test nor pnpm typecheck reports.
 */
import { ALL_TEAMS, queryIn } from "@/lib/db";
import type { Lang } from "@/lib/lang";
import { readAs } from "@/lib/teams/store";
import { fishPrice } from "@/lib/voices/fish";

import { CALIBRATION_SAMPLE, LIST_RATE, type Rate } from "./billing";

/**
 * The rate this account has actually been charged for a model, or the list rate.
 *
 * Per model, because the flash and turbo families are billed at half the others, and one
 * blended rate would be right for neither.
 *
 * As ALL_TEAMS: the rate is the plan's, and every team's takes were billed by the same one.
 */
export async function observedRate(modelId: string): Promise<Rate> {
  const rows = await queryIn<{ characters: string | null; credits: string | null; n: string }>(
    ALL_TEAMS,
    `select sum("characters")::text as characters,
            sum("credits")::text    as credits,
            count(*)::text          as n
       from (
         select "characters", "credits"
           from "take"
          -- Both sides, deliberately: the rate being calibrated belongs to the plan, and
          -- which corpus was narrated to measure it does not change the next line's cost.
          where "modelId" = $1 and "credits" is not null and "characters" > 0
          order by "createdAt" desc
          limit ${CALIBRATION_SAMPLE}
       ) recent`,
    [modelId],
  );

  const row = rows[0];
  const characters = Number(row?.characters ?? 0);
  const credits = Number(row?.credits ?? 0);
  const samples = Number(row?.n ?? 0);

  // Summed rather than averaged per row: rounding to whole credits makes short lines noisy,
  // and one 20-character take rounding up would drag a per-row mean well off the true rate.
  if (!samples || !characters) return { rate: LIST_RATE, samples: 0, modelId };

  return { rate: credits / characters, samples, modelId };
}

/**
 * Bytes per character of a language's text, at worst, for fish.audio's list price.
 *
 * fish.audio bills UTF-8 bytes and the corpus counts characters. English is one byte a
 * character; accented Latin a little over; Cyrillic two for letters and one for spaces and
 * punctuation; Hangul and Han three. Each figure is the script's letter width, so the
 * estimate is an upper bound until real takes calibrate it, which is the direction to err.
 */
const BYTES_PER_CHARACTER: Partial<Record<Lang, number>> = {
  enUS: 1,
  ruRU: 2,
  koKR: 3,
  zhCN: 3,
  zhTW: 3,
  // Not a letter width: Vietnamese mixes ASCII letters with two- and three-byte ones, and
  // the Forever translation's letters average 1.41 bytes.
  viVN: 1.5,
};
const ACCENTED_LATIN = 1.1;

/**
 * Dollars per character for a fish.audio model in a language: learned from what fish.audio
 * takes in that language actually cost, or list price until there are any.
 *
 * Per language as well as per model, because the bytes a character costs are the
 * language's: a rate learned from English would price Korean at a third of what it costs.
 */
export async function observedFishRate(modelId: string, lang: Lang): Promise<Rate> {
  const rows = await readAs<{ characters: string | null; usd: string | null; n: string }>(
    lang,
    `select sum("characters")::text as characters,
            sum("costUsd")::text    as usd,
            count(*)::text          as n
       from (
         select "characters", "costUsd"
           from "take"
          where "provider" = 'fish' and "modelId" = $1 and "lang" = $2
            and "costUsd" is not null and "characters" > 0
          order by "createdAt" desc
          limit ${CALIBRATION_SAMPLE}
       ) recent`,
    [modelId, lang],
  );

  const row = rows[0];
  const characters = Number(row?.characters ?? 0);
  const samples = Number(row?.n ?? 0);
  if (samples && characters) {
    return { rate: Number(row!.usd) / characters, unit: "usd", samples, modelId };
  }

  // A model fish.audio has not priced has no list rate either, and is said to be unknown
  // rather than given a guess.
  const perByte = fishPrice(modelId);
  if (perByte === null) {
    return { rate: 0, unit: "usd", unknown: true, samples: 0, modelId };
  }
  const width = BYTES_PER_CHARACTER[lang] ?? ACCENTED_LATIN;
  return { rate: (perByte / 1_000_000) * width, unit: "usd", samples: 0, modelId };
}
