/** Needs DATABASE_URL and migrations applied. */
import { randomBytes } from "node:crypto";

import { afterAll, afterEach, describe, expect, it } from "vitest";

import { closeDb } from "@/lib/db";
import { systemRows } from "@/lib/teams/testing";

import { checkObjects } from "./checks";
import { placeObject, testBackend } from "./testing";

const restores: (() => unknown)[] = [];
afterEach(async () => {
  for (const restore of restores.splice(0).reverse()) await restore();
});
afterAll(closeDb);

const missingOf = async (sha256: string) =>
  (await systemRows<{ missing: boolean }>(`select "missingAt" is not null as "missing" from "archive_object" where "sha256" = $1`, [sha256]))[0].missing;

describe("checkObjects", () => {
  it("marks an object a team deleted, and unmarks one restored", async () => {
    const backend = await testBackend();
    restores.push(backend.restore);
    const kept = randomBytes(32).toString("hex");
    const deleted = randomBytes(32).toString("hex");
    const restored = randomBytes(32).toString("hex");
    backend.store.objects.set(`takes/${kept}`, { data: Buffer.from("a"), contentType: "audio/mpeg" });
    backend.store.objects.set(`takes/${restored}`, { data: Buffer.from("b"), contentType: "audio/mpeg" });
    await placeObject(`takes/${kept}`, backend.id);
    await placeObject(`takes/${deleted}`, backend.id);
    await placeObject(`takes/${restored}`, backend.id, { missing: true });

    await checkObjects(1000);
    expect(await missingOf(kept)).toBe(false);
    expect(await missingOf(deleted)).toBe(true);
    expect(await missingOf(restored)).toBe(false);
  });
});
