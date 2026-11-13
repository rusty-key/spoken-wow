import { afterEach, describe, expect, it } from "vitest";

import { asSystem, testUser } from "./testing";

const LANG = "xqRQ";
const created: { id: string; cleanup: () => Promise<void> }[] = [];

async function user(): Promise<string> {
  const u = await testUser();
  created.push(u);
  return u.id;
}

function request(userId: string, lang: string, extra: { langName?: string | null; langNative?: string | null } = {}) {
  return asSystem.query(
    `insert into "team_request" ("userId", "lang", "langName", "langNative", "teamName") values ($1, $2, $3, $4, 'Team')`,
    [userId, lang, extra.langName ?? null, extra.langNative ?? null],
  );
}

afterEach(async () => {
  for (const u of created) await u.cleanup(); // cascades the requests
  created.length = 0;
});

describe("team_request", () => {
  it("allows one pending request per user and language", async () => {
    const u = await user();
    await request(u, LANG);
    await expect(request(u, LANG)).rejects.toMatchObject({ code: "23505" });
    await asSystem.query(`update "team_request" set "state" = 'withdrawn' where "userId" = $1`, [u]);
    await request(u, LANG);
  });

  it("refuses enUS and a half-named language", async () => {
    const u = await user();
    await expect(request(u, "enUS")).rejects.toMatchObject({ code: "23514" });
    await expect(request(u, LANG, { langName: "Xq" })).rejects.toMatchObject({ code: "23514" });
  });

  it("starts a language with textByTeam off", async () => {
    const { rows } = await asSystem.query(`select "textByTeam" from "language" where "code" = 'deDE'`);
    expect(rows[0].textByTeam).toBe(false);
  });
});
