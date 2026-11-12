# Self-serve plan 1: languages become database rows

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A site admin can add a language the code has never heard of (jaJP) from `/admin`, and it works on the site at once, with no deploy.

**Architecture:** The `language` table gains the descriptive columns (name, native name, BCP 47 tag, provider language code, client flag), and is seeded with the thirteen languages in code. `lib/lang.ts` keeps those thirteen as the built-in list and becomes a registry that the server fills from the database (memoised, refreshed on a Postgres `NOTIFY`) and the browser fills from the layout. URL rewrites match a language prefix by shape, not by list; whether a prefix is a language stays the layout's question.

**Tech Stack:** Postgres 16 plain-SQL migrations (`apps/web/migrations`), node-postgres, Next.js App Router (`apps/web`), Vitest.

**Spec:** [`SELF-SERVE-TEAMS.md`](SELF-SERVE-TEAMS.md), section *The big change: languages become data* and *Calls made without the user*. Plans 2 to 5 (requests and approval, invites, the API, a second team) build on this one.

## Decisions

- **`Lang` becomes `BuiltinLang | (string & {})`.** `BuiltinLang` is the union of the thirteen codes. Literals still type-check and autocomplete; validation is `isLang()` at every entry point (`pageLang`, `langParam`, the token guard), as today. Maps keyed by built-in languages (`player-words.ts`, `calibration.ts`, the landing page's `META`) become `Partial<Record<BuiltinLang, …>>`. *(My call: a branded type would mean casts across ~220 importers and most tests, for no check the entry points don't already make.)*
- **The pipelines are untouched.** `pipelines/lib/locales.mjs` stays the list the pipelines and addon checks use; `lang.test.ts` keeps asserting the site's built-in list equals it, and a new test asserts every one of them has a matching `language` row. *(Spec call.)*
- **No `script` column.** Only the pipelines and the addon use it; a requested language declares its font in its pack (`X-Spoken-LanguageFont`). *(My call, YAGNI.)*
- **A requested language is `client = false`.** No WoW client runs in it, so nothing client-derived (contributions, gossip locale, area aliases) is built for it. The add form does not offer the flag.
- **Built-in rows are read-only.** The add route refuses a built-in code; their columns come from the seed. Editing a language's names later is not in this plan.

## Global Constraints

- Migrations: plain SQL, next number `0106`, applied by `deploy/web/bin/migrate.sh`, one transaction each, additive. A release must run against the schema of the release after it.
- Language code: `^[a-z]{2}[A-Z]{2}$` (existing check on `language.code`, `team_language.lang`).
- Provider language code: ISO 639-1, `^[a-z]{2}$`, sent as ElevenLabs `language_code`.
- English (`enUS`) is always on and is what a bare URL means.
- Tests run as `spoken_app` on `spoken_ci_pin`, never `spoken_dev` (it is the shared dev database and some suites wipe languages). Fixtures use `asSystem` from `src/lib/teams/testing.ts`.
- Commands in fish: `set -x DATABASE_URL postgres:///spoken_ci_pin; pnpm --dir apps/web vitest run <file>`.
- No English request pays for a database query: the server registry is memoised in process.

## Review Focus

1. **A new language on the other pm2 worker.** Added on worker A, the next request on worker B must know it within a second (the `NOTIFY`), and before any notification at worst after the memo's TTL. Tested in Task 3.
2. **A path shaped like a language that is not one** (`/xxYY/quests`): 404, as today, not a 500. Tested in Task 4.
3. **The first request after boot**, before the memo has loaded: `/jaJP/quests` must render, not 404. Tested in Task 3 (`pageLang` awaits the load).
4. **A client component naming a requested language** (`langName("jaJP")` in GrantCell, AdminHeader): shows "Japanese", not the code. Tested in Task 5.
5. **Adding a code that already exists**, built-in or requested: 409 with a message, no row changed. Tested in Task 6.

---

### Task 1: The `language` table describes a language

**Files:**
- Create: `apps/web/migrations/0106_language_catalogue.sql`
- Test: `apps/web/src/lib/languages/seed.test.ts`

**Interfaces:**
- Produces: columns `"name" text not null`, `"native" text not null`, `"bcp47" text not null`, `"provider" text not null check ("provider" ~ '^[a-z]{2}$')`, `"client" boolean not null default false`, `"createdAt" timestamptz not null default now()` on `language`; a row for each of the thirteen codes in `pipelines/lib/locales.mjs` with its values (existing rows keep `enabled`; new ones are off except `enUS`); trigger `language_notify` sending `NOTIFY spoken_language` after insert, update or delete.

- [ ] **Step 1: Write the failing test** `seed.test.ts`: for every entry of `LOCALES` from `@tools/lib/locales.mjs`, `select … from "language" where "code" = $1` returns `{ name, bcp47, provider: elevenLabs, client: client !== false }`, and `native` is non-empty. The native names to seed: English, Deutsch, Español (EU), Español (AL), Français, Italiano, Polski, Português, Русский, 한국어, 简体中文, 繁體中文, Tiếng Việt.
- [ ] **Step 2: Run it.** `pnpm --dir apps/web vitest run src/lib/languages/seed.test.ts`. Expected: FAIL, `column "name" does not exist`.
- [ ] **Step 3: Write the migration.** Add the columns nullable, upsert the thirteen rows (`on conflict ("code") do update` of the descriptive columns only), then `set not null`. The trigger function is `plpgsql`, `perform pg_notify('spoken_language', coalesce(new."code", old."code"))`.
- [ ] **Step 4: Apply and run.** `deploy/web/bin/migrate.sh $PWD/apps/web` against `spoken_ci_pin`, then the test. Expected: PASS.
- [ ] **Step 5: Commit.** `feat(languages): describe languages in the language table`

### Task 2: `lib/lang.ts` becomes a registry

**Files:**
- Modify: `apps/web/src/lib/lang.ts`
- Modify: `apps/web/src/lib/lang.test.ts`
- Modify: `apps/web/src/lib/player-words.ts:45,111`, `apps/web/src/lib/generation/calibration.ts:61`, `apps/web/src/app/[lang]/page.tsx:42`

**Interfaces:**
- Produces (client-safe, all in `lib/lang.ts`):
  - `type LanguageInfo = { code: string; name: string; native: string; bcp47: string; provider: string; client: boolean }`
  - `BUILTIN: readonly LanguageInfo[]` (today's `LOCALES` plus `native`; the `as const` literal stays so `BuiltinLang` derives from it)
  - `type BuiltinLang`, `type Lang = BuiltinLang | (string & {})`
  - `registerLanguages(list: readonly LanguageInfo[]): void`: replaces the non-built-in entries; built-ins can never be overwritten or removed
  - `allLangs(): Lang[]`: built-ins in their order, then the rest by code
  - `languageInfo(lang: string): LanguageInfo | null`
  - `isLang`, `isClientLang`, `clientLang`, `langName`, `nativeName(lang): string`, `langTag`, `elevenLabsCode`: same signatures, reading the registry
  - `LOCALES` and `CODES` are removed; Task 5 moves their callers.

- [ ] **Step 1: Write the failing tests** in `lang.test.ts`:
  - `registerLanguages([{ code: "jaJP", name: "Japanese", native: "日本語", bcp47: "ja-JP", provider: "ja", client: false }])` makes `isLang("jaJP")` true, `langName("jaJP")` `"Japanese"`, `langTag("jaJP")` `"ja-JP"`, `elevenLabsCode("jaJP")` `"ja"`, `isClientLang("jaJP")` false, `clientLang("jaJP")` null, and `allLangs()` end in `"jaJP"`.
  - Registering `{ code: "deDE", name: "Wrong", … }` leaves `langName("deDE")` `"German"`.
  - `registerLanguages([])` after the above makes `isLang("jaJP")` false again.
  - The existing "is the pipeline's list" test runs against `BUILTIN`.
- [ ] **Step 2: Run them.** `pnpm --dir apps/web vitest run src/lib/lang.test.ts`. Expected: FAIL, `registerLanguages` is not exported.
- [ ] **Step 3: Implement** in `lib/lang.ts`: a module-level `Map<string, LanguageInfo>` for the extras. Retype the three `Partial<Record<Lang, …>>` maps as `Partial<Record<BuiltinLang, …>>`, with lookups that accept any `Lang`.
- [ ] **Step 4: Run them.** Same command. Expected: PASS. `pnpm --dir apps/web typecheck` fails only at `LOCALES`/`CODES` callers (Task 5).
- [ ] **Step 5: Commit.** `feat(languages): language registry beside the built-in list`

### Task 3: The server fills the registry from the database

**Files:**
- Create: `apps/web/src/lib/languages/catalogue.ts`
- Create: `apps/web/src/instrumentation.ts`
- Modify: `apps/web/src/lib/lang-server.ts`
- Modify: `apps/web/src/lib/teams/listen.ts` (generalise to a channel → callback map, so one connection listens to both channels)
- Test: `apps/web/src/lib/languages/catalogue.test.ts`

**Interfaces:**
- Consumes: Task 1's columns and `spoken_language` channel; Task 2's `registerLanguages`.
- Produces:
  - `loadLanguages(): Promise<LanguageInfo[]>` in `catalogue.ts`: memoised for 60 s like `teamLangs()` (`lib/teams/store.ts:35`), reads every row, calls `registerLanguages` with the result, and is dropped by `forgetLanguages(): void` on a `spoken_language` notification or reconnect.
  - `listenInServer()` in `listen.ts` listens on `spoken_team_language` and `spoken_language`.
  - `register()` in `instrumentation.ts` awaits `loadLanguages()` when `NEXT_RUNTIME === "nodejs"` and not building, so synchronous `isLang` is right from the first request.
  - `langParam` and `pageLang` `await loadLanguages()` before `isLang` (a no-op on a fresh memo).

- [ ] **Step 1: Write the failing tests** in `catalogue.test.ts`:
  - Insert a `jaJP` row with `asSystem`; after `forgetLanguages()` and `await loadLanguages()`, `isLang("jaJP")` is true and `langName("jaJP")` is `"Japanese"`.
  - With the listener started (`listenForTeamChanges()`), inserting a `qaQA` test row and waiting up to 1 s makes `isLang` true for it without calling `forgetLanguages()`.
  - `pageLang(Promise.resolve({ lang: "jaJP" }))` resolves to `"jaJP"` when the row is enabled, from a cold memo.
  - Clean up inserted rows in `afterEach`.
- [ ] **Step 2: Run them.** `pnpm --dir apps/web vitest run src/lib/languages/catalogue.test.ts`. Expected: FAIL, module not found.
- [ ] **Step 3: Implement** `catalogue.ts`, the listener's channel map, `instrumentation.ts`, and the two awaits in `lang-server.ts`.
- [ ] **Step 4: Run them** and `src/lib/teams/*.test.ts` (the listener change). Expected: PASS.
- [ ] **Step 5: Commit.** `feat(languages): load languages from the database and follow changes`

### Task 4: URL rewrites match a language by shape

**Files:**
- Modify: `apps/web/src/lib/locale-routes.ts`, `apps/web/src/lib/section-routes.ts`
- Test: `apps/web/src/lib/locale-routes.test.ts`, `apps/web/src/lib/section-routes.test.ts`

**Interfaces:**
- Produces: `LANG_SHAPE = "[a-z]{2}[A-Z]{2}"` exported from `locale-routes.ts`, used in place of `CODES.join("|")` in both files. The doc comment's "VALIDATED AGAINST THE LIST IN CODE" paragraph is rewritten: the prefix is matched by shape and validated by the layout.

- [ ] **Step 1: Write the failing tests:** `/jaJP/quests` is not rewritten to `/enUS/jaJP/quests`; `/jaJP/zones` (an old section path) redirects like `/deDE/zones` does; `/quests`, `/api/x`, `/logo.png` behave as before.
- [ ] **Step 2: Run them.** `pnpm --dir apps/web vitest run src/lib/locale-routes.test.ts src/lib/section-routes.test.ts`. Expected: the `jaJP` cases FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run them.** Expected: PASS.
- [ ] **Step 5: Commit.** `feat(languages): match a URL's language prefix by shape`

### Task 5: Every caller of the fixed list reads the registry

**Files:**
- Create: `apps/web/src/components/LanguagesProvider.tsx`
- Modify: `apps/web/src/app/[lang]/layout.tsx`, `apps/web/src/lib/permissions.ts:146,155`, `apps/web/src/lib/languages/store.ts`, `apps/web/src/lib/teams/store.ts:141`, `apps/web/src/lib/contributions/accept.ts:969`, `apps/web/src/components/AdminHeader.tsx`, `apps/web/src/components/GrantCell.tsx`, `apps/web/src/components/RegenerationPanel.tsx`, `apps/web/src/components/UploadBroadcastCache.tsx`, `apps/web/src/app/[lang]/page.tsx`, `apps/web/src/app/[lang]/admin/teams/page.tsx`
- Test: `apps/web/src/components/LanguagesProvider.test.tsx`

**Interfaces:**
- Consumes: Task 2's registry, Task 3's `loadLanguages`.
- Produces: `<LanguagesProvider languages={LanguageInfo[]}>` (client): calls `registerLanguages(languages)` during render, before its children, so any client component's `langName` knows them. The layout passes the non-built-in rows from `loadLanguages()`.
- `languageStates()` and `adoptEveryLang()` iterate `allLangs()`; `UploadBroadcastCache` and the landing page's install list use `BUILTIN` filtered by `client` (a requested language has no client to upload from and no official pack yet).

- [ ] **Step 1: Write the failing test** `LanguagesProvider.test.tsx`: rendering a `GrantCell` (or a minimal child calling `langName("jaJP")`) inside `<LanguagesProvider languages={[jaJP]}>` shows "Japanese".
- [ ] **Step 2: Run it.** Expected: FAIL, module not found.
- [ ] **Step 3: Implement** the provider and move every `LOCALES`/`CODES` caller listed above.
- [ ] **Step 4: Run** `pnpm --dir apps/web typecheck` (clean) and `pnpm --dir apps/web test` on `spoken_ci_pin`. Expected: PASS.
- [ ] **Step 5: Commit.** `refactor(languages): read languages from the registry everywhere`

### Task 6: A site admin adds a language

**Files:**
- Modify: `apps/web/src/lib/languages/store.ts`, `apps/web/src/app/api/languages/route.ts`, `apps/web/src/components/LanguageTable.tsx`, `apps/web/src/lib/activity/kinds.ts`, `apps/web/src/components/ActivityTable.tsx`
- Test: `apps/web/src/app/api/languages/route.test.ts`

**Interfaces:**
- Consumes: Task 1's columns, Task 3's `forgetLanguages`.
- Produces (plan 2's approval calls this):
  - `addLanguage(client: ClientBase, input: { code: string; name: string; native: string; bcp47: string; provider: string }, userId: string): Promise<void>` in `languages/store.ts`. Inserts the row switched off with `client = false`, calls `adoptLang`, and throws `LanguageExistsError` for a code already in the table. On the caller's client so approval can wrap it in one transaction; the caller calls `forgetLanguages()` and `forgetTeams()` after commit.
  - `POST /api/languages` (site admin only): body is the input above, runs `addLanguage` in a transaction, records activity `language.added` (`detail: { name }`), returns `GET()`. 400 on a malformed field, 409 on `LanguageExistsError`.
  - `LanguageTable` gets an "Add a language" row: code, English name, native name, BCP 47 tag (prefilled from the code, `jaJP` → `ja-JP`), provider code (prefilled from the first two letters).

- [ ] **Step 1: Write the failing tests** in `route.test.ts`: as admin, `POST {code:"jaJP", name:"Japanese", native:"日本語", bcp47:"ja-JP", provider:"ja"}` returns 200 with jaJP listed `enabled: false`, and `team_of_lang('jaJP')` is not null; posting it again returns 409; posting `deDE` returns 409; `code:"japan"` or `provider:"jpn"` returns 400; as a member, 403.
- [ ] **Step 2: Run them.** `pnpm --dir apps/web vitest run src/app/api/languages/route.test.ts`. Expected: FAIL, 405.
- [ ] **Step 3: Implement** the store function, the route, the activity kind and its row, and the form.
- [ ] **Step 4: Run them**, then `pnpm --dir apps/web typecheck`. Expected: PASS. Check in the browser on `spoken_dev` (Paseo tab): add jaJP, switch it on, open `/jaJP/quests`, see "Japanese" in the switcher.
- [ ] **Step 5: Commit.** `feat(languages): site admins add a language`
