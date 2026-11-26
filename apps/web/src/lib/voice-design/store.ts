/**
 * The workbench's rows (migration 0134). Every read and write is the caller's team's, so a
 * version is the team's rather than its author's.
 */
import "server-only";

import type { PoolClient } from "pg";

import type { Lang } from "@/lib/lang";
import { asTeamOf, readAs } from "@/lib/teams/store";
import { isUuid } from "@/lib/uuid";

import type { ReviewStatus } from "./groups";
import type { Analysis, ClipMark, Design, DesignPreview, DesignSample, GeminiResult, Measures, Review } from "./types";

type DesignRow = {
  id: string;
  lang: string;
  slot: string;
  version: number;
  prompt: string;
  previewText: string;
  previews: DesignPreview[];
  chosenPreview: number | null;
  voiceId: string | null;
  voiceName: string | null;
  holderId: string | null;
  holderName: string | null;
  voiceDeletedAt: Date | null;
  sampleModel: string | null;
  analysisId: string | null;
  createdBy: string | null;
  createdByName: string | null;
  createdAt: Date;
};

const DESIGN_SELECT = `
  select d."id", d."lang", d."slot", d."version", d."prompt", d."previewText", d."previews",
         d."chosenPreview", d."voiceId", d."voiceName", d."holderId", h."name" as "holderName",
         d."voiceDeletedAt", d."sampleModel", d."analysisId", d."createdBy",
         c."name" as "createdByName", d."createdAt"
    from "voice_design" d
    left join "user" h on h."id" = d."holderId"
    left join "user" c on c."id" = d."createdBy"`;

type SampleRow = DesignSample & { designId: string };
type ReviewRow = Omit<Review, "createdAt" | "id"> & { id: string; designId: string; createdAt: Date };

async function assemble(lang: Lang, rows: DesignRow[]): Promise<Design[]> {
  if (rows.length === 0) return [];
  const ids = rows.map((row) => row.id);
  const [samples, reviews] = await Promise.all([
    readAs<SampleRow>(
      lang,
      `select "designId", "position", "sha256", "lineId", "text", "npcName", "characters", "credits"
         from "voice_design_clip" where "designId" = any($1::uuid[]) and "kind" = 'sample'
        order by "position"`,
      [ids],
    ),
    readAs<ReviewRow>(
      lang,
      `select r."id", r."designId", r."status", r."note", r."bestPreview", r."clips", r."createdBy",
              u."name" as "createdByName", r."createdAt"
         from "voice_design_review" r left join "user" u on u."id" = r."createdBy"
        where r."designId" = any($1::uuid[])
        order by r."createdAt", r."id"`,
      [ids],
    ),
  ]);
  return rows.map((row) => ({
    ...row,
    voiceDeletedAt: row.voiceDeletedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    samples: samples.filter((s) => s.designId === row.id).map(({ designId: _, ...sample }) => sample),
    reviews: reviews
      .filter((r) => r.designId === row.id)
      .map(({ designId: _, ...review }) => ({ ...review, id: Number(review.id), createdAt: review.createdAt.toISOString() })),
  }));
}

/** Every version of the team's slots in `lang`: by slot, newest version first. */
export async function listDesigns(lang: Lang): Promise<Design[]> {
  const rows = await readAs<DesignRow>(lang, `${DESIGN_SELECT} where d."lang" = $1 order by d."slot", d."version" desc`, [lang]);
  return assemble(lang, rows);
}

export async function readDesign(lang: Lang, id: string): Promise<Design | null> {
  // Ids come from URLs and bodies: Postgres answers a malformed one with a cast error, not "no row".
  if (!isUuid(id)) return null;
  const rows = await readAs<DesignRow>(lang, `${DESIGN_SELECT} where d."lang" = $1 and d."id" = $2`, [lang, id]);
  return (await assemble(lang, rows))[0] ?? null;
}

export type NewDesign = {
  lang: Lang;
  slot: string;
  prompt: string;
  previewText: string;
  previews: DesignPreview[];
  analysisId: string | null;
  userId: string;
};

async function insertPreviews(client: PoolClient, designId: string, previews: DesignPreview[]): Promise<void> {
  for (const [position, preview] of previews.entries()) {
    await client.query(
      `insert into "voice_design_clip" ("designId", "kind", "position", "sha256") values ($1, 'preview', $2, $3)`,
      [designId, position, preview.sha256],
    );
  }
}

async function insertSamples(client: PoolClient, designId: string, samples: DesignSample[]): Promise<void> {
  for (const sample of samples) {
    await client.query(
      `insert into "voice_design_clip" ("designId", "kind", "position", "sha256", "lineId", "text", "npcName", "characters", "credits")
       values ($1, 'sample', $2, $3, $4, $5, $6, $7, $8)`,
      [designId, sample.position, sample.sha256, sample.lineId, sample.text, sample.npcName, sample.characters, sample.credits],
    );
  }
}

async function insertReview(client: PoolClient, designId: string, review: NewReview): Promise<void> {
  await client.query(
    `insert into "voice_design_review" ("designId", "status", "note", "bestPreview", "clips", "createdBy", "createdAt")
     values ($1, $2, $3, $4, $5, $6, coalesce($7::timestamptz, now()))`,
    [designId, review.status, review.note, review.bestPreview, JSON.stringify(review.clips), review.userId, review.at ?? null],
  );
}

/** The next version of the slot. Two people designing the same slot at once queue on a lock. */
export async function createDesign(input: NewDesign): Promise<Design> {
  const id = await asTeamOf(input.lang, async (client) => {
    await client.query(`select pg_advisory_xact_lock(hashtext('voice_design:' || $1 || ':' || $2))`, [input.lang, input.slot]);
    const { rows } = await client.query<{ id: string }>(
      `insert into "voice_design" ("lang", "slot", "version", "prompt", "previewText", "previews", "analysisId", "createdBy")
       select $1, $2, coalesce(max("version"), 0) + 1, $3, $4, $5, $6, $7
         from "voice_design" where "lang" = $1 and "slot" = $2
       returning "id"`,
      [input.lang, input.slot, input.prompt, input.previewText, JSON.stringify(input.previews), input.analysisId, input.userId],
    );
    await insertPreviews(client, rows[0].id, input.previews);
    return rows[0].id;
  });
  return (await readDesign(input.lang, id))!;
}

/**
 * For the round-one import, which carries its own version numbers and dates. One transaction, so
 * a failure leaves nothing behind and the folder can simply be imported again.
 */
export async function importDesign(
  input: NewDesign & {
    version: number;
    chosenPreview: number | null;
    voiceId: string | null;
    voiceName: string | null;
    sampleModel: string | null;
    createdAt: string | null;
    samples: DesignSample[];
    reviews: NewReview[];
  },
): Promise<string | null> {
  return asTeamOf(input.lang, async (client) => {
    const { rows } = await client.query<{ id: string }>(
      `insert into "voice_design"
         ("lang", "slot", "version", "prompt", "previewText", "previews", "chosenPreview", "voiceId", "voiceName",
          "holderId", "sampleModel", "createdBy", "createdAt")
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $10, coalesce($12::timestamptz, now()))
       on conflict ("teamId", "lang", "slot", "version") do nothing
       returning "id"`,
      [
        input.lang,
        input.slot,
        input.version,
        input.prompt,
        input.previewText,
        JSON.stringify(input.previews),
        input.chosenPreview,
        input.voiceId,
        input.voiceName,
        input.userId,
        input.sampleModel,
        input.createdAt,
      ],
    );
    if (!rows[0]) return null;
    const id = rows[0].id;
    await insertPreviews(client, id, input.previews);
    await insertSamples(client, id, input.samples);
    for (const review of input.reviews) await insertReview(client, id, review);
    return id;
  });
}

export async function saveVoice(
  lang: Lang,
  id: string,
  voice: { chosenPreview: number; voiceId: string; voiceName: string; holderId: string },
): Promise<void> {
  await asTeamOf(lang, (client) =>
    client.query(
      `update "voice_design" set "chosenPreview" = $3, "voiceId" = $4, "voiceName" = $5, "holderId" = $6
        where "lang" = $1 and "id" = $2`,
      [lang, id, voice.chosenPreview, voice.voiceId, voice.voiceName, voice.holderId],
    ),
  );
}

/** A re-sample replaces the rows; the audio they named stays in the archive. */
export async function replaceSamples(
  lang: Lang,
  id: string,
  samples: DesignSample[],
  made: { model: string; settings: Record<string, unknown> },
): Promise<void> {
  await asTeamOf(lang, async (client) => {
    await client.query(`delete from "voice_design_clip" where "designId" = $1 and "kind" = 'sample'`, [id]);
    await insertSamples(client, id, samples);
    await client.query(
      `update "voice_design" set "sampleModel" = $2, "sampleSettings" = $3 where "id" = $1`,
      [id, made.model, JSON.stringify(made.settings)],
    );
  });
}

export type NewReview = {
  status: ReviewStatus;
  note: string;
  bestPreview: number | null;
  clips: Record<string, ClipMark>;
  userId: string;
  /** The import's own date; now otherwise. */
  at?: string | null;
};

export async function addReview(lang: Lang, id: string, review: NewReview): Promise<void> {
  await asTeamOf(lang, (client) => insertReview(client, id, review));
}

export async function markVoiceDeleted(lang: Lang, id: string): Promise<void> {
  await asTeamOf(lang, (client) =>
    client.query(`update "voice_design" set "voiceDeletedAt" = now() where "lang" = $1 and "id" = $2`, [lang, id]),
  );
}

/** Whether a clip of the caller's team names these bytes: the audio route serves nothing else. */
export async function isDesignAudio(lang: Lang, sha256: string): Promise<boolean> {
  const rows = await readAs(
    lang,
    `select 1 from "voice_design_clip" c join "voice_design" d on d."id" = c."designId"
      where c."sha256" = $1 and d."lang" = $2 limit 1`,
    [sha256, lang],
  );
  return rows.length > 0;
}

export type NewAnalysis = {
  lang: Lang;
  group: string;
  labels: Record<string, string>;
  result: GeminiResult;
  measurements: Record<string, Measures> | null;
  model: string;
  userId: string;
};

type AnalysisRow = Omit<Analysis, "createdAt"> & { createdAt: Date };

const ANALYSIS_SELECT = `
  select a."id", a."group", a."labels", a."result", a."measurements", a."model",
         u."name" as "createdByName", a."createdAt"
    from "voice_design_analysis" a left join "user" u on u."id" = a."createdBy"`;

const toAnalysis = (row: AnalysisRow): Analysis => ({ ...row, createdAt: row.createdAt.toISOString() });

/** Whether the caller's team ran this analysis in `lang`: a foreign key alone would accept another team's. */
export async function isOwnAnalysis(lang: Lang, id: string): Promise<boolean> {
  if (!isUuid(id)) return false;
  const rows = await readAs(lang, `select 1 from "voice_design_analysis" where "id" = $1 and "lang" = $2`, [id, lang]);
  return rows.length > 0;
}

export async function saveAnalysis(input: NewAnalysis): Promise<Analysis> {
  const id = await asTeamOf(input.lang, async (client) => {
    const { rows } = await client.query<{ id: string }>(
      `insert into "voice_design_analysis" ("lang", "group", "labels", "result", "measurements", "model", "createdBy")
       values ($1, $2, $3, $4, $5, $6, $7) returning "id"`,
      [
        input.lang,
        input.group,
        JSON.stringify(input.labels),
        JSON.stringify(input.result),
        input.measurements === null ? null : JSON.stringify(input.measurements),
        input.model,
        input.userId,
      ],
    );
    return rows[0].id;
  });
  const rows = await readAs<AnalysisRow>(input.lang, `${ANALYSIS_SELECT} where a."id" = $1`, [id]);
  return toAnalysis(rows[0]);
}

export async function latestAnalyses(lang: Lang): Promise<Map<string, Analysis>> {
  const rows = await readAs<AnalysisRow>(
    lang,
    `select * from (${ANALYSIS_SELECT} where a."lang" = $1) q
      order by "group", "createdAt" desc`,
    [lang],
  );
  const latest = new Map<string, Analysis>();
  for (const row of rows) if (!latest.has(row.group)) latest.set(row.group, toAnalysis(row));
  return latest;
}
