/**
 * API tokens against a real Postgres, because what keeps a token unrecoverable and dead on time
 * is the row and the query.
 *
 * Needs DATABASE_URL and migrations applied.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { closeDb } from "@/lib/db";
import { asSystem } from "@/lib/teams/testing";

import { createToken, findLiveToken, listAllTokens, listTokens, revokeToken } from "./store";

const USER = `test-token-${Math.random().toString(36).slice(2, 10)}`;
const OTHER = `${USER}-other`;
const TOMORROW = () => new Date(Date.now() + 86_400_000);

function make(userId = USER, expiresAt = TOMORROW()) {
  return createToken({ userId, lang: "deDE", access: "write", generate: false, label: "agent", expiresAt });
}

beforeAll(async () => {
  for (const id of [USER, OTHER]) {
    await asSystem.query(
      `insert into "user" ("id", "name", "email", "emailVerified") values ($1, 'Test Token', $2, false)`,
      [id, `${id}@example.invalid`],
    );
  }
});

afterAll(async () => {
  await asSystem.query(`delete from "user" where "id" = any($1)`, [[USER, OTHER]]);
  await closeDb();
});

describe("createToken", () => {
  it("stores only a hash and returns the token once", async () => {
    const { token, row } = await make();
    expect(token.startsWith("spk_")).toBe(true);
    expect(row.hint).toBe(token.slice(-4));
    expect(row).not.toHaveProperty("tokenHash");

    const { rows } = await asSystem.query(`select * from "api_token" where "id" = $1`, [row.id]);
    expect(JSON.stringify(rows[0])).not.toContain(token);
    expect((await listTokens(USER)).find((t) => t.id === row.id)).not.toHaveProperty("tokenHash");
  });

  it("carries a generate-only token through create and find", async () => {
    const { token, row } = await createToken({
      userId: USER,
      lang: "deDE",
      access: "none",
      generate: true,
      label: "generator",
      expiresAt: TOMORROW(),
    });
    expect(row).toMatchObject({ access: "none", generate: true });
    expect(await findLiveToken(token)).toMatchObject({ id: row.id, access: "none", generate: true });
  });

  it("gives a read token generate false", async () => {
    const { row } = await createToken({
      userId: USER,
      lang: "deDE",
      access: "read",
      generate: false,
      label: "reader",
      expiresAt: TOMORROW(),
    });
    expect(row.generate).toBe(false);
  });

  it("refuses a token with no scope at all", async () => {
    await expect(
      asSystem.query(
        `insert into "api_token" ("userId", "lang", "access", "label", "tokenHash", "hint", "expiresAt")
         values ($1, 'deDE', 'none', 'x', $2, 'abcd', now() + interval '1 day')`,
        [USER, `hash-${Math.random()}`],
      ),
    ).rejects.toThrow(/api_token_has_scope|check constraint/);
  });

  it("reads back generate false for a row inserted without the column", async () => {
    const hash = `hash-${Math.random()}`;
    const { rows } = await asSystem.query(
      `insert into "api_token" ("userId", "lang", "access", "label", "tokenHash", "hint", "expiresAt")
       values ($1, 'deDE', 'read', 'old', $2, 'abcd', now() + interval '1 day') returning "generate"`,
      [USER, hash],
    );
    expect(rows[0].generate).toBe(false);
  });

  it("refuses an expiry in the past", async () => {
    await expect(make(USER, new Date(Date.now() - 1000))).rejects.toThrow(/expiry/);
  });
});

describe("findLiveToken", () => {
  it("finds a live token and returns its owner's role", async () => {
    await asSystem.query(`update "user" set "role" = 'admin' where "id" = $1`, [OTHER]);
    const { token, row } = await make(OTHER);
    expect(await findLiveToken(token)).toMatchObject({ id: row.id, userId: OTHER, lang: "deDE", role: "admin" });
    await asSystem.query(`update "user" set "role" = null where "id" = $1`, [OTHER]);
  });

  it("does not find an unknown token", async () => {
    expect(await findLiveToken("spk_nothing")).toBeNull();
  });

  it("does not find an expired token", async () => {
    const { token, row } = await make();
    await asSystem.query(`update "api_token" set "expiresAt" = now() - interval '1 second' where "id" = $1`, [row.id]);
    expect(await findLiveToken(token)).toBeNull();
  });

  it("does not find a revoked token", async () => {
    const { token, row } = await make();
    await revokeToken(row.id, USER);
    expect(await findLiveToken(token)).toBeNull();
  });

  it("does not find a banned owner's token until the ban expires", async () => {
    const { token } = await make(OTHER);
    await asSystem.query(`update "user" set "banned" = true, "banExpires" = null where "id" = $1`, [OTHER]);
    expect(await findLiveToken(token)).toBeNull();
    await asSystem.query(`update "user" set "banExpires" = now() + interval '1 hour' where "id" = $1`, [OTHER]);
    expect(await findLiveToken(token)).toBeNull();
    await asSystem.query(`update "user" set "banExpires" = now() - interval '1 hour' where "id" = $1`, [OTHER]);
    expect(await findLiveToken(token)).not.toBeNull();
    await asSystem.query(`update "user" set "banned" = null, "banExpires" = null where "id" = $1`, [OTHER]);
  });

  it("touches lastUsedAt at most once a minute", async () => {
    const { token, row } = await make();
    await findLiveToken(token);
    const lastUsed = async () =>
      (await asSystem.query(`select "lastUsedAt" from "api_token" where "id" = $1`, [row.id])).rows[0].lastUsedAt;
    const first = await lastUsed();
    expect(first).not.toBeNull();

    await findLiveToken(token);
    expect(await lastUsed()).toEqual(first);

    await asSystem.query(`update "api_token" set "lastUsedAt" = now() - interval '2 minutes' where "id" = $1`, [row.id]);
    const stale = await lastUsed();
    await findLiveToken(token);
    expect(await lastUsed()).not.toEqual(stale);
  });
});

describe("revokeToken", () => {
  it("revokes only the owner's token", async () => {
    const { row } = await make();
    expect(await revokeToken(row.id, OTHER)).toBe(false);
    expect(await revokeToken(row.id, USER)).toBe(true);
  });

  it("revokes anyone's when no owner is named", async () => {
    const { row } = await make();
    expect(await revokeToken(row.id, null)).toBe(true);
    expect((await listAllTokens()).find((t) => t.id === row.id)).toMatchObject({
      userEmail: `${USER}@example.invalid`,
    });
  });

  it("does not revoke twice", async () => {
    const { row } = await make();
    await revokeToken(row.id, USER);
    expect(await revokeToken(row.id, USER)).toBe(false);
  });
});
