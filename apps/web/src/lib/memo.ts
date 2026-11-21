import type { Lang } from "@/lib/lang";
import { scopeKey } from "@/lib/teams/store";

/**
 * A value per language, kept on globalThis and rebuilt when its version moves.
 *
 * On globalThis because `next dev` re-evaluates modules and each evaluation would otherwise
 * start empty; per language because a site switching between two would rebuild on every
 * other request if there were one slot. `version` is compared with ===: a stamp string, or
 * the identity of the array a derived index was built from.
 *
 * A build that returns a promise is cached as the promise, so concurrent callers share one
 * build -- and dropped again if it rejects. Otherwise one timeout would be the answer for
 * that language until the tables next moved.
 */
export function memoByLang<T>(key: symbol, lang: string, version: unknown, build: () => T): T {
  const holder = globalThis as unknown as Record<symbol, Map<string, { version: unknown; value: T }>>;
  const memo = (holder[key] ??= new Map());
  const existing = memo.get(lang);
  if (existing && existing.version === version) return existing.value;
  const value = build();
  memo.set(lang, { version, value });
  if (value instanceof Promise) {
    value.catch(() => {
      if (memo.get(lang)?.value === value) memo.delete(lang);
    });
  }
  return value;
}

/** memoByLang for per-team data: one slot per team of `lang`, the acting one's, as scopeKey keeps them. */
export async function memoByTeamLang<T>(
  key: symbol,
  lang: Lang,
  version: unknown,
  build: () => T | Promise<T>,
): Promise<T> {
  return memoByLang(key, await scopeKey(lang), version, build);
}
