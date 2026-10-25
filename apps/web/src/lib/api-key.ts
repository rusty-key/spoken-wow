// The stored provider keys, per user: ElevenLabs' and fish.audio's, one of each at most.
// VoiceStudio is a site-configured local/remote service and does not use this table.
//
// The plaintext exists in exactly two places: inside a request that is about to store
// it, and inside a request that is about to spend with it. It is never returned to a
// browser, never logged, and never put in a server component's props.
//
// What a page may know is the shape of it -- that a key exists, when it last worked,
// and its last four characters. That is `ApiKeyStatus`, and it is the only thing any
// route hands back.

import "server-only";

import { query } from "./db";
import { open, seal } from "./secrets";
import type { Provider } from "./generation/providers";


// A table per provider (see migration 0040 for why not one table with a column). Written
// out rather than interpolated from the argument, so no caller can name a table.
type StoredProvider = Exclude<Provider, "voicestudio">;

const TABLE: Record<StoredProvider, string> = {
  elevenlabs: `"elevenlabs_key"`,
  fish: `"fish_key"`,
};

export function voiceStudioConfigured(): boolean {
  return Boolean(process.env.VOICESTUDIO_BASE_URL);
}

export function voiceStudioApiKey(): string {
  return process.env.OMNIVOICE_API_KEY ?? "";
}

export type ApiKeyStatus = {
  /** The last four characters, for "sk_…••••1a2b". Proves a key is set; authenticates nothing. */
  hint: string;
  /** When the provider last confirmed it, which is when it was saved. */
  verifiedAt: string | null;
  /** The plan the key answered with, e.g. "creator". Null for fish.audio and VoiceStudio. */
  tier: string | null;
};

type Row = {
  ciphertext: string;
  iv: string;
  tag: string;
  hint: string;
  verifiedAt: Date | null;
  tier: string | null;
};

function hintFor(key: string): string {
  return key.slice(-4);
}

export async function apiKeyStatus(
  userId: string,
  provider: Provider = "elevenlabs",
): Promise<ApiKeyStatus | null> {
  if (provider === "voicestudio") {
    return voiceStudioConfigured()
      ? { hint: "local", verifiedAt: null, tier: null }
      : null;
  }
  const rows = await query<{ hint: string; verifiedAt: Date | null; tier: string | null }>(
    `select "hint", "verifiedAt", "tier" from ${TABLE[provider]} where "userId" = $1`,
    [userId],
  );
  const row = rows[0];
  if (!row) return null;

  return {
    hint: row.hint,
    verifiedAt: row.verifiedAt ? row.verifiedAt.toISOString() : null,
    tier: row.tier,
  };
}

/**
 * The user's key, in the clear, or null if they have none.
 *
 * Throws rather than returning null when a row exists but cannot be opened: that means
 * SPOKEN_SECRET_KEY has changed under a stored credential, and treating it as "no key
 * set" would hide a deployment mistake behind a message about setting up a profile.
 */
export async function readApiKey(
  userId: string,
  provider: Provider = "elevenlabs",
): Promise<string | null> {
  if (provider === "voicestudio") {
    return voiceStudioConfigured() ? voiceStudioApiKey() : null;
  }
  const rows = await query<Row>(
    `select "ciphertext", "iv", "tag", "hint", "verifiedAt", "tier"
       from ${TABLE[provider]} where "userId" = $1`,
    [userId],
  );
  const row = rows[0];
  if (!row) return null;

  return open(row);
}

export async function storeApiKey(
  userId: string,
  key: string,
  tier: string | null,
  provider: Provider = "elevenlabs",
): Promise<ApiKeyStatus> {
  if (provider === "voicestudio") {
    throw new Error("VoiceStudio is configured by the site, not by a stored user key");
  }
  const sealed = seal(key);

  // Upsert rather than delete-then-insert: replacing a key is one statement, and a
  // failure halfway through must not leave an editor with no key at all.
  await query(
    `insert into ${TABLE[provider]}
       ("userId", "ciphertext", "iv", "tag", "hint", "verifiedAt", "tier", "updatedAt")
     values ($1, $2, $3, $4, $5, now(), $6, now())
     on conflict ("userId") do update set
       "ciphertext" = excluded."ciphertext",
       "iv" = excluded."iv",
       "tag" = excluded."tag",
       "hint" = excluded."hint",
       "verifiedAt" = excluded."verifiedAt",
       "tier" = excluded."tier",
       "updatedAt" = now()`,
    [userId, sealed.ciphertext, sealed.iv, sealed.tag, hintFor(key), tier],
  );

  return (await apiKeyStatus(userId, provider))!;
}

export async function deleteApiKey(
  userId: string,
  provider: Provider = "elevenlabs",
): Promise<void> {
  if (provider === "voicestudio") {
    throw new Error("VoiceStudio is configured by the site, not by a stored user key");
  }
  await query(`delete from ${TABLE[provider]} where "userId" = $1`, [userId]);
}

/** Which accounts have a key, for the admin Users table. Presence only. */
export async function userIdsWithApiKey(): Promise<string[]> {
  const rows = await query<{ userId: string }>(`select "userId" from "elevenlabs_key"`);
  return rows.map((row) => row.userId);
}
