/**
 * Community voice packs: authors submit, admins review, the Manager reads the
 * approved ones.
 *
 * THE STORE CHECKS WHO IS ASKING. Every act takes the actor's id and reads their role itself,
 * so a route that forgets a check still cannot let a member approve a pack.
 *
 * THE LIVE VERSION IS THE NEWEST APPROVED SUBMISSION, never the newest submission: a rejected
 * or withdrawn update leaves the version players already have in the Manager's list.
 *
 * Each act commits with its activity row. Email goes after the commit and never fails the act.
 */
import "server-only";

import type { PoolClient } from "pg";

import type { ActivityDetail } from "@/lib/activity/kinds";
import { recordActivity } from "@/lib/activity/store";
import { ALL_TEAMS, query, withTeam } from "@/lib/db";
import { sendEmail } from "@/lib/email";
import { isAdmin } from "@/lib/permissions";

import { compareVersions, validateFields, validateNewPack, type PackFields, type Section } from "./rules";

export class PackError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 403 | 404 | 409,
    readonly errors?: Record<string, string>,
  ) {
    super(message);
  }
}

export type Submission = {
  id: string;
  packId: string;
  status: "pending" | "approved" | "rejected" | "withdrawn";
  submittedBy: string | null;
  submittedAt: string;
  reviewedBy: string | null;
  reviewedAt: string | null;
  rejectReason: string | null;
} & PackFields;

export type Pack = {
  id: string;
  lang: string;
  section: Section;
  ownerId: string | null;
  ownerName: string | null;
  listed: boolean;
  createdAt: string;
  live: Submission | null;
  pending: Submission | null;
  /** The newest rejection since the live version, so its reason is still worth showing. */
  lastRejected: Submission | null;
};

/** One pack as the Manager's registry lists it (manager/src/main/community.ts). */
export type ManagerEntry = {
  id: string;
  title: string;
  author: string;
  description: string;
  lang: string;
  section: Section;
  version: string;
  size: number;
  sha256: string;
  url: string;
  homepage?: string;
  license?: string;
  /** YYYY-MM-DD of the first approval. */
  addedAt: string;
};

const SITE = (process.env.BETTER_AUTH_URL ?? "https://spoken.quest").replace(/\/$/, "");
const MAX_REASON = 500;

type Client = Pick<PoolClient, "query">;

/** A submission as a query or its to_jsonb returns it: to_jsonb gives the timestamps as text. */
type SubmissionRow = Omit<Submission, "size" | "submittedAt" | "reviewedAt"> & {
  size: string;
  submittedAt: Date | string;
  reviewedAt: Date | string | null;
};

const SUBMISSION_COLUMNS = `s."id"::text as "id", s."packId", s."status", s."submittedBy", s."submittedAt",
  s."reviewedBy", s."reviewedAt", s."rejectReason", s."title", s."author", s."description", s."version",
  s."size"::text as "size", s."sha256", s."url", s."homepage", s."license"`;

function submissionOf(row: SubmissionRow): Submission {
  return {
    ...row,
    size: Number(row.size),
    submittedAt: new Date(row.submittedAt).toISOString(),
    reviewedAt: row.reviewedAt ? new Date(row.reviewedAt).toISOString() : null,
  };
}

/**
 * Packs with their live, pending and last rejected submissions, each a json row or null. `where`
 * filters "community_pack" p.
 */
async function packs(where: string, params: unknown[], client?: Client): Promise<Pack[]> {
  const sql = `
    select p."id", p."lang", p."section", p."ownerId", u."name" as "ownerName",
           p."unlistedAt" is null as "listed", p."createdAt",
           live.j as "live", pending.j as "pending", rejected.j as "lastRejected"
      from "community_pack" p
      left join "user" u on u."id" = p."ownerId"
      left join lateral (
        select to_jsonb(x) as j, x."id"::bigint as "liveId" from (
          select ${SUBMISSION_COLUMNS} from "community_pack_submission" s
           where s."packId" = p."id" and s."status" = 'approved'
           order by s."reviewedAt" desc, s."id" desc limit 1) x
      ) live on true
      left join lateral (
        select to_jsonb(x) as j from (
          select ${SUBMISSION_COLUMNS} from "community_pack_submission" s
           where s."packId" = p."id" and s."status" = 'pending') x
      ) pending on true
      left join lateral (
        select to_jsonb(x) as j from (
          select ${SUBMISSION_COLUMNS} from "community_pack_submission" s
           where s."packId" = p."id" and s."status" = 'rejected' and s."id" > coalesce(live."liveId", 0)
           order by s."id" desc limit 1) x
      ) rejected on true
     where ${where}
     order by p."id"`;
  const rows = client ? (await client.query(sql, params)).rows : await query(sql, params);
  return rows.map((row) => ({
    id: row.id,
    lang: row.lang,
    section: row.section,
    ownerId: row.ownerId,
    ownerName: row.ownerName,
    listed: row.listed,
    createdAt: row.createdAt.toISOString(),
    live: row.live && submissionOf(row.live),
    pending: row.pending && submissionOf(row.pending),
    lastRejected: row.lastRejected && submissionOf(row.lastRejected),
  }));
}

async function packOf(id: string, client?: Client): Promise<Pack | null> {
  return (await packs(`p."id" = $1`, [id], client))[0] ?? null;
}

async function roleOf(userId: string, client?: Client): Promise<string | null> {
  const sql = `select "role" from "user" where "id" = $1`;
  const rows = client ? (await client.query(sql, [userId])).rows : await query(sql, [userId]);
  return rows[0]?.role ?? null;
}

async function requireAdmin(client: Client, userId: string): Promise<void> {
  if (!isAdmin(await roleOf(userId, client))) throw new PackError("Only an admin can do that.", 403);
}

/**
 * Activity rows for every language carry no team, and only ALL_TEAMS may write those; the pack
 * tables themselves have no row-level security.
 */
function act<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
  return withTeam(ALL_TEAMS, work);
}

const INSERT_SUBMISSION = `
  insert into "community_pack_submission" as s
    ("packId", "submittedBy", "title", "author", "description", "version", "size", "sha256", "url", "homepage", "license")
  values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
  returning ${SUBMISSION_COLUMNS}`;

async function insertSubmission(client: Client, packId: string, actorId: string, f: PackFields): Promise<Submission> {
  try {
    const { rows } = await client.query<SubmissionRow>(INSERT_SUBMISSION, [
      packId, actorId, f.title, f.author, f.description, f.version, f.size, f.sha256, f.url, f.homepage, f.license,
    ]);
    return submissionOf(rows[0]);
  } catch (error) {
    if ((error as { code?: string }).code === "23505") throw pendingExists();
    throw error;
  }
}

const pendingExists = () =>
  new PackError("A version of this pack is already waiting for review. Withdraw it to submit another.", 409);

function rulesBroken(errors: Record<string, string>): PackError {
  return new PackError("The submission breaks the pack rules.", 400, errors);
}

type PackKind = Extract<keyof ActivityDetail, `pack.${string}`>;

function record<K extends PackKind>(
  client: Client,
  kind: K,
  actorId: string,
  packId: string,
  detail: ActivityDetail[K],
): Promise<void> {
  return recordActivity({ kind, lang: null, actorId, subject: packId, detail }, client);
}

function submitted(client: Client, actorId: string, s: Submission): Promise<void> {
  return record(client, "pack.submitted", actorId, s.packId, { packId: s.packId, version: s.version, submissionId: s.id });
}

async function adminEmails(client: Client): Promise<string[]> {
  const { rows } = await client.query<{ email: string }>(`select "email" from "user" where "role" = 'admin'`);
  return rows.map((row) => row.email);
}

function emailAdmins(to: string[], s: Submission): void {
  const subject = `Pack submission: ${s.title} ${s.version}`;
  const text = [
    `${s.author} submitted ${s.title} ${s.version} (${s.packId}) for review.`,
    "",
    `Review it here: ${SITE}/admin/packs`,
  ].join("\n");
  for (const address of to) sendEmail(address, subject, text);
}

export async function createPack(actorId: string, input: unknown): Promise<Pack> {
  const checked = validateNewPack(input);
  if (!checked.ok) throw rulesBroken(checked.errors);
  const { id, lang, section, ...f } = checked.value;

  const { pack, submission, admins } = await act(async (client) => {
    const created = await client.query(
      `insert into "community_pack" ("id", "ownerId", "lang", "section") values ($1, $2, $3, $4)
       on conflict ("id") do nothing`,
      [id, actorId, lang, section],
    );
    if (created.rowCount === 0) {
      throw new PackError("That pack id is taken. Choose another.", 409, { id: "That pack id is taken." });
    }
    const submission = await insertSubmission(client, id, actorId, f);
    await submitted(client, actorId, submission);
    return { pack: (await packOf(id, client))!, submission, admins: await adminEmails(client) };
  });
  emailAdmins(admins, submission);
  return pack;
}

/**
 * A new version of a pack the actor owns, or any pack for an admin.
 *
 * An unknown or unlisted pack is "not found" alike, and a pack somebody else owns is refused
 * without naming it, so the answers say nothing about another author's pack.
 */
export async function submitVersion(actorId: string, packId: string, input: unknown): Promise<Submission> {
  const checked = validateFields(input);
  if (!checked.ok) throw rulesBroken(checked.errors);
  const f = checked.value;

  const { submission, admins } = await act(async (client) => {
    const role = await roleOf(actorId, client);
    // Locked, so an unlist or a change of owner cannot pass this check halfway.
    const { rows } = await client.query<{ ownerId: string | null; unlistedAt: Date | null }>(
      `select "ownerId", "unlistedAt" from "community_pack" where "id" = $1 for update`,
      [packId],
    );
    const pack = rows[0];
    if (!pack || pack.unlistedAt) throw new PackError("No such pack.", 404);
    if (!isAdmin(role) && pack.ownerId !== actorId) {
      throw new PackError("You can only submit versions of your own packs.", 403);
    }

    const current = (await packOf(packId, client))!;
    if (current.pending) throw pendingExists();
    const live = current.live;
    if (live) {
      const errors: Record<string, string> = {};
      const order = compareVersions(f.version, live.version);
      // Not a version the Manager can compare counts as not newer: it would never offer it.
      if (order === null || order <= 0) errors.version = `The version must be newer than the live ${live.version}.`;
      if (f.url === live.url) errors.url = "The link is the live version's. Upload the new zip as a new release asset.";
      if (f.sha256 === live.sha256) errors.sha256 = "The checksum is the live version's. Is this the new zip?";
      if (Object.keys(errors).length > 0) throw new PackError("This is not a new version of the pack.", 400, errors);
    }

    const submission = await insertSubmission(client, packId, actorId, f);
    await submitted(client, actorId, submission);
    return { submission, admins: await adminEmails(client) };
  });
  emailAdmins(admins, submission);
  return submission;
}

export async function withdrawPending(actorId: string, packId: string): Promise<void> {
  await act(async (client) => {
    const role = await roleOf(actorId, client);
    const { rows } = await client.query<{ ownerId: string | null }>(
      `select "ownerId" from "community_pack" where "id" = $1 for update`,
      [packId],
    );
    if (!rows[0]) throw new PackError("No such pack.", 404);
    if (!isAdmin(role) && rows[0].ownerId !== actorId) throw new PackError("You can only withdraw your own packs.", 403);

    const { rows: withdrawn } = await client.query<{ id: string; version: string }>(
      `update "community_pack_submission" set "status" = 'withdrawn'
        where "packId" = $1 and "status" = 'pending'
        returning "id"::text as "id", "version"`,
      [packId],
    );
    if (!withdrawn[0]) throw new PackError("No version of this pack is waiting for review.", 404);
    await record(client, "pack.withdrawn", actorId, packId, {
      packId,
      version: withdrawn[0].version,
      submissionId: withdrawn[0].id,
    });
  });
}

/**
 * Approve or reject a pending submission.
 *
 * The update only matches a submission still pending, so of two admins deciding at once the
 * second waits on the first's row lock, then matches nothing and is told it was decided.
 */
export async function decide(
  adminId: string,
  submissionId: string,
  decision: "approve" | "reject",
  reason?: string,
): Promise<Submission> {
  const why = reason?.trim() ?? "";
  if (decision === "reject" && (why.length === 0 || why.length > MAX_REASON)) {
    throw new PackError(`Give the author a reason of 1 to ${MAX_REASON} characters.`, 400, {
      reason: `Give a reason of 1 to ${MAX_REASON} characters.`,
    });
  }
  if (!/^\d+$/.test(submissionId)) throw new PackError("No such submission.", 404);

  const { submission, to, unlisted } = await act(async (client) => {
    await requireAdmin(client, adminId);
    const { rows } = await client.query<SubmissionRow>(
      `update "community_pack_submission" s
          set "status" = $2, "reviewedBy" = $3, "reviewedAt" = now(), "rejectReason" = $4
        where s."id" = $1 and s."status" = 'pending'
        returning ${SUBMISSION_COLUMNS}`,
      [submissionId, decision === "approve" ? "approved" : "rejected", adminId, decision === "reject" ? why : null],
    );
    if (!rows[0]) {
      const exists = await client.query(`select 1 from "community_pack_submission" where "id" = $1`, [submissionId]);
      throw exists.rowCount
        ? new PackError("This submission was already decided.", 409)
        : new PackError("No such submission.", 404);
    }
    const submission = submissionOf(rows[0]);
    const detail = { packId: submission.packId, version: submission.version, submissionId };
    await record(
      client,
      decision === "approve" ? "pack.approved" : "pack.rejected",
      adminId,
      submission.packId,
      decision === "approve" ? detail : { ...detail, reason: why },
    );
    const { rows: submitter } = await client.query<{ email: string }>(`select "email" from "user" where "id" = $1`, [
      submission.submittedBy,
    ]);
    const { rows: pack } = await client.query<{ unlisted: boolean }>(
      `select "unlistedAt" is not null as "unlisted" from "community_pack" where "id" = $1`,
      [submission.packId],
    );
    return { submission, to: submitter[0]?.email ?? null, unlisted: pack[0]?.unlisted ?? false };
  });

  if (to) {
    const name = `${submission.title} ${submission.version}`;
    const [subject, ...lines] =
      decision === "approve"
        ? [
            `Your pack ${name} was approved`,
            unlisted
              ? `${name} is approved, but the pack is unlisted, so Spoken Manager does not show it until an admin lists it again.`
              : `${name} is approved and listed in Spoken Manager.`,
            "",
            `Your packs: ${SITE}/packs`,
          ]
        : [
            `Your pack ${name} was not approved`,
            `${name} was not approved. The reviewer wrote:`,
            "",
            why,
            "",
            `Submit a corrected version here: ${SITE}/packs`,
          ];
    sendEmail(to, subject, lines.join("\n"));
  }
  return submission;
}

export async function setOwner(adminId: string, packId: string, ownerId: string | null): Promise<Pack> {
  return act(async (client) => {
    await requireAdmin(client, adminId);
    if (ownerId !== null) {
      const user = await client.query(`select 1 from "user" where "id" = $1`, [ownerId]);
      if (!user.rowCount) throw new PackError("No such user.", 404);
    }
    const updated = await client.query(`update "community_pack" set "ownerId" = $2 where "id" = $1`, [packId, ownerId]);
    if (!updated.rowCount) throw new PackError("No such pack.", 404);
    await record(client, "pack.owner", adminId, packId, { packId, ownerId });
    return (await packOf(packId, client))!;
  });
}

/** Take a pack off the Manager's list, or put it back. Its submissions stay. */
export async function setListed(adminId: string, packId: string, listed: boolean): Promise<Pack> {
  return act(async (client) => {
    await requireAdmin(client, adminId);
    const updated = await client.query(
      listed
        ? `update "community_pack" set "unlistedAt" = null, "unlistedBy" = null where "id" = $1`
        : `update "community_pack" set "unlistedAt" = now(), "unlistedBy" = $2 where "id" = $1`,
      listed ? [packId] : [packId, adminId],
    );
    if (!updated.rowCount) throw new PackError("No such pack.", 404);
    await record(client, listed ? "pack.listed" : "pack.unlisted", adminId, packId, { packId });
    return (await packOf(packId, client))!;
  });
}

export function listOwned(userId: string): Promise<Pack[]> {
  return packs(`p."ownerId" = $1`, [userId]);
}

export function listAll(): Promise<Pack[]> {
  return packs(`true`, []);
}

export function queueOf(all: Pack[]): (Submission & { pack: Pack })[] {
  return all
    .filter((pack) => pack.pending)
    .map((pack) => ({ ...pack.pending!, pack }))
    .sort((a, b) => a.submittedAt.localeCompare(b.submittedAt) || Number(a.id) - Number(b.id));
}

export async function pendingCount(): Promise<number> {
  const rows = await query<{ n: number }>(
    `select count(*)::int as "n" from "community_pack_submission" where "status" = 'pending'`,
  );
  return rows[0].n;
}

export async function historyByPack(): Promise<Map<string, Submission[]>> {
  const rows = await query<SubmissionRow>(
    `select ${SUBMISSION_COLUMNS} from "community_pack_submission" s order by s."id" desc`,
  );
  const byPack = new Map<string, Submission[]>();
  for (const row of rows) {
    const list = byPack.get(row.packId) ?? [];
    list.push(submissionOf(row));
    byPack.set(row.packId, list);
  }
  return byPack;
}

type EntryRow = Omit<ManagerEntry, "size" | "homepage" | "license"> & {
  size: string;
  homepage: string | null;
  license: string | null;
};

export async function managerEntries(): Promise<ManagerEntry[]> {
  const rows = await query<EntryRow>(
    `select distinct on (p."id") p."id", s."title", s."author", s."description", p."lang", p."section",
            s."version", s."size"::text as "size", s."sha256", s."url", s."homepage", s."license",
            to_char((min(s."reviewedAt") over (partition by p."id")) at time zone 'UTC', 'YYYY-MM-DD') as "addedAt"
       from "community_pack" p
       join "community_pack_submission" s on s."packId" = p."id" and s."status" = 'approved'
      where p."unlistedAt" is null
      order by p."id", s."reviewedAt" desc, s."id" desc`,
  );
  // Built key by key: the order is the JSON's, and the route's ETag hashes that JSON.
  return rows.map((row) => ({
    id: row.id,
    title: row.title,
    author: row.author,
    description: row.description,
    lang: row.lang,
    section: row.section,
    version: row.version,
    size: Number(row.size),
    sha256: row.sha256,
    url: row.url,
    ...(row.homepage ? { homepage: row.homepage } : {}),
    ...(row.license ? { license: row.license } : {}),
    addedAt: row.addedAt,
  }));
}
