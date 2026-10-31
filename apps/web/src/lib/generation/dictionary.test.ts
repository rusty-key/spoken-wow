/**
 * Against a real Postgres, matching history.test.ts and for the same reason.
 *
 * What this module is for is a distinction between three states - never uploaded, uploaded,
 * and saved-but-not-uploaded - and that distinction is a comparison between two timestamps
 * the database writes. A mocked pg would test that `now()` is called, which is not a test.
 *
 * Needs DATABASE_URL and migrations applied:
 *   docker compose up -d postgres && deploy/bin/migrate.sh "$PWD/web"
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const { closeDb } = await import("@/lib/db");
const { asSystem } = await import("@/lib/teams/testing");
const { currentLocator, readLexicon, resync, sync, writeLexicon } = await import("./dictionary");

const ENTRIES = [
  {
    grapheme: "Gnomeregan",
    ipa: "ˈnoʊmɹəɡæn",
    confidence: "high" as const,
  },
];

function pls(lexemes: number): string {
  return `<lexicon>${"<lexeme><grapheme>x</grapheme></lexeme>".repeat(lexemes)}</lexicon>`;
}

/**
 * An ElevenLabs that accepts the upload and hands back a locator.
 *
 * Two endpoints now: add-from-rules, then the download that reads the dictionary back.
 * `kept` is how many rules the stored dictionary reports - null meaning "as many as were
 * sent", which is the healthy case.
 */
function accepts(id = "dict-abc", version = "ver-1", kept: number | null = null) {
  // Remembered from the upload, because the download is a GET and carries no body to count.
  let uploaded = 0;

  const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
    if (String(url).includes("/download")) return new Response(pls(kept ?? uploaded));
    uploaded = JSON.parse(String(init?.body ?? "{}")).rules?.length ?? 0;
    return new Response(JSON.stringify({ id, version_id: version }), { status: 200 });
  });
  return { fetchImpl: fetchImpl as unknown as typeof globalThis.fetch, calls: fetchImpl };
}

/** An ElevenLabs that refuses it. */
function refuses(body = '{"detail":"quota exceeded"}') {
  return {
    fetchImpl: vi.fn(async () => new Response(body, { status: 429 })) as unknown as
      typeof globalThis.fetch,
  };
}

const OPTIONS = (fetchImpl: typeof globalThis.fetch) => ({
  apiKey: "test-key",
  baseUrl: "https://stub.invalid",
  fetchImpl,
});

/**
 * The real lexicon, put back after every case.
 *
 * The table holds one row forever and that row IS the lexicon - 134 pronunciations that
 * migration 0008 seeds once and never re-seeds, because migrations are recorded and do not
 * run twice. So a test that deleted it would not be leaving a mess for the next case; it
 * would be destroying the data, permanently, on whatever database DATABASE_URL happens to
 * point at. This file used to call resetLexicon in afterEach, which did exactly that.
 *
 * Snapshotting the whole row rather than just the entries, because the locator and the
 * timestamps are what the sync states are computed from: restoring the entries alone would
 * hand the next reader a lexicon that claims to be synced to a dictionary built from
 * something else.
 */
let snapshot: Record<string, unknown> | undefined;

/**
 * When this run began, by the database's clock: the activity case looks for its row after
 * it. The activity rows every save here logs, as nobody's, are dropped by vitest.activity.ts;
 * the lexicon_change rows by afterEach below.
 */
let startedAt: string;

beforeAll(async () => {
  try {
    const { rows } = await asSystem.query(
      `select * from "pronunciation_lexicon" where "teamId" = (select "id" from "team" where "slug" = 'english')`,
    );
    snapshot = rows[0];
    startedAt = (await asSystem.query<{ now: string }>(`select now()::text as "now"`)).rows[0].now;
  } catch (error) {
    throw new Error(
      "dictionary.test.ts needs a migrated database. Run:\n" +
        '  docker compose up -d postgres && deploy/bin/migrate.sh "$PWD/web"\n' +
        `original error: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
});

afterEach(async () => {
  // Every save here diffs ENTRIES against the real lexicon and logs the other ~145 words as
  // removed, and the restore below is a raw write that logs nothing to say they came back.
  // Left behind, those rows told the dirty check every word had just moved -- marking most of
  // the corpus -- and one row per word per save made the check itself take 26 seconds a page
  // (2026-10-03: 78,000 rows on spoken_dev). Nobody's, because the site never saves as
  // nobody.
  await asSystem.query(
    `delete from "lexicon_change" where "changedBy" is null and "changedAt" >= $1::timestamptz`,
    [startedAt],
  );
  if (!snapshot) {
    await asSystem.query(`delete from "pronunciation_lexicon" where "teamId" = (select "id" from "team" where "slug" = 'english')`);
    return;
  }
  await asSystem.query(
    `insert into "pronunciation_lexicon"
       ("teamId", "entries", "dictionaryId", "versionId", "rulesSent", "rulesKept",
        "syncedAt", "syncedDigest", "updatedAt", "updatedBy")
     values ((select "id" from "team" where "slug" = 'english'), $1, $2, $3, $4, $5, $6, $9, $7, $8)
     on conflict ("teamId") do update set
       "entries"      = excluded."entries",
       "dictionaryId" = excluded."dictionaryId",
       "versionId"    = excluded."versionId",
       "rulesSent"    = excluded."rulesSent",
       "rulesKept"    = excluded."rulesKept",
       "syncedAt"     = excluded."syncedAt",
       "syncedDigest" = excluded."syncedDigest",
       "updatedAt"    = excluded."updatedAt",
       "updatedBy"    = excluded."updatedBy"`,
    [
      JSON.stringify(snapshot.entries),
      snapshot.dictionaryId ?? null,
      snapshot.versionId ?? null,
      snapshot.rulesSent ?? null,
      snapshot.rulesKept ?? null,
      snapshot.syncedAt ?? null,
      snapshot.updatedAt,
      snapshot.updatedBy ?? null,
      // Restored with the rest of the row: it is what says the stored dictionary was built
      // from these entries, so putting the entries back without it would hand the next case
      // a lexicon that reads as pending when it is not.
      snapshot.syncedDigest ?? null,
    ],
  );
});

afterAll(closeDb);

// ELEVENLABS_DICTIONARY_ID pins one dictionary to update in place, and .env.local sets it to
// the real one -- so every case below took the pinned branch instead of the create branch it
// describes, and failed against an id and a key it was never given. The suite that means to
// test pinning stubs it for itself; every other case states the absence it assumes.
beforeEach(() => vi.stubEnv("ELEVENLABS_DICTIONARY_ID", ""));
afterEach(() => vi.unstubAllEnvs());

describe("readLexicon", () => {
  /** Migration 0008 puts the lexicon there; nothing in the app writes it on first read. */
  it("reads the seeded row", async () => {
    const lexicon = await readLexicon();
    expect(lexicon.seeded).toBe(true);
    expect(lexicon.entries.length).toBeGreaterThan(0);
  });

  /**
   * Seeded is not uploaded. Reporting it as synced would claim audio is being generated with
   * rules that have never reached ElevenLabs.
   */
  it("does not claim a seeded lexicon is in force at ElevenLabs", async () => {
    await asSystem.query(
      `update "pronunciation_lexicon"
          set "dictionaryId" = null, "versionId" = null, "syncedAt" = null where "teamId" = (select "id" from "team" where "slug" = 'english')`,
    );
    expect((await readLexicon()).sync).toBe("never");
    expect(await currentLocator()).toBeNull();
  });

  /**
   * Only reachable with migrations unrun. Worth reporting rather than rendering as an empty
   * lexicon: no rows is exactly what a failed deploy looked like, and the page should say so
   * instead of inviting someone to retype 134 entries.
   */
  it("reports an unseeded table rather than an empty lexicon", async () => {
    await asSystem.query(`delete from "pronunciation_lexicon" where "teamId" = (select "id" from "team" where "slug" = 'english')`);
    const lexicon = await readLexicon();
    expect(lexicon.seeded).toBe(false);
    expect(lexicon.entries).toEqual([]);
  });
});

describe("writeLexicon", () => {
  it("stores the entries and the locator the upload produced", async () => {
    const { fetchImpl } = accepts();
    const { lexicon, syncError } = await writeLexicon(ENTRIES, null as unknown as string,
      OPTIONS(fetchImpl));

    expect(syncError).toBeNull();
    expect(lexicon.seeded).toBe(true);
    expect(lexicon.sync).toBe("synced");
    expect(lexicon.entries).toEqual(ENTRIES);
    expect(lexicon.locator).toEqual({ dictionaryId: "dict-abc", versionId: "ver-1" });
    expect(await currentLocator()).toEqual({ dictionaryId: "dict-abc", versionId: "ver-1" });
  });

  /**
   * case_sensitive TRUE, and this is the regression guard for the whole incident: with false,
   * ElevenLabs discarded every phoneme rule silently and the app reported success.
   */
  it("sends case-sensitive phoneme rules", async () => {
    const { fetchImpl, calls } = accepts();
    await writeLexicon(ENTRIES, null as unknown as string, OPTIONS(fetchImpl));

    const [url, init] = calls.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain("/v1/pronunciation-dictionaries/add-from-rules");
    expect(JSON.parse(String(init.body)).rules).toEqual([
      {
        string_to_replace: "Gnomeregan",
        type: "phoneme",
        phoneme: "ˈnoʊmɹəɡæn",
        alphabet: "ipa",
        case_sensitive: true,
        word_boundaries: true,
      },
    ]);
  });

  /**
   * The save is the part that must not be lost. An edit that reached Postgres and not
   * ElevenLabs is retryable from the editor; the reverse would leave ElevenLabs holding
   * rules that no row describes, and generation applying pronunciations nothing can show.
   */
  it("keeps the entries when the upload fails, and says why", async () => {
    await asSystem.query(
      `update "pronunciation_lexicon"
          set "dictionaryId" = null, "versionId" = null, "syncedAt" = null where "teamId" = (select "id" from "team" where "slug" = 'english')`,
    );
    const { fetchImpl } = refuses();
    const { lexicon, syncError } = await writeLexicon(ENTRIES, null as unknown as string,
      OPTIONS(fetchImpl));

    expect(syncError).toMatch(/quota exceeded/);
    expect(lexicon.entries).toEqual(ENTRIES);
    // `never`, not `pending`: with no locator there is no older dictionary for this save to
    // be queued behind, and nothing is being applied to a request at all. syncError is what
    // carries "the upload you just asked for failed"; the state carries what is in force.
    expect(lexicon.sync).toBe("never");
    expect(lexicon.locator).toBeNull();
  });

  /**
   * The case the editor exists to make visible. A second save whose upload fails leaves the
   * FIRST dictionary in force, so the page is showing entries that lines are not being
   * spoken with - and generation must keep using the locator it has rather than none.
   */
  it("reports a failed re-upload as pending while the previous dictionary stays in force", async () => {
    await writeLexicon(ENTRIES, null as unknown as string, OPTIONS(accepts().fetchImpl));

    const edited = [{ ...ENTRIES[0], ipa: "ɡnoʊmˈɹɛɡən" }];
    const { lexicon } = await writeLexicon(edited, null as unknown as string,
      OPTIONS(refuses().fetchImpl));

    expect(lexicon.sync).toBe("pending");
    expect(lexicon.entries).toEqual(edited);
    expect(lexicon.locator).toEqual({ dictionaryId: "dict-abc", versionId: "ver-1" });
    expect(await currentLocator()).toEqual({ dictionaryId: "dict-abc", versionId: "ver-1" });
  });
});

describe("the activity log", () => {
  it("records a word's rule before and after, as a person would read it", async () => {
    await writeLexicon(ENTRIES, null as unknown as string, OPTIONS(accepts().fetchImpl));
    const edited = [{ ...ENTRIES[0], ipa: "ɡnoʊmˈɹɛɡən" }];
    await writeLexicon(edited, null as unknown as string, OPTIONS(accepts().fetchImpl));

    const { rows } = await asSystem.query<{ kind: string; detail: unknown }>(
      `select "kind", "detail" from "activity"
        where "subject" = 'Gnomeregan' and "lang" = 'enUS' and "at" >= $1::timestamptz
        order by "id" desc limit 1`,
      [startedAt],
    );
    expect(rows).toEqual([
      { kind: "lexicon.edited", detail: { before: "/ˈnoʊmɹəɡæn/", after: "/ɡnoʊmˈɹɛɡən/" } },
    ]);
  });
});

describe("what is in force", () => {
  /**
   * The case the timestamps could not answer.
   *
   * A save and its upload are two transactions microseconds apart, and now() is the
   * transaction's start time, so the pair can tie - and the comparison that used to decide
   * this then read a refused re-upload as synced. Here the entries move with no time passing
   * at all, which is that tie made deliberate: nothing about the clock has changed, and the
   * dictionary in force was still built from the old rules.
   */
  it("reports entries that changed without the clock moving as pending", async () => {
    await writeLexicon(ENTRIES, null as unknown as string, OPTIONS(accepts().fetchImpl));
    expect((await readLexicon()).sync).toBe("synced");

    // Neither timestamp is touched. The old comparison sees nothing at all here.
    await asSystem.query(
      `update "pronunciation_lexicon" set "entries" = $1::jsonb where "teamId" = (select "id" from "team" where "slug" = 'english')`,
      [JSON.stringify([{ ...ENTRIES[0], ipa: "something-else" }])],
    );

    const lexicon = await readLexicon();
    expect(lexicon.sync).toBe("pending");
    // Still in force, and still what generation must use: the rules ElevenLabs holds have
    // not changed, only the ones this row now describes.
    expect(lexicon.locator).toEqual({ dictionaryId: "dict-abc", versionId: "ver-1" });
    expect(await currentLocator()).toEqual({ dictionaryId: "dict-abc", versionId: "ver-1" });
  });

  /** The other half: re-saving the same entries is still synced, not a new pending state. */
  it("keeps a lexicon synced when a save changes nothing about the entries", async () => {
    await writeLexicon(ENTRIES, null as unknown as string, OPTIONS(accepts().fetchImpl));

    await asSystem.query(`update "pronunciation_lexicon" set "updatedAt" = now() where "teamId" = (select "id" from "team" where "slug" = 'english')`);

    expect((await readLexicon()).sync).toBe("synced");
  });
});

describe("concurrent saves", () => {
  /**
   * Two admins at once: save(A), save(B), then A's upload lands last. Without the condition
   * on the update, the row would pair B's entries with A's rules and report itself synced,
   * because syncedAt would be newer than updatedAt - the editor showing pronunciations that
   * nothing is being spoken with.
   */
  it("refuses to attach a locator to entries it did not upload", async () => {
    await asSystem.query(
      `update "pronunciation_lexicon"
          set "dictionaryId" = null, "versionId" = null, "syncedAt" = null where "teamId" = (select "id" from "team" where "slug" = 'english')`,
    );
    const a = [{ ...ENTRIES[0], ipa: "aaa" }];
    const b = [{ ...ENTRIES[0], ipa: "bbb" }];

    await writeLexicon(a, null as unknown as string, OPTIONS(refuses().fetchImpl));
    await writeLexicon(b, null as unknown as string, OPTIONS(refuses().fetchImpl));

    // A's upload finally succeeds, but B is what is stored now.
    const error = await sync(a, OPTIONS(accepts("dict-a", "ver-a").fetchImpl));

    expect(error).toMatch(/changed while this upload was in flight/);
    const lexicon = await readLexicon();
    expect(lexicon.entries).toEqual(b);
    // Neither upload landed a locator, so nothing is in force - see the note above about
    // never vs pending.
    expect(lexicon.sync).toBe("never");
    expect(await currentLocator()).toBeNull();
  });
});

describe("rule verification", () => {
  /**
   * The check whose absence cost a day. `case_sensitive:false` makes ElevenLabs discard a
   * phoneme rule silently - 200, an id, a version, and the rule simply gone - so 134 entries
   * uploaded as 2 and every surface in this app reported success. Counting what came back is
   * the only thing that would have noticed.
   */
  it("records how many rules were sent and how many survived", async () => {
    const { fetchImpl } = accepts("dict-abc", "ver-1");
    const { lexicon } = await writeLexicon(ENTRIES, null as unknown as string,
      OPTIONS(fetchImpl));

    expect(lexicon.rulesSent).toBe(lexicon.rulesKept);
    expect(lexicon.rulesSent).toBeGreaterThan(0);
  });

  it("reports a dictionary that silently dropped rules, while keeping it in force", async () => {
    const { fetchImpl } = accepts("dict-abc", "ver-1", 1);
    const { lexicon, syncError } = await writeLexicon(
      [ENTRIES[0], { ...ENTRIES[0], grapheme: "Orgrimmar", ipa: "ˈɔɹɡɹɪmɑɹ" }],
      null as unknown as string,
      OPTIONS(fetchImpl),
    );

    expect(syncError).toMatch(/kept only 1 of 2/);
    // In force, not withheld: one working rule beats none, and the page says what is missing.
    expect(lexicon.sync).toBe("synced");
    expect(lexicon.rulesKept).toBe(1);
    expect(lexicon.rulesSent).toBe(2);
  });

  /**
   * A readback failure is not an upload failure. The dictionary may be perfectly good and the
   * count merely unknown, so refusing to store the locator would throw away a working upload
   * over a failed GET.
   */
  it("still stores the locator when the readback fails", async () => {
    const fetchImpl = vi.fn(async (url: string) =>
      String(url).includes("/download")
        ? new Response("nope", { status: 500 })
        : new Response(JSON.stringify({ id: "dict-abc", version_id: "ver-1" })),
    ) as unknown as typeof globalThis.fetch;

    const { lexicon } = await writeLexicon(ENTRIES, null as unknown as string,
      OPTIONS(fetchImpl));

    expect(lexicon.locator).toEqual({ dictionaryId: "dict-abc", versionId: "ver-1" });
    expect(lexicon.rulesKept).toBeNull();
    expect(lexicon.sync).toBe("synced");
  });
});

describe("resync", () => {
  it("uploads what is stored and puts it in force", async () => {
    await asSystem.query(
      `update "pronunciation_lexicon"
          set "dictionaryId" = null, "versionId" = null, "syncedAt" = null where "teamId" = (select "id" from "team" where "slug" = 'english')`,
    );
    await writeLexicon(ENTRIES, null as unknown as string, OPTIONS(refuses().fetchImpl));
    expect((await readLexicon()).sync).toBe("never");

    const error = await resync(OPTIONS(accepts("dict-xyz", "ver-9").fetchImpl));

    expect(error).toBeNull();
    const lexicon = await readLexicon();
    expect(lexicon.sync).toBe("synced");
    expect(lexicon.locator).toEqual({ dictionaryId: "dict-xyz", versionId: "ver-9" });
  });

  // Only reachable with migrations unrun, since 0008 seeds the row - but resync must still
  // say so rather than uploading an empty dictionary and reporting success.
  it("refuses when there is no lexicon at all", async () => {
    await asSystem.query(`delete from "pronunciation_lexicon" where "teamId" = (select "id" from "team" where "slug" = 'english')`);
    expect(await resync(OPTIONS(accepts().fetchImpl))).toMatch(/no saved lexicon/);
  });
});

/**
 * With ELEVENLABS_DICTIONARY_ID set, one dictionary is updated in place forever instead of a
 * new one being created per save. The id has to stay put because ../wow-lore names it in its
 * own config and pins versions of it; a save that minted a fresh id would silently strand it
 * on whatever the rules were the day the id was copied.
 */
describe("the pinned dictionary", () => {
  const PINNED = "dict-shared";

  /**
   * An ElevenLabs holding `stored` rule strings, recording what it is asked to do.
   *
   * The version returned climbs, so a test can tell which call produced the locator that was
   * saved - the whole point being that the removal, when there is one, is what finishes.
   */
  function holding(stored: string[]) {
    const seen: { endpoint: string; body: unknown }[] = [];
    let version = 0;
    let sent = 0;

    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      const target = String(url);
      const body = init?.body ? JSON.parse(String(init.body)) : undefined;

      if (target.includes("/download")) return new Response(pls(sent));
      if (target.endsWith(`/v1/pronunciation-dictionaries/${PINNED}`)) {
        return new Response(
          JSON.stringify({
            id: PINNED,
            latest_version_id: `ver-${version}`,
            rules: stored.map((string_to_replace) => ({ string_to_replace })),
          }),
        );
      }

      const endpoint = target.endsWith("/add-rules") ? "add-rules" : "remove-rules";
      if (endpoint === "add-rules") sent = body.rules.length;
      seen.push({ endpoint, body });
      return new Response(JSON.stringify({ id: PINNED, version_id: `ver-${++version}` }));
    });

    return { fetchImpl: fetchImpl as unknown as typeof globalThis.fetch, seen };
  }

  beforeEach(() => vi.stubEnv("ELEVENLABS_DICTIONARY_ID", PINNED));
  afterEach(() => vi.unstubAllEnvs());

  it("keeps the id across saves and never creates a dictionary", async () => {
    const { fetchImpl, seen } = holding([]);
    const { lexicon, syncError } = await writeLexicon(ENTRIES, null as unknown as string,
      OPTIONS(fetchImpl));

    expect(syncError).toBeNull();
    expect(lexicon.locator?.dictionaryId).toBe(PINNED);
    expect(seen.map((call) => call.endpoint)).toEqual(["add-rules"]);
    expect(await currentLocator()).toEqual(lexicon.locator);
  });

  /**
   * Add first, remove second. add-rules replaces a rule matching the same string, so sending
   * everything makes every rule current; removing first would leave a window in which a name
   * the lexicon still holds has no pronunciation at all.
   */
  it("adds every rule, then removes only the strings the lexicon dropped", async () => {
    const { fetchImpl, seen } = holding(["Gnomeregan", "Ysera", "Nozdormu"]);
    await writeLexicon(ENTRIES, null as unknown as string, OPTIONS(fetchImpl));

    expect(seen.map((call) => call.endpoint)).toEqual(["add-rules", "remove-rules"]);
    expect((seen[0].body as { rules: { string_to_replace: string }[] }).rules
      .map((rule) => rule.string_to_replace)).toContain("Gnomeregan");
    // Gnomeregan is still in the lexicon, so it must survive; the other two are gone.
    expect((seen[1].body as { rule_strings: string[] }).rule_strings.sort())
      .toEqual(["Nozdormu", "Ysera"]);
  });

  it("issues no removal when nothing was dropped", async () => {
    const { fetchImpl, seen } = holding(["Gnomeregan"]);
    await writeLexicon(ENTRIES, null as unknown as string, OPTIONS(fetchImpl));

    expect(seen.map((call) => call.endpoint)).toEqual(["add-rules"]);
  });

  /**
   * Without the stored rules there is no way to know which ones the lexicon no longer wants,
   * and adding anyway would leave rules in force that the editor page cannot show. Failing
   * before the first write is what keeps the dictionary consistent with the row.
   */
  it("refuses to update a dictionary whose current rules it could not read", async () => {
    const fetchImpl = vi.fn(async (url: string) =>
      String(url).endsWith(`/v1/pronunciation-dictionaries/${PINNED}`)
        ? new Response(JSON.stringify({ id: PINNED, latest_version_id: "ver-1" }))
        : new Response(JSON.stringify({ id: PINNED, version_id: "ver-2" })),
    ) as unknown as typeof globalThis.fetch;

    await asSystem.query(
      `update "pronunciation_lexicon"
          set "dictionaryId" = null, "versionId" = null, "syncedAt" = null where "teamId" = (select "id" from "team" where "slug" = 'english')`,
    );
    const { lexicon, syncError } = await writeLexicon(ENTRIES, null as unknown as string,
      OPTIONS(fetchImpl));

    expect(syncError).toMatch(/returned no rules/);
    expect(lexicon.entries).toEqual(ENTRIES);
    expect(lexicon.locator).toBeNull();
  });
});
