/**
 * A user's request for a team in a language, and a site admin's answer to it. A request is its own
 * row: until it is approved no language, team or grant exists for it (SELF-SERVE-TEAMS.md).
 * Approval runs `foundTeam` in the same transaction that closes the request; the log and the
 * emails follow the commit.
 */
import "server-only";

import type { PoolClient } from "pg";

import { recordActivity } from "@/lib/activity/store";
import { db, inTransaction, query } from "@/lib/db";
import { sendEmail } from "@/lib/email";
import { langName } from "@/lib/lang";
import { adminEmails, SITE } from "@/lib/site";
import { isUuid } from "@/lib/uuid";

import { TeamError } from "./admin";
import { requestLangName as nameOf } from "./branch-text";
import { afterFounded, foundTeam, languageBranch, type Branch } from "./found";
import type { TeamId } from "./store";

export type RequestState = "pending" | "approved" | "rejected" | "withdrawn";

export type TeamRequest = {
  id: string;
  userId: string;
  email: string;
  lang: string;
  langName: string | null;
  langNative: string | null;
  teamName: string;
  note: string | null;
  state: RequestState;
  reason: string | null;
  approvedTeamId: TeamId | null;
  createdAt: string;
  decidedAt: string | null;
  /** Computed live for a pending request, null once it is decided. */
  branch: Branch | null;
};

export type NewRequest = {
  lang: string;
  language: { name: string; native: string } | null;
  teamName: string;
  note: string | null;
};

const COLUMNS = `r."id", r."userId", u."email", r."lang", r."langName", r."langNative", r."teamName", r."note",
                 r."state", r."reason", r."approvedTeamId", r."createdAt"::text as "createdAt",
                 r."decidedAt"::text as "decidedAt"`;
const FROM = `"team_request" r join "user" u on u."id" = r."userId"`;

type Row = Omit<TeamRequest, "branch">;
type Reader = Pick<PoolClient, "query">;

async function withBranch(row: Row): Promise<TeamRequest> {
  return { ...row, branch: row.state === "pending" ? await languageBranch(row.lang) : null };
}

async function read(id: string, client?: Reader): Promise<Row | null> {
  const { rows } = await (client ?? db()).query<Row>(`select ${COLUMNS} from ${FROM} where r."id" = $1`, [id]);
  return rows[0] ?? null;
}

export async function createRequest(userId: string, input: NewRequest): Promise<TeamRequest> {
  let id: string;
  try {
    const rows = await query<{ id: string }>(
      `insert into "team_request" ("userId", "lang", "langName", "langNative", "teamName", "note")
       values ($1, $2, $3, $4, $5, $6) returning "id"`,
      [userId, input.lang, input.language?.name ?? null, input.language?.native ?? null, input.teamName, input.note],
    );
    id = rows[0].id;
  } catch (error) {
    if ((error as { code?: string }).code === "23505") {
      throw new TeamError(`You already asked for a team in ${input.language?.name ?? langName(input.lang)}.`, 409);
    }
    throw error;
  }
  const request = await withBranch((await read(id))!);
  await recordActivity({
    kind: "request.made",
    lang: null,
    actorId: userId,
    subject: id,
    detail: { requestId: id, lang: input.lang, teamName: input.teamName, newLanguage: request.branch === "new-language" },
  });
  const language = nameOf(request);
  const text = [
    `${request.email} asked for a team called ${request.teamName} in ${language} (${request.lang}).`,
    ...(request.note ? ["", `Their note: ${request.note}`] : []),
    "",
    `Review it here: ${SITE}/admin/teams`,
  ].join("\n");
  for (const address of await adminEmails()) sendEmail(address, `Team request: ${request.teamName} (${language})`, text);
  return request;
}

/** Newest first. */
export async function listRequests(filter: { userId?: string; state?: RequestState }): Promise<TeamRequest[]> {
  const rows = await query<Row>(
    `select ${COLUMNS} from ${FROM}
      where ($1::text is null or r."userId" = $1) and ($2::text is null or r."state" = $2)
      order by r."createdAt" desc, r."id"`,
    [filter.userId ?? null, filter.state ?? null],
  );
  // One branch per language, however many requests name it.
  const branches = new Map<string, Promise<Branch>>();
  const branchOf = (lang: string) => {
    let branch = branches.get(lang);
    if (!branch) branches.set(lang, (branch = languageBranch(lang)));
    return branch;
  };
  return Promise.all(
    rows.map(async (row) => ({ ...row, branch: row.state === "pending" ? await branchOf(row.lang) : null })),
  );
}

export async function withdrawRequest(id: string, userId: string): Promise<TeamRequest> {
  const none = new TeamError("No such request.", 404);
  if (!isUuid(id)) throw none;
  const done = await query<{ id: string }>(
    `update "team_request" set "state" = 'withdrawn', "decidedAt" = now()
      where "id" = $1 and "userId" = $2 and "state" = 'pending' returning "id"`,
    [id, userId],
  );
  if (!done.length) {
    const row = await read(id);
    if (!row || row.userId !== userId) throw none;
    throw new TeamError(`This request was already ${row.state}.`, 409);
  }
  const request = await withBranch((await read(id))!);
  await recordActivity({
    kind: "request.withdrawn",
    lang: null,
    actorId: userId,
    subject: id,
    detail: { requestId: id, lang: request.lang },
  });
  return request;
}

/** The request row locked and known to be pending, or the refusal. */
async function lockPending(client: PoolClient, id: string): Promise<Row> {
  if (!isUuid(id)) throw new TeamError("No such request.", 404);
  await client.query(`select 1 from "team_request" where "id" = $1 for update`, [id]);
  const row = await read(id, client);
  if (!row) throw new TeamError("No such request.", 404);
  if (row.state !== "pending") throw new TeamError(`This request was already ${row.state}.`, 409);
  return row;
}

export async function approveRequest(id: string, actorId: string): Promise<TeamRequest> {
  const { row, founded } = await inTransaction(async (client) => {
    const row = await lockPending(client, id);
    const language = row.langName !== null && row.langNative !== null ? { name: row.langName, native: row.langNative } : null;
    const founded = await foundTeam(
      client,
      { lang: row.lang, language, team: { slug: null, name: row.teamName }, adminId: row.userId },
      actorId,
    );
    await client.query(
      `update "team_request"
          set "state" = 'approved', "approvedTeamId" = $2, "decidedAt" = now(), "decidedBy" = $3
        where "id" = $1`,
      [id, founded.teamId, actorId],
    );
    return { row, founded };
  });
  // The approval is committed; none of these throws, so none can fail the response.
  await afterFounded(founded, actorId);
  await recordActivity({
    kind: "request.approved",
    lang: null,
    actorId,
    subject: id,
    detail: { requestId: id, lang: row.lang, slug: founded.slug, branch: founded.branch },
  });
  sendEmail(
    row.email,
    `Your team for ${nameOf(row)} is approved`,
    [
      `Your request for the team ${row.teamName} in ${nameOf(row)} was approved. You are its admin.`,
      "",
      `Start here: ${SITE}/admin?lang=${row.lang}`,
    ].join("\n"),
  );
  return withBranch((await read(id))!);
}

export async function rejectRequest(id: string, actorId: string, reason: string | null): Promise<TeamRequest> {
  const row = await inTransaction(async (client) => {
    const locked = await lockPending(client, id);
    await client.query(
      `update "team_request" set "state" = 'rejected', "reason" = $2, "decidedAt" = now(), "decidedBy" = $3 where "id" = $1`,
      [id, reason, actorId],
    );
    return locked;
  });
  await recordActivity({
    kind: "request.rejected",
    lang: null,
    actorId,
    subject: id,
    detail: { requestId: id, lang: row.lang, ...(reason ? { reason } : {}) },
  });
  sendEmail(
    row.email,
    `Your team request for ${nameOf(row)}`,
    [
      `Your request for the team ${row.teamName} in ${nameOf(row)} was not approved.`,
      ...(reason ? ["", `Reason: ${reason}`] : []),
      "",
      `Your requests: ${SITE}/request-team`,
    ].join("\n"),
  );
  return withBranch((await read(id))!);
}
