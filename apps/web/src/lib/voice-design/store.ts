/**
 * The workbench's rows (migration 0134). Every read and write is the caller's team's, so a
 * version is the team's rather than its author's.
 */
import "server-only";

import type { PoolClient } from "pg";

import type { Lang } from "@/lib/lang";
import { asTeamOf, readAs } from "@/lib/teams/store";
import { isUuid } from "@/lib/uuid";

import { DesignError } from "./access";
import type { ReviewStatus } from "./groups";
import type {
  Analysis,
  ClipMark,
  Design,
  DesignPreview,
  DesignSample,
  FeedbackNote,
  GeminiResult,
  Measures,
  PlayerNote,
  Review,
  Showing,
  Verdict,
} from "./types";

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
  note: string | null;
  analysis: Record<string, unknown> | null;
  createdBy: string | null;
  createdByName: string | null;
  createdAt: Date;
};

const DESIGN_SELECT = `
  select d."id", d."lang", d."slot", d."version", d."prompt", d."previewText", d."previews",
         d."chosenPreview", d."voiceId", d."voiceName", d."holderId", h."name" as "holderName",
         d."voiceDeletedAt", d."sampleModel", d."analysisId", d."note", d."analysis", d."createdBy",
         c."name" as "createdByName", d."createdAt"
    from "voice_design" d
    left join "user" h on h."id" = d."holderId"
    left join "user" c on c."id" = d."createdBy"`;

type SampleRow = DesignSample & { designId: string; createdAt: Date };
type ShowingRow = {
  id: string;
  designId: string;
  createdAt: Date;
  createdByName: string | null;
  isPublic: boolean;
  samples: { sha256: string }[] | null;
};
type FeedbackRow = { showingId: string; voter: string; who: string | null; verdict: Verdict; note: string; hidden: boolean; at: Date };

/** The newest showing of the slot of the showing aliased `s`: the version players hear. */
export const NEWEST_SHOWING = `
  (select s2."id" from "voice_design_showing" s2
    where s2."teamId" = s."teamId" and s2."lang" = s."lang" and s2."slot" = s."slot"
    order by s2."id" desc limit 1)`;

function showingsOf(rows: ShowingRow[], byShowing: Map<string, FeedbackRow[]>): Showing[] {
  return rows.map((row) => {
    const own = byShowing.get(row.id) ?? [];
    const counts: Record<Verdict, number> = { fits: 0, close: 0, off: 0, skip: 0 };
    for (const f of own) counts[f.verdict] += 1;
    const notes: FeedbackNote[] = own
      .filter((f) => f.note && !f.hidden)
      .map((f) => ({ voter: f.voter, who: f.who, verdict: f.verdict, note: f.note, at: f.at.toISOString() }));
    return { id: Number(row.id), createdAt: row.createdAt.toISOString(), createdByName: row.createdByName, counts, notes };
  });
}
type ReviewRow = Omit<Review, "createdAt" | "id"> & { id: string; designId: string; createdAt: Date };

async function assemble(lang: Lang, rows: DesignRow[]): Promise<Design[]> {
  if (rows.length === 0) return [];
  const ids = rows.map((row) => row.id);
  const [samples, reviews, showings, feedback] = await Promise.all([
    readAs<SampleRow>(
      lang,
      `select "designId", "position", "sha256", "lineId", "text", "npcName", "characters", "credits", "createdAt"
         from "voice_design_clip" where "designId" = any($1::uuid[]) and "kind" = 'sample'
        order by "position"`,
      [ids],
    ),
    readAs<ReviewRow>(
      lang,
      `select r."id", r."designId", r."status", r."note", r."bestPreview", r."clips", r."players", r."createdBy",
              u."name" as "createdByName", r."createdAt"
         from "voice_design_review" r left join "user" u on u."id" = r."createdBy"
        where r."designId" = any($1::uuid[])
        order by r."createdAt", r."id"`,
      [ids],
    ),
    readAs<ShowingRow>(
      lang,
      `select s."id", s."designId", s."createdAt", u."name" as "createdByName", s."id" = ${NEWEST_SHOWING} as "isPublic", s."samples"
         from "voice_design_showing" s left join "user" u on u."id" = s."createdBy"
        where s."designId" = any($1::uuid[])
        order by s."id" desc`,
      [ids],
    ),
    readAs<FeedbackRow>(
      lang,
      `select f."showingId", f."voter", u."name" as "who", f."verdict", f."note", f."hiddenAt" is not null as "hidden",
              f."updatedAt" as "at"
         from "voice_feedback" f
         join "voice_design_showing" s on s."id" = f."showingId"
         left join "user" u on u."id" = f."userId"
        where s."designId" = any($1::uuid[])
        order by f."updatedAt" desc`,
      [ids],
    ),
  ]);
  const byShowing = new Map<string, FeedbackRow[]>();
  for (const f of feedback) byShowing.set(f.showingId, [...(byShowing.get(f.showingId) ?? []), f]);
  return rows.map((row) => {
    const shown = showings.filter((s) => s.designId === row.id);
    const own = samples.filter((s) => s.designId === row.id);
    const heard = shown.find((s) => s.isPublic);
    return {
      ...row,
      voiceDeletedAt: row.voiceDeletedAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
      samples: own.map(({ designId: _, createdAt: __, ...sample }) => sample),
      // A version's lines are always written together, in one statement's transaction.
      sampledAt: own[0]?.createdAt.toISOString() ?? null,
      reviews: reviews
        .filter((r) => r.designId === row.id)
        .map(({ designId: _, ...review }) => ({ ...review, id: Number(review.id), createdAt: review.createdAt.toISOString() })),
      isPublic: !!heard,
      playersHearOlderLines: !!heard?.samples && heard.samples.map((line) => line.sha256).join() !== own.map((sample) => sample.sha256).join(),
      showings: showingsOf(shown, byShowing),
    };
  });
}

/** Every version of the team's slots in `lang`, or of one slot: by slot, newest version first. */
export async function listDesigns(lang: Lang, slot: string | null = null): Promise<Design[]> {
  const rows = await readAs<DesignRow>(
    lang,
    `${DESIGN_SELECT} where d."lang" = $1 and ($2::text is null or d."slot" = $2) order by d."slot", d."version" desc`,
    [lang, slot],
  );
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
  /** Gemini's description, for a version drafted by a revision. */
  analysis?: Record<string, unknown> | null;
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

/** `at` dates imported lines to their version, so its imported verdicts count as given on them. */
async function insertSamples(client: PoolClient, designId: string, samples: DesignSample[], at: string | null = null): Promise<void> {
  for (const sample of samples) {
    await client.query(
      `insert into "voice_design_clip" ("designId", "kind", "position", "sha256", "lineId", "text", "npcName", "characters", "credits", "createdAt")
       values ($1, 'sample', $2, $3, $4, $5, $6, $7, $8, coalesce($9::timestamptz, now()))`,
      [designId, sample.position, sample.sha256, sample.lineId, sample.text, sample.npcName, sample.characters, sample.credits, at],
    );
  }
}

async function insertReview(client: PoolClient, designId: string, review: NewReview): Promise<void> {
  await client.query(
    `insert into "voice_design_review" ("designId", "status", "note", "bestPreview", "clips", "players", "createdBy", "createdAt")
     values ($1, $2, $3, $4, $5, $6, $7, coalesce($8::timestamptz, now()))`,
    [
      designId,
      review.status,
      review.note,
      review.bestPreview,
      JSON.stringify(review.clips),
      JSON.stringify(review.players ?? []),
      review.userId,
      review.at ?? null,
    ],
  );
}

/** The next version of the slot. Two people designing the same slot at once queue on a lock. */
export async function createDesign(input: NewDesign): Promise<Design> {
  const id = await asTeamOf(input.lang, async (client) => {
    await client.query(`select pg_advisory_xact_lock(hashtext('voice_design:' || $1 || ':' || $2))`, [input.lang, input.slot]);
    const { rows } = await client.query<{ id: string }>(
      `insert into "voice_design" ("lang", "slot", "version", "prompt", "previewText", "previews", "analysisId", "createdBy", "analysis")
       select $1, $2, coalesce(max("version"), 0) + 1, $3, $4, $5, $6, $7, $8
         from "voice_design" where "lang" = $1 and "slot" = $2
       returning "id"`,
      [
        input.lang,
        input.slot,
        input.prompt,
        input.previewText,
        JSON.stringify(input.previews),
        input.analysisId,
        input.userId,
        input.analysis ? JSON.stringify(input.analysis) : null,
      ],
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
    note: string | null;
    voiceDeleted: boolean;
    samples: DesignSample[];
    reviews: NewReview[];
  },
): Promise<string | null> {
  return asTeamOf(input.lang, async (client) => {
    const { rows } = await client.query<{ id: string }>(
      `insert into "voice_design"
         ("lang", "slot", "version", "prompt", "previewText", "previews", "chosenPreview", "voiceId", "voiceName",
          "holderId", "sampleModel", "createdBy", "createdAt", "note", "analysis", "voiceDeletedAt")
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $10, coalesce($12::timestamptz, now()), $13, $14,
               case when $15 then coalesce($12::timestamptz, now()) end)
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
        input.note,
        input.analysis ? JSON.stringify(input.analysis) : null,
        input.voiceDeleted,
      ],
    );
    if (!rows[0]) return null;
    const id = rows[0].id;
    await insertPreviews(client, id, input.previews);
    await insertSamples(client, id, input.samples, input.createdAt);
    for (const review of input.reviews) await insertReview(client, id, review);
    return id;
  });
}

/**
 * Holds the design's slot until the transaction ends, so a Show to players and a re-voice of the
 * same slot cannot interleave. The slot, or null when there is no such design.
 */
export async function lockSlot(client: PoolClient, lang: Lang | null, id: string): Promise<string | null> {
  const { rows } = await client.query<{ lang: string; slot: string }>(
    `select "lang", "slot" from "voice_design" where "id" = $1 and ($2::text is null or "lang" = $2)`,
    [id, lang],
  );
  if (!rows[0]) return null;
  await client.query(`select pg_advisory_xact_lock(hashtext('voice_design:' || $1 || ':' || $2))`, [rows[0].lang, rows[0].slot]);
  return rows[0].slot;
}

/**
 * Players vote on the lines they hear: replacing a public version's lines would leave their votes
 * on audio that no longer plays. Showing another version lifts it.
 */
async function refuseIfPublic(client: PoolClient, id: string): Promise<void> {
  await lockSlot(client, null, id);
  const { rows } = await client.query(
    `select 1 from "voice_design_showing" s where s."designId" = $1 and s."id" = ${NEWEST_SHOWING}`,
    [id],
  );
  if (rows.length > 0) throw new DesignError("Players hear this version. Show another version to players first.");
}

/** Saving again after a deletion drops the old voice's sample lines: they are not this voice. */
export async function saveVoice(
  lang: Lang,
  id: string,
  voice: { chosenPreview: number; voiceId: string; voiceName: string; holderId: string },
): Promise<void> {
  await asTeamOf(lang, async (client) => {
    await refuseIfPublic(client, id);
    await client.query(`delete from "voice_design_clip" where "designId" = $1 and "kind" = 'sample'`, [id]);
    await client.query(
      `update "voice_design" set "chosenPreview" = $3, "voiceId" = $4, "voiceName" = $5, "holderId" = $6,
              "voiceDeletedAt" = null, "sampleModel" = null, "sampleSettings" = null
        where "lang" = $1 and "id" = $2`,
      [lang, id, voice.chosenPreview, voice.voiceId, voice.voiceName, voice.holderId],
    );
  });
}

/** A re-sample replaces the rows; the audio they named stays in the archive. */
export async function replaceSamples(
  lang: Lang,
  id: string,
  samples: DesignSample[],
  made: { model: string; settings: Record<string, unknown> },
): Promise<void> {
  await asTeamOf(lang, async (client) => {
    // A shown version may be voiced again: its showing keeps the lines players hear.
    await lockSlot(client, null, id);
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
  /** Players' notes picked to act on; an imported verdict has none. */
  players?: PlayerNote[];
  userId: string;
  /** The import's own date; now otherwise. */
  at?: string | null;
};

export async function addReview(lang: Lang, id: string, review: NewReview): Promise<void> {
  await asTeamOf(lang, (client) => insertReview(client, id, review));
}

export async function removeReview(lang: Lang, designId: string, reviewId: number): Promise<boolean> {
  if (!isUuid(designId)) return false;
  return asTeamOf(lang, async (client) => {
    const { rowCount } = await client.query(
      `delete from "voice_design_review" r using "voice_design" d
        where r."id" = $3 and r."designId" = $2 and d."id" = r."designId" and d."lang" = $1`,
      [lang, designId, reviewId],
    );
    return (rowCount ?? 0) > 0;
  });
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

export async function readAnalysis(lang: Lang, id: string): Promise<Analysis | null> {
  if (!isUuid(id)) return null;
  const rows = await readAs<AnalysisRow>(lang, `${ANALYSIS_SELECT} where a."id" = $1 and a."lang" = $2`, [id, lang]);
  return rows[0] ? toAnalysis(rows[0]) : null;
}

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
