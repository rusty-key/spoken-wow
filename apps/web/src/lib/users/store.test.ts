/**
 * The Users page's search, against the real database: name or email, any case, and what is
 * typed matched literally rather than as a LIKE pattern.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { closeDb, db } = await import("@/lib/db");
const { listUsers } = await import("./store");
const { DEFAULT_USER_SORT } = await import("./sort");

const PREFIX = "test-user-search";
const USERS = [
  { id: `${PREFIX}-1`, name: "Thrall Goel", email: `${PREFIX}-orgrim@example.invalid` },
  { id: `${PREFIX}-2`, name: "Jaina", email: `${PREFIX}-100%_proud@example.invalid` },
];

beforeAll(async () => {
  for (const user of USERS) {
    await db().query(
      `insert into "user" ("id", "name", "email", "emailVerified")
       values ($1, $2, $3, false)
       on conflict ("id") do nothing`,
      [user.id, user.name, user.email],
    );
  }
});

afterAll(async () => {
  await db().query(`delete from "user" where "id" like $1`, [`${PREFIX}-%`]);
  await closeDb();
});

const ids = async (q: string, sort = DEFAULT_USER_SORT) =>
  (await listUsers({ q, sort, limit: 100, offset: 0 })).users.map((user) => user.id);

describe("listUsers", () => {
  it("matches part of a name in any case", async () => {
    expect(await ids("thrall")).toContain(`${PREFIX}-1`);
  });

  it("matches part of an email", async () => {
    expect(await ids(`${PREFIX}-orgrim`)).toEqual([`${PREFIX}-1`]);
  });

  it("takes % and _ literally", async () => {
    expect(await ids(`${PREFIX}-100%_`)).toEqual([`${PREFIX}-2`]);
    expect(await ids(`${PREFIX}-%`)).toEqual([]);
  });

  it("sorts on a column either way", async () => {
    expect(await ids(PREFIX, { column: "name", direction: "asc" })).toEqual([`${PREFIX}-2`, `${PREFIX}-1`]);
    expect(await ids(PREFIX, { column: "name", direction: "desc" })).toEqual([`${PREFIX}-1`, `${PREFIX}-2`]);
  });

  it("counts a team capability as a grant when sorting by language", async () => {
    await db().query(
      `insert into "team_member" ("teamId", "userId", "lang", "capability")
       values (team_of_lang('deDE'), $1, 'deDE', 'regenerate')`,
      [`${PREFIX}-2`],
    );
    expect(await ids(PREFIX, { column: "languages", direction: "asc" })).toEqual([`${PREFIX}-2`, `${PREFIX}-1`]);
    await db().query(`delete from "team_member" where "userId" = $1`, [`${PREFIX}-2`]);
  });

  it("puts somebody with grants before somebody with none, by language", async () => {
    await db().query(
      `insert into "language_grant" ("userId", "lang", "capability") values ($1, 'deDE', 'edit')`,
      [`${PREFIX}-2`],
    );
    expect(await ids(PREFIX, { column: "languages", direction: "asc" })).toEqual([`${PREFIX}-2`, `${PREFIX}-1`]);
    expect(await ids(PREFIX, { column: "languages", direction: "desc" })).toEqual([`${PREFIX}-2`, `${PREFIX}-1`]);
  });

  it("counts every match, not just the page", async () => {
    const { users, total } = await listUsers({ q: PREFIX, sort: DEFAULT_USER_SORT, limit: 1, offset: 0 });
    expect(users).toHaveLength(1);
    expect(total).toBe(2);
  });
});
