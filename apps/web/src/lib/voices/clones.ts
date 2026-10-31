/**
 * Provenance for the voices this app created.
 *
 * Deliberately not the source of truth for whether a voice exists — that is the ElevenLabs
 * account, read by listVoices, because a voice made in their dashboard is just as real to
 * tts_cli/voices.py. This records what the account cannot: who made it, from how much
 * audio, and on whose consent.
 */
import { BASE_LANG, type Lang } from "@/lib/lang";
import { queryAs, readAs } from "@/lib/teams/store";

export type VoiceClone = {
  voice: string;
  voiceId: string;
  clonedAt: string;
  clonedBy: string | null;
  sampleCount: number;
  sampleBytes: number;
  contributor: string | null;
};

/** One language's clones, by slot. A slot's clone is per language: see migration 0035. */
export async function listClones(lang: Lang = BASE_LANG): Promise<Map<string, VoiceClone>> {
  const rows = await readAs<VoiceClone>(
    lang,
    `select "voice", "voiceId", "clonedAt", "clonedBy",
            "sampleCount", "sampleBytes"::int, "contributor"
       from "voice_clone" where "lang" = $1`,
    [lang],
  );
  return new Map(rows.map((row) => [row.voice, row]));
}

/**
 * Record a clone, replacing any earlier record for the same slot.
 *
 * A slot holds one voice, so re-cloning overwrites rather than accumulating: the previous
 * ElevenLabs voice has been deleted by then, and a row pointing at a voice_id that no longer
 * exists would be worse than no row.
 */
export async function recordClone(clone: {
  voice: string;
  voiceId: string;
  clonedBy: string;
  sampleCount: number;
  sampleBytes: number;
  contributor?: string | null;
  contributorUrl?: string | null;
  consentNote?: string | null;
  lang?: Lang;
}): Promise<void> {
  await queryAs(
    clone.lang ?? BASE_LANG,
    `insert into "voice_clone"
       ("voice", "voiceId", "clonedBy", "sampleCount", "sampleBytes",
        "contributor", "contributorUrl", "consentAt", "consentNote", "lang")
     -- $6 is cast because Postgres cannot infer a parameter's type from "is null" alone,
     -- and rejects the statement with "could not determine data type of parameter".
     values ($1, $2, $3, $4, $5, $6, $7, case when $6::text is null then null else now() end, $8,
             $9)
     on conflict ("voice", "lang") do update set
       "voiceId"        = excluded."voiceId",
       "clonedAt"       = now(),
       "clonedBy"       = excluded."clonedBy",
       "sampleCount"    = excluded."sampleCount",
       "sampleBytes"    = excluded."sampleBytes",
       "contributor"    = excluded."contributor",
       "contributorUrl" = excluded."contributorUrl",
       "consentAt"      = excluded."consentAt",
       "consentNote"    = excluded."consentNote"`,
    [
      clone.voice,
      clone.voiceId,
      clone.clonedBy,
      clone.sampleCount,
      clone.sampleBytes,
      clone.contributor ?? null,
      clone.contributorUrl ?? null,
      clone.consentNote ?? null,
      clone.lang ?? BASE_LANG,
    ],
  );
}
