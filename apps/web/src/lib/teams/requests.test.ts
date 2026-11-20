/** Needs DATABASE_URL and migrations through 0113 applied. Only the email is mocked; the admin lookup can be made to fail. */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const sent = vi.hoisted(() => [] as { to: string; subject: string; text: string }[]);
vi.mock("@/lib/email", () => ({
  sendEmail: (to: string, subject: string, text: string) => void sent.push({ to, subject, text }),
}));
const lookup = vi.hoisted(() => ({ fails: false }));
vi.mock("@/lib/site", async (importOriginal) => {
  const site = await importOriginal<typeof import("@/lib/site")>();
  return {
    ...site,
    adminEmails: (...args: Parameters<typeof site.adminEmails>) =>
      lookup.fails ? Promise.reject(new Error("lookup down")) : site.adminEmails(...args),
  };
});

import { listActivity } from "@/lib/activity/store";
import { closeDb, inTransaction } from "@/lib/db";
import { grantsOf } from "@/lib/grants/store";
import { isLang } from "@/lib/lang";
import { forgetLanguages, loadLanguages } from "@/lib/languages/catalogue";
import { addLanguage, describeNew } from "@/lib/languages/store";

import { TeamError } from "./admin";
import { approveRequest, createRequest, listRequests, rejectRequest, withdrawRequest } from "./requests";
import { forgetTeams } from "./store";
import { asSystem, dropTeam, systemRows, testUser } from "./testing";

let requester: Awaited<ReturnType<typeof testUser>>;
let admin: Awaited<ReturnType<typeof testUser>>;
let other: Awaited<ReturnType<typeof testUser>>;
/** Further requesters a test makes. */
let more: Awaited<ReturnType<typeof testUser>>[] = [];
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
/** A known language with a team of its own and a member there who is no site owner. */
async function maintained(): Promise<{ lang: string; a: string }> {
  const lang = code();
  await inTransaction((client) => addLanguage(client, describeNew(lang, "Xq Old", "Xq Old"), admin.id));
  forgetLanguages();
  await loadLanguages();
  const [{ a }] = await systemRows<{ a: string }>(`select team_of_lang($1) as "a"`, [lang]);
  await asSystem.query(
    `insert into "team_member" ("teamId", "userId", "lang", "capability") values ($1, $2, $3, 'regenerate')`,
    [a, other.id, lang],
  );
  return { lang, a };
}
const mailTo = (user: { id: string }) => sent.filter((mail) => mail.to === `${user.id}@example.invalid`);

beforeEach(async () => {
  codes = [];
  sent.length = 0;
  lookup.fails = false;
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
  const users = [requester.id, admin.id, other.id, ...more.map((user) => user.id)];
  await asSystem.query(`delete from "activity" where "actorId" = any($1::text[]) or "lang" = any($2::text[])`, [users, codes]);
  await asSystem.query(`delete from "team_request" where "userId" = any($1::text[])`, [users]);
  await asSystem.query(`delete from "language_grant" where "lang" = any($1::text[])`, [codes]);
  await asSystem.query(`delete from "language" where "code" = any($1::text[])`, [codes]);
  for (const table of ["generation_setting_locale", "pronunciation_lexicon_locale"]) {
    await asSystem.query(`delete from "${table}" where "teamId" = any($1::uuid[])`, [held.map((row) => row.teamId)]);
  }
  for (const { teamId } of held) await dropTeam(teamId);
  for (const user of [requester, admin, other, ...more]) await user.cleanup();
  more = [];
  forgetLanguages();
  await loadLanguages();
  forgetTeams();
});

afterAll(closeDb);

describe("createRequest", () => {
  it("returns the saved request when the admin lookup fails", async () => {
    lookup.fails = true;
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const lang = code();
      const request = await ask(lang);
      expect(request).toMatchObject({ state: "pending", lang });
      expect(await systemRows(`select 1 from "team_request" where "id" = $1`, [request.id])).toHaveLength(1);
      expect(sent).toEqual([]);
      expect(logged).toHaveBeenCalled();
    } finally {
      logged.mockRestore();
    }
  });

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

  it("refuses somebody who already works on the language", async () => {
    const { lang, a } = await maintained();
    await asSystem.query(
      `insert into "team_member" ("teamId", "userId", "lang", "capability") values ($1, $2, $3, 'regenerate')`,
      [a, requester.id, lang],
    );
    await expect(
      createRequest(requester.id, { lang, language: null, teamName: "Second", note: null }),
    ).rejects.toSatisfy(
      refused(409, `You already work on Xq Old in ${lang.toLowerCase()}; one person works in one team per language.`),
    );
    expect(await systemRows(`select 1 from "team_request" where "userId" = $1`, [requester.id])).toHaveLength(0);
  });

  it("lists newest first, filtered", async () => {
    const [a, b] = [code(), code()];
    const first = await ask(a);
    const second = await ask(b);
    await withdrawRequest(first.id, requester.id);
    const mine = await listRequests({ userId: requester.id });
    expect(mine.map((r) => r.id)).toEqual([second.id, first.id]);
    // ISO in UTC, which every browser parses; Postgres' own text form is not.
    const iso = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
    expect(mine[1].createdAt).toMatch(iso);
    expect(mine[1].decidedAt).toMatch(iso);
    expect(mine[0].decidedAt).toBeNull();
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

  it("adds a team beside a maintained language's, starting from its settings", async () => {
    const { lang } = await maintained();
    const request = await createRequest(requester.id, { lang, language: null, teamName: "Second", note: null });
    expect(request.branch).toBe("add-team");
    const approved = await approveRequest(request.id, admin.id, { settings: "copy" });
    expect(approved.state).toBe("approved");
    const [second] = await systemRows<{ teamId: string }>(
      `select "teamId" from "team_language" where "lang" = $1 and "packName" = 'slug'`,
      [lang],
    );
    expect(approved.approvedTeamId).toBe(second.teamId);
    const rows = await systemRows<{ detail: unknown }>(
      `select "detail" from "activity" where "kind" = 'request.approved' and "actorId" = $1`,
      [admin.id],
    );
    expect(rows).toEqual([{ detail: expect.objectContaining({ branch: "add-team" }) }]);
  });

  it("copies the team the approver was shown, and refuses one that no longer voices the language", async () => {
    const { lang } = await maintained();
    const asks = async (teamName: string) => {
      const user = await testUser("test-req-more");
      more.push(user);
      return createRequest(user.id, { lang, language: null, teamName, note: null });
    };
    const zed = await approveRequest((await asks("Zed")).id, admin.id, { settings: "fresh" });
    // Zed is not the first team: the plain one is.
    await approveRequest((await asks("Yon")).id, admin.id, { settings: "copy", source: zed.approvedTeamId! });
    const [{ slug: zedSlug }] = await systemRows<{ slug: string }>(`select "slug" from "team" where "id" = $1`, [
      zed.approvedTeamId,
    ]);
    expect(
      await systemRows(
        `select "detail"->>'from' as "from" from "activity" where "kind" = 'team.joined_language' and "lang" = $1 and "subject" like 'yon%'`,
        [lang],
      ),
    ).toEqual([{ from: zedSlug }]);

    const gone = await asks("Xen");
    await expect(
      approveRequest(gone.id, admin.id, { settings: "copy", source: "00000000-0000-4000-8000-000000000000" }),
    ).rejects.toSatisfy(refused(409, "no longer voices"));
    expect(await systemRows(`select "state" from "team_request" where "id" = $1`, [gone.id])).toEqual([{ state: "pending" }]);
  });

  it("refuses a requester who joined the language's team after asking, and leaves the request pending", async () => {
    const { lang, a } = await maintained();
    const request = await createRequest(requester.id, { lang, language: null, teamName: "Second", note: null });
    await asSystem.query(
      `insert into "team_member" ("teamId", "userId", "lang", "capability") values ($1, $2, $3, 'regenerate')`,
      [a, requester.id, lang],
    );
    await expect(approveRequest(request.id, admin.id)).rejects.toSatisfy(
      refused(409, `You already work on Xq Old in ${lang.toLowerCase()}; one person works in one team per language.`),
    );
    expect(await systemRows(`select "state" from "team_request" where "id" = $1`, [request.id])).toEqual([
      { state: "pending" },
    ]);
    expect(await systemRows(`select 1 from "team_language" where "lang" = $1 and "packName" = 'slug'`, [lang])).toEqual([]);
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
    expect(mail?.text).toContain("/request-team");
    await expect(rejectRequest(request.id, admin.id, null)).rejects.toSatisfy(refused(409));
    const { rows } = await listActivity({ lang: "deDE", global: true, actorId: admin.id });
    expect(rows.filter((row) => row.kind === "request.rejected")).toHaveLength(1);
  });
});
