import { afterEach, describe, expect, it, vi } from "vitest";

import { seal, SealError, unseal } from "./seal";

const KEY = Buffer.alloc(32, 7).toString("base64");

afterEach(() => vi.unstubAllEnvs());

describe("sealing a storage secret", () => {
  it("opens what it sealed, for the same backend only", () => {
    vi.stubEnv("SPOKEN_STORAGE_KEY", KEY);
    const sealed = seal("s3cret", "backend-a");
    expect(sealed).not.toContain("s3cret");
    expect(unseal(sealed, "backend-a")).toBe("s3cret");
    expect(() => unseal(sealed, "backend-b")).toThrow("does not open");
  });

  it("refuses without a key, and with one of the wrong size", () => {
    vi.stubEnv("SPOKEN_STORAGE_KEY", "");
    expect(() => seal("s3cret", "a")).toThrow("SPOKEN_STORAGE_KEY is not set");
    vi.stubEnv("SPOKEN_STORAGE_KEY", Buffer.alloc(16).toString("base64"));
    expect(() => seal("s3cret", "a")).toThrow("32 bytes");
  });

  it("refuses a shortened tag", () => {
    vi.stubEnv("SPOKEN_STORAGE_KEY", KEY);
    const [version, iv, tag, body] = seal("s3cret", "a").split(":");
    const short = Buffer.from(tag, "base64").subarray(0, 4).toString("base64");
    expect(() => unseal([version, iv, short, body].join(":"), "a")).toThrow(SealError);
  });

  it("does not open under another key", () => {
    vi.stubEnv("SPOKEN_STORAGE_KEY", KEY);
    const sealed = seal("s3cret", "a");
    vi.stubEnv("SPOKEN_STORAGE_KEY", Buffer.alloc(32, 9).toString("base64"));
    expect(() => unseal(sealed, "a")).toThrow("does not open");
  });
});
