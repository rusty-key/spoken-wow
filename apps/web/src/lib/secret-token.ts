/** A secret handed out once and kept only as its hash: invite links and API tokens. */
import "server-only";

import { createHash, randomBytes } from "node:crypto";

/** 32 random bytes, base64url. */
export function mintSecret(): string {
  return randomBytes(32).toString("base64url");
}

/** What is stored and looked up instead of the secret: its SHA-256, hex. */
export function hashSecret(secret: string): string {
  return createHash("sha256").update(secret).digest("hex");
}
