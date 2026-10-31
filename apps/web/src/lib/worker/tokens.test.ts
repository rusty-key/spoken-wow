import { createHash, randomUUID } from "node:crypto";

import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";

import { closeDb, db } from "@/lib/db";

import { revokeCallingToken, workerUser } from "./tokens";

let owner: string;
const token = `spw_${"a".repeat(20)}${Math.random().toString(36).slice(2, 10)}`;
const call = (header?: string) => new Request("https://site.test/api/worker/unpair", { method: "POST", headers: header ? { authorization: header } : {} });

beforeEach(async () => {
  owner = `test-unpair-${Math.random().toString(36).slice(2, 10)}`;
  await db().query(`insert into "user" ("id", "name", "email", "emailVerified") values ($1, $1, $2, false)`, [
    owner,
    `${owner}@example.invalid`,
  ]);
  await db().query(`insert into "worker_token" ("id", "userId", "tokenHash", "label") values ($1, $2, $3, 'test')`, [
    randomUUID(),
    owner,
    createHash("sha256").update(token).digest("hex"),
  ]);
});

afterEach(async () => {
  await db().query(`delete from "user" where "id" = $1`, [owner]);
});

afterAll(async () => {
  await closeDb();
});

describe("a Manager unpairing itself", () => {
  it("revokes its own token, once", async () => {
    expect(await workerUser(call(`Bearer ${token}`))).toBe(owner);
    expect(await revokeCallingToken(call("Bearer spw_someone-elses-token-entirely"))).toBe(false);
    expect(await revokeCallingToken(call(`Bearer ${token}`))).toBe(true);
    expect(await workerUser(call(`Bearer ${token}`))).toBeNull();
    expect(await revokeCallingToken(call(`Bearer ${token}`))).toBe(false);
    expect(await revokeCallingToken(call())).toBe(false);
  });
});
