/** The token's shape, apart from store.ts because the browser draws it and store.ts is server-only. */
import type { Lang } from "@/lib/lang";

export type TokenAccess = "none" | "read" | "write";

export type ApiToken = {
  id: string;
  userId: string;
  lang: Lang;
  access: TokenAccess;
  generate: boolean;
  label: string;
  hint: string;
  createdAt: string;
  expiresAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
};

/** The token's text access as the profile shows it. */
export function accessLabel(token: Pick<ApiToken, "access">): string {
  return token.access === "none" ? "no text" : token.access;
}
