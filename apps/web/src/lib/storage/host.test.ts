import { afterEach, describe, expect, it, vi } from "vitest";

import { assertPublicHost } from "./host";

afterEach(() => vi.unstubAllEnvs());

const resolving = (address: string) => (async () => [{ address, family: address.includes(":") ? 6 : 4 }]) as never;

describe("assertPublicHost", () => {
  it.each(["https://127.0.0.1", "https://10.2.3.4", "https://169.254.169.254", "https://[::1]", "https://localhost", "https://[::ffff:192.168.1.1]"])(
    "refuses %s",
    async (url) => {
      await expect(assertPublicHost(url)).rejects.toThrow("private or local");
    },
  );

  it("refuses a name that resolves to a private address", async () => {
    await expect(assertPublicHost("https://bucket.example.org", resolving("192.168.0.9"))).rejects.toThrow("private or local");
  });

  it("allows a public one", async () => {
    await expect(assertPublicHost("https://bucket.example.org", resolving("104.18.2.3"))).resolves.toBeUndefined();
  });

  it("allows anything when a developer runs MinIO locally", async () => {
    vi.stubEnv("SPOKEN_STORAGE_ALLOW_PRIVATE", "1");
    await expect(assertPublicHost("https://127.0.0.1")).resolves.toBeUndefined();
  });
});
