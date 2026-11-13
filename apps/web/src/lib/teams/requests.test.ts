/** Needs DATABASE_URL and migrations through 0108 applied. Only the email is mocked. */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const sent = vi.hoisted(() => [] as { to: string; subject: string; text: string }[]);
vi.mock("@/lib/email", () => ({
  sendEmail: (to: string, subject: string, text: string) => void sent.push({ to, subject, text }),
}));

import { listActivity } from "@/lib/activity/store";
import { closeDb } from "@/lib/db";
import { grantsOf } from "@/lib/grants/store";
import { isLang } from "@/lib/lang";
import { forgetLanguages, loadLanguages } from "@/lib/languages/catalogue";

import { TeamError } from "./admin";
import { approveRequest, createRequest, listRequests, rejectRequest, withdrawRequest } from "./requests";
import { forgetTeams } from "./store";
import { asSystem, dropTeam, systemRows, testUser } from "./testing";

let requester: Awaited<ReturnType<typeof testUser>>;
let admin: Awaited<ReturnType<typeof testUser>>;
let other: Awaited<ReturnType<typeof testUser>>;
let codes: string[];

function code(): string {
  const capital = () => String.fromCharCode(65 + Math.floor(Math.random() * 26));
  let made: string;
  do made = `xq${capital()}${capital()}`;
  while (codes.includes(made));
  codes.push(made);
  return made;
}

const names = { name: "Xq Test", native: "Xq Tést" };
const ask = (lang: string, over: Partial<Parameters<typeof createRequest>[1]> = {}) =>
  createRequest(requester.id, { lang, language: names, teamName: "Xq Team", note: null, ...over });
const refused = (status: number, message?: string) => (error: unknown) =>
  error instanceof TeamError && error.status === status && (!message || error.message.includes(message));
const mailTo = (user: { id: string }) => sent.filter((mail) => mail.to === `${user.id}@example.invalid`);

beforeEach(async () => {
  codes = [];
  sent.length = 0;
  requester = await testUser("test-req-user");
  admin = await testUser("test-req-admin");
  other = await testUser("test-req-other");
  await asSystem.query(`update "user" set "role" = 'admin' where "id" = $1`, [admin.id]);
  forgetTeams();
});

afterEach(async () => {
  const held = await systemRows<{ teamId: string }>(
    `select "teamId" from "team_language" where "lang" = any($1::text[])`,
    [codes],
  );
  const users = [requester.id, admin.id, other.id];
  await asSystem.query(`delete from "activity" where "actorId" = any($1::text[]) or "lang" = any($2::text[])`, [users, codes]);
  await asSystem.query(`delete from "team_request" where "userId" = any($1::text[])`, [users]);
  await asSystem.query(`delete from "language_grant" where "lang" = any($1::text[])`, [codes]);
  await asSystem.query(`delete from "language" where "code" = any($1::text[])`, [codes]);
  for (const { teamId } of held) await dropTeam(teamId);
  for (const user of [requester, admin, other]) await user.cleanup();
  forgetLanguages();
  await loadLanguages();
  forgetTeams();
});

afterAll(closeDb);

describe("createRequest", () => {
  it("keeps a new code's request out of the world until it is approved", async () => {
    const lang = code();
    const request = await ask(lang, { note: "Hello" });
    expect(request).toMatchObject({ state: "pending", branch: "new-language", lang, teamName: "Xq Team", note: "Hello" });
    expect(request.langName).toBe("Xq Test");
    expect(await systemRows(`select 1 from "language" where "code" = $1`, [lang])).toHaveLength(0);
    expect(await systemRows(`select 1 from "team_language" where "lang" = $1`, [lang])).toHaveLength(0);
    await loadLanguages();
    expect(isLang(lang)).toBe(false);
    expect(await grantsOf(requester.id)).toEqual([]);
    const { rows } = await listActivity({ lang: "deDE", global: false });
    expect(rows.some((row) => row.kind.startsWith("request."))).toBe(false);
    const { rows: all } = await listActivity({ lang: "deDE", global: true, actorId: requester.id });
    expect(all.some((row) => row.kind === "request.made" && row.subject === request.id)).toBe(true);
    const admins = await systemRows<{ email: string }>(`select "email" from "user" where "role" = 'admin'`);
    for (const { email } of admins) {
      expect(sent.filter((mail) => mail.to === email && mail.subject.startsWith("Team request: Xq Team"))).toHaveLength(1);
    }
  });

  it("stores no names for a known code", async () => {
    const request = await createRequest(requester.id, { lang: "deDE", language: null, teamName: "Deutsch", note: null });
    expect(request.langName).toBeNull();
    expect(request.branch).not.toBe("new-language");
  });

  it("refuses a second pending request, and takes one after a withdrawal", async () => {
    const lang = code();
    const first = await ask(lang);
    await expect(ask(lang)).rejects.toSatisfy(refused(409, "already asked"));
    await expect(withdrawRequest(first.id, other.id)).rejects.toSatisfy(refused(404));
    await expect(withdrawRequest("00000000-0000-4000-8000-000000000000", requester.id)).rejects.toSatisfy(refused(404));
    const withdrawn = await withdrawRequest(first.id, requester.id);
    expect(withdrawn).toMatchObject({ state: "withdrawn", branch: null });
    await expect(ask(lang)).resolves.toMatchObject({ state: "pending" });
  });

  it("lists newest first, filtered", async () => {
    const [a, b] = [code(), code()];
    const first = await ask(a);
    const second = await ask(b);
    await withdrawRequest(first.id, requester.id);
    const mine = await listRequests({ userId: requester.id });
    expect(mine.map((r) => r.id)).toEqual([second.id, first.id]);
    expect((await listRequests({ userId: requester.id, state: "pending" })).map((r) => r.id)).toEqual([second.id]);
  });
});

describe("approveRequest", () => {
  it("founds the language and its team for the requester", async () => {
    const lang = code();
    const request = await ask(lang);
    const approved = await approveRequest(request.id, admin.id);
    expect(approved.state).toBe("approved");
    const [{ teamId }] = await systemRows<{ teamId: string }>(`select "teamId" from "team_language" where "lang" = $1`, [lang]);
    expect(approved.approvedTeamId).toBe(teamId);
    const held = (await grantsOf(requester.id)).filter((grant) => grant.lang === lang).map((grant) => grant.capability);
    expect(held).toEqual(expect.arrayContaining(["admin", "text"]));
    const { rows } = await listActivity({ lang: "deDE", global: true, actorId: admin.id });
    expect(rows.filter((row) => row.kind === "request.approved")).toHaveLength(1);
    expect(mailTo(requester).filter((mail) => mail.subject === `Your team for Xq Test is approved`)).toHaveLength(1);
    expect(mailTo(requester)[0].text).toContain(`/admin?lang=${lang}`);
  });

  it("lets only one of two simultaneous approvals through", async () => {
    const lang = code();
    const request = await ask(lang);
    const results = await Promise.allSettled([approveRequest(request.id, admin.id), approveRequest(request.id, admin.id)]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const failed = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
    expect(failed.reason).toSatisfy(refused(409));
    expect(await systemRows(`select 1 from "team_language" where "lang" = $1`, [lang])).toHaveLength(1);
  });

  it("refuses a withdrawn request", async () => {
    const request = await ask(code());
    await withdrawRequest(request.id, requester.id);
    await expect(approveRequest(request.id, admin.id)).rejects.toSatisfy(refused(409, "already withdrawn"));
  });

  it("refuses a second team, and the request stays pending", async () => {
    const [{ team }] = await systemRows<{ team: string }>(`select team_of_lang('deDE') as "team"`);
    const holder = await testUser("test-req-holder");
    try {
      await asSystem.query(
        `insert into "team_member" ("teamId", "userId", "lang", "capability") values ($1, $2, 'deDE', 'admin') on conflict do nothing`,
        [team, holder.id],
      );
      const request = await createRequest(requester.id, { lang: "deDE", language: null, teamName: "Second", note: null });
      expect(request.branch).toBe("second-team");
      await expect(approveRequest(request.id, admin.id)).rejects.toSatisfy(refused(409, "plan 5"));
      expect((await listRequests({ userId: requester.id }))[0].state).toBe("pending");
    } finally {
      await asSystem.query(`delete from "team_member" where "userId" = $1`, [holder.id]);
      await holder.cleanup();
    }
  });
});

describe("rejectRequest", () => {
  it("stores the reason and tells the requester", async () => {
    const lang = code();
    const request = await ask(lang);
    const rejected = await rejectRequest(request.id, admin.id, "Not a language");
    expect(rejected).toMatchObject({ state: "rejected", reason: "Not a language", branch: null });
    const mail = mailTo(requester).find((m) => m.subject === "Your team request for Xq Test");
    expect(mail?.text).toContain("Not a language");
    await expect(rejectRequest(request.id, admin.id, null)).rejects.toSatisfy(refused(409));
    const { rows } = await listActivity({ lang: "deDE", global: true, actorId: admin.id });
    expect(rows.filter((row) => row.kind === "request.rejected")).toHaveLength(1);
  });
});
