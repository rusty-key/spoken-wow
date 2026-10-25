/**
 * The providers' keys live side by side and never in each other's table.
 *
 * Against the real database, because the table a query names is the whole of what is being
 * tested here: a fish.audio key read back as somebody's ElevenLabs key would be spent there.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { closeDb, db } = await import("@/lib/db");
const { apiKeyStatus, deleteApiKey, readApiKey, storeApiKey } = await import("./api-key");

const USER = "test-api-key-providers";

beforeAll(async () => {
  // Empty is the development key, which is what every other test that seals runs under.
  vi.stubEnv("SPOKEN_SECRET_KEY", "");
  await db().query(
    `insert into "user" ("id", "name", "email", "emailVerified")
     values ($1, 'Test Keys', $2, false)
     on conflict ("id") do nothing`,
    [USER, `${USER}@example.invalid`],
  );
});

afterAll(async () => {
  await db().query(`delete from "user" where "id" = $1`, [USER]);
  vi.unstubAllEnvs();
  await closeDb();
});

describe("a fish.audio key", () => {
  it("is stored and read apart from the ElevenLabs one", async () => {
    await storeApiKey(USER, "sk_eleven_1234", "creator");
    const status = await storeApiKey(USER, "fish_secret_9876", null, "fish");

    expect(status).toMatchObject({ hint: "9876", tier: null });
    expect(await readApiKey(USER, "fish")).toBe("fish_secret_9876");
    expect(await readApiKey(USER)).toBe("sk_eleven_1234");
    expect(await apiKeyStatus(USER)).toMatchObject({ hint: "1234", tier: "creator" });
  });

  it("is removed without touching the other", async () => {
    await deleteApiKey(USER, "fish");
    expect(await readApiKey(USER, "fish")).toBeNull();
    expect(await readApiKey(USER)).toBe("sk_eleven_1234");
  });
});

describe("a VoiceStudio connection", () => {
  it("is stored in its own table and shows its host, not its key", async () => {
    const connection = JSON.stringify({
      baseUrl: "https://voice.example.com/studio",
      apiKey: "vs_secret_5555",
      model: "omnivoice",
      maxConcurrency: 2,
    });
    const status = await storeApiKey(USER, connection, null, "voicestudio");

    expect(status).toMatchObject({ hint: "voice.example.com", tier: null });
    expect(await readApiKey(USER, "voicestudio")).toBe(connection);
    expect(await readApiKey(USER)).toBe("sk_eleven_1234");

    await deleteApiKey(USER, "voicestudio");
    expect(await readApiKey(USER, "voicestudio")).toBeNull();
  });
});
