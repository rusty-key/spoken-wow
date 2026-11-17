/**
 * A team's storage secret at rest: AES-256-GCM under SPOKEN_STORAGE_KEY, bound to the backend's
 * id so a sealed secret copied onto another row does not open.
 *
 * The key is 32 random bytes in base64 (`openssl rand -base64 32`), in app.env: only the site
 * opens a team's bucket, and builds reach it through /api/archive/. Losing it loses every team's
 * secret, not their objects: each team enters its key again.
 */
import "server-only";

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const VERSION = "v1";

export class SealError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SealError";
  }
}

function sealingKey(): Buffer {
  const raw = process.env.SPOKEN_STORAGE_KEY;
  if (!raw) throw new SealError("SPOKEN_STORAGE_KEY is not set, so a team's storage secret cannot be sealed or opened");
  const key = Buffer.from(raw, "base64");
  if (key.byteLength !== 32) throw new SealError("SPOKEN_STORAGE_KEY must be 32 bytes in base64 (openssl rand -base64 32)");
  return key;
}

export function seal(secret: string, boundTo: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", sealingKey(), iv);
  cipher.setAAD(Buffer.from(boundTo));
  const body = Buffer.concat([cipher.update(secret, "utf8"), cipher.final()]);
  return [VERSION, iv, cipher.getAuthTag(), body].map((part) => (typeof part === "string" ? part : part.toString("base64"))).join(":");
}

export function unseal(sealed: string, boundTo: string): string {
  const [version, iv, tag, body] = sealed.split(":");
  if (version !== VERSION || !iv || !tag || body === undefined) throw new SealError("not a sealed secret");
  const decipher = createDecipheriv("aes-256-gcm", sealingKey(), Buffer.from(iv, "base64"));
  decipher.setAAD(Buffer.from(boundTo));
  decipher.setAuthTag(Buffer.from(tag, "base64"));
  try {
    return Buffer.concat([decipher.update(Buffer.from(body, "base64")), decipher.final()]).toString("utf8");
  } catch {
    throw new SealError("the secret does not open with this SPOKEN_STORAGE_KEY");
  }
}
