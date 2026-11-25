/** The token's shape, apart from store.ts because the browser draws it and store.ts is server-only. */
import type { Lang } from "@/lib/lang";

export type TokenAccess = "none" | "read" | "write";

export type ApiToken = {
  id: string;
  userId: string;
  /** Null on a token that only submits community packs, which no language grant backs. */
  lang: Lang | null;
  access: TokenAccess;
  generate: boolean;
  packs: boolean;
  label: string;
  hint: string;
  createdAt: string;
  expiresAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
};

/** Any member may submit a pack, so only text access and generation tie a token to a language. */
export function needsLang(token: Pick<ApiToken, "access" | "generate">): boolean {
  return token.access !== "none" || token.generate;
}

/** The token's text access as the profile shows it. */
export function accessLabel(token: Pick<ApiToken, "access">): string {
  return token.access === "none" ? "no text" : token.access;
}

export function scopeLabels(
  token: Pick<ApiToken, "lang" | "access" | "generate" | "packs">,
  words: { generate: string; packs: string },
): string[] {
  return [
    ...(token.lang ? [accessLabel(token)] : []),
    ...(token.generate ? [words.generate] : []),
    ...(token.packs ? [words.packs] : []),
  ];
}
