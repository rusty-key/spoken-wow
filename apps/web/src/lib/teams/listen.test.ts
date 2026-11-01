/** Needs DATABASE_URL and migrations applied. */
import { afterAll, describe, expect, it } from "vitest";

import { asSystem } from "@/lib/teams/testing";

import { listenForTeamChanges, stopListening } from "./listen";
import { teamLangs } from "./store";

afterAll(stopListening);

describe("listenForTeamChanges", () => {
  it("forgets the memo when another connection moves a language", async () => {
    listenForTeamChanges();
    const before = await teamLangs();
    expect(await teamLangs()).toBe(before);

    // The listener connects asynchronously, so notify until it has heard one.
    const deadline = Date.now() + 1_000;
    let after = before;
    while (after === before && Date.now() < deadline) {
      await asSystem.query(`select pg_notify('spoken_team_language', 'deDE')`);
      await new Promise((resolve) => setTimeout(resolve, 50));
      after = await teamLangs();
    }
    expect(after).not.toBe(before);
  });
});
