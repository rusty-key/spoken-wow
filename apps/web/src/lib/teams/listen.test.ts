/** Needs DATABASE_URL and migrations applied. */
import { afterAll, describe, expect, it } from "vitest";

import { asSystem } from "@/lib/teams/testing";

import { listenForTeamChanges, stopListening } from "./listen";
import { teamLangs } from "./store";

afterAll(stopListening);

/** The memo once it is not `before`, polled for a second; `each` runs before every look. */
async function changedFrom(before: Awaited<ReturnType<typeof teamLangs>>, each = async () => {}) {
  const deadline = Date.now() + 1_000;
  let after = before;
  while (after === before && Date.now() < deadline) {
    await each();
    await new Promise((resolve) => setTimeout(resolve, 50));
    after = await teamLangs();
  }
  return after;
}

describe("listenForTeamChanges", () => {
  it("forgets the memo once it is listening, for a move made while it was not", async () => {
    const before = await teamLangs();
    listenForTeamChanges();
    expect(await changedFrom(before)).not.toBe(before);
  });

  it("forgets the memo when another connection moves a language", async () => {
    // Listening since the test above.
    const before = await teamLangs();
    expect(await teamLangs()).toBe(before);
    const after = await changedFrom(before, async () => {
      await asSystem.query(`select pg_notify('spoken_team_language', 'deDE')`);
    });
    expect(after).not.toBe(before);
  });
});
