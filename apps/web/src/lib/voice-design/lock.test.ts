import { afterAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { closeDb } = await import("@/lib/db");
const { withDesignLock } = await import("./lock");

afterAll(() => closeDb());

describe("withDesignLock", () => {
  it("refuses a second action on the same version while the first runs", async () => {
    let release!: () => void;
    const first = withDesignLock("d-lock-test", () => new Promise<string>((resolve) => (release = () => resolve("first"))));
    await new Promise((r) => setTimeout(r, 50));
    await expect(withDesignLock("d-lock-test", async () => "second")).rejects.toThrow(/already working/);
    expect(await withDesignLock("d-lock-other", async () => "other")).toBe("other");
    release();
    expect(await first).toBe("first");
    expect(await withDesignLock("d-lock-test", async () => "again")).toBe("again");
  });
});
