/**
 * Every language the `language` table describes, put into lib/lang.ts's registry so the
 * synchronous isLang and langName know a language created at runtime.
 *
 * Memoised for a minute like teamLangs (lib/teams/store.ts). The listener (lib/teams/listen.ts)
 * reloads it on a `spoken_language` notification and on every (re)connect, so the other pm2
 * worker learns of a new language at once; the TTL backstops a lost notification.
 */
import "server-only";

import { query } from "@/lib/db";
import { type LanguageInfo, registerLanguages } from "@/lib/lang";
import { listenInServer } from "@/lib/teams/listen";

const TTL_MS = 60_000;

type Memo = { at: number; langs: Promise<LanguageInfo[]> };

/** On globalThis for the reason lib/lang.ts's registry is: the listener's forget must reach every layer. */
const memoKey = Symbol.for("spoken.languages.catalogue");
/** `started` numbers each read; `registered` is the newest one registered, so an older never overwrites it. */
type MemoState = { cached: Memo | null; started: number; registered: number };
type MemoHolder = { [memoKey]?: MemoState };
const memo = ((globalThis as MemoHolder)[memoKey] ??= { cached: null, started: 0, registered: 0 });

type Row = {
  code: string;
  name: string | null;
  native: string | null;
  bcp47: string | null;
  provider: string | null;
  client: boolean;
};

/**
 * A row as a language. name, native, bcp47 and provider are null on a row an older release
 * wrote (migration 0106 keeps them nullable), so each falls back to what the code implies.
 */
function describe(row: Row): LanguageInfo {
  const name = row.name ?? row.code;
  return {
    code: row.code,
    name,
    native: row.native ?? name,
    bcp47: row.bcp47 ?? `${row.code.slice(0, 2)}-${row.code.slice(2)}`,
    provider: row.provider ?? row.code.slice(0, 2),
    client: row.client,
  };
}

/** Drops the memo. For the listener, and for tests. */
export function forgetLanguages(): void {
  memo.cached = null;
}

export function loadLanguages(): Promise<LanguageInfo[]> {
  listenInServer();
  const cached = memo.cached;
  if (cached && Date.now() - cached.at < TTL_MS) return cached.langs;
  const seq = ++memo.started;
  const langs: Promise<LanguageInfo[]> = query<Row>(
    `select "code", "name", "native", "bcp47", "provider", "client" from "language" order by "code"`,
  ).then((rows) => {
    const list = rows.map(describe);
    // A read forgotten in flight still registers unless a newer one already has: at boot the
    // listener's first reload forgets instrumentation's read, which must not leave nothing.
    if (seq > memo.registered) {
      registerLanguages(list);
      memo.registered = seq;
    }
    return list;
  });
  memo.cached = { at: Date.now(), langs };
  // A failed read must not be served for the next minute.
  langs.catch(() => {
    if (memo.cached?.langs === langs) memo.cached = null;
  });
  return langs;
}

/** Forgets and reads again in the background, so isLang is current before the next request asks. */
export function reloadLanguages(): void {
  forgetLanguages();
  loadLanguages().catch((error) => console.error("could not reload languages:", error));
}
