# Self-serve plan 4: the API reads English and generates

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** With a token, a script can read the English reference text of any section and queue regeneration in the token's language on its owner's own key, then watch or stop that batch, with exactly the reach the site's Regenerate button has.

**Architecture:** `api_token` gains an opt-in `generate` flag and an `access` of `none`, so a token can be generate-only. The bearer guard asks for one of four needs (`read`, `write`, `generate`, `any`) and checks the matching capability on every request. The quests/places/readables/bosses job derivation moves out of `/api/regenerate/queue` into `lib/generation/batch-plan.ts`, which both that route and the new `POST /api/v1/<section>/generate` call, so the API cannot queue anything the button could not.

**Tech Stack:** Postgres 16 plain-SQL migrations (`apps/web/migrations`), node-postgres, Next.js App Router (`apps/web`), Vitest.

**Spec:** [`SELF-SERVE-TEAMS.md`](SELF-SERVE-TEAMS.md), *What the translator can do* step 5 (*Through the API*) and *Calls made without the user* → *Tokens that generate*. Builds on [plan 1](self-serve-plan-1-languages.md). Independent of plans 2 and 3: it relies only on `can()`, so a locked team's or a request-made language's grants work here however plan 2 sets them.

## Decisions

- **Reference endpoint is `GET /api/v1/<section>/reference`** (user). It calls the section's `list(BASE_LANG, …)` through the same `parseList`, so filters, cursor and limit match the list. Items are projected to `ReferenceItem` (`id`, `variant?`, `text`, `override?`, `short?`, `name`, `group`): versions and `englishText` mean nothing for English. *(My call.)*
- **Any valid token reads the reference** (user). "Valid" means live (not expired, revoked, or owned by a banned user) and backed by a grant for at least one of its scopes now: `text` for a read/write token, `regenerate` for a generate token. A token whose owner lost every grant is dead for everything. *(My call: otherwise a dead token would still answer.)*
- **`generate` is a separate boolean, and `access` gains `'none'`** (spec). A generate-only token is `access = 'none', generate = true`; a check refuses a token that is `none` and not `generate`. Migration 0110 defaults `generate` to false, so no existing token gains spending power. *(My call on the representation.)* Rollback to a pre-0110 release reads `none` as read-only, so a generate-only token whose owner also holds `text` could read text there. Accepted: that owner can make a read token anyway.
- **Who may create which token** (user): `access` `read`/`write` needs `text` in the language; `generate` needs `regenerate`. Someone with only `regenerate` sees the token section and can create generate-only tokens. Each person creates their own; no admin-issued tokens.
- **Generation endpoint shape** (left to the builder by the spec; my call): `POST /api/v1/<section>/generate` with `{items: [{id, variant?}]}` for every section, the same item shape `PATCH /api/v1/<section>` takes, so an agent generates exactly what it just wrote. Quests also take `{filters: "<Explorer query string>"}`, the body the quests half of `/api/regenerate/queue` already takes, because "every stale line" is a filter and 17,000 ids are not. A quest item matches every speaker line of that id and variant (`baseLineId`), as one text edit is heard in every voice.
- **Dry run** (my call): `{"dryRun": true}` returns the plan and an estimate priced like the Regenerate dialog (`billing.estimate` over the plan's files, rate from `observedRate` / `observedFishRate` for the owner's preferred models), split by provider when pinned fish voices are in it, plus which keys are missing. It queues nothing and needs no key. It does not read the provider balance: the dialog shows it but never blocks on it, and reading it is a call to the provider per request.
- **Same limits as the button, plus one** (my call): the same derivation (`batch-plan.ts`), `requireSpeaker` at enqueue with the provider fixed there, the pinned-voice fish key check, one job per file per language (`enqueue`'s conflict rule), and the owner's own key only. On top, `items` is capped at `MAX_ITEMS` (1000) per request, as a text update is. Filters are uncapped, as in the UI.
- **Batch reads and Stop live at `/api/v1/generations`** (my call): `/api/v1/batches` already means text mass updates. A token sees its owner's batches in its language, whichever surface queued them. `POST /api/v1/generations/{batchId}/stop` cancels that batch's pending jobs, the API's counterpart of the panel's Stop, so a script that queued the wrong set can stop paying for it.
- **No new batch column** (my call): the token that queued a batch goes in the `batch.queued` activity detail as `apiTokenId`, as text edits record it.

## Global Constraints

- Migrations: plain SQL, number `0110` (plans 2 and 3 take 0108, 0109), applied by `deploy/web/bin/migrate.sh`, one transaction, additive. A release must run against the schema of the release after it.
- Nothing in the repo spends TTS credits: tests mock `enqueue`/`createBatch` or seed jobs and cancel them; no test reaches a provider.
- Tests run as `spoken_app` on `spoken_ci_pin`, never `spoken_dev`. Commands in fish: `set -x DATABASE_URL postgres://localhost/spoken_ci_pin; pnpm --dir apps/web vitest run <file>`.
- A seeded job is cancelled in `afterEach` (`cancelPending`), and its batch deleted, so no worker connected to the database could claim it.
- Every per-team query goes through `queryAs` / `withTeam` (`lib/teams/store.ts`, `lib/db.ts`).
- The grant is asked for on every request, never stored on the token.
- The language always comes from the token; a body or query naming another is refused, not ignored.
- Generation follows today's rules: no server-wide key, a job runs on its owner's key, the provider is fixed at enqueue.
- Site and API changes add no changelog notes (AGENTS.md).

## Review Focus

1. **A token made before 0110 calls generate.** Expect 403 "this token cannot generate", nothing queued. Tested in Task 2 and Task 5.
2. **The owner loses `regenerate` (or the team is locked) after making a generate token.** The next generate, generations read or stop is 403; the reference read is 403 too if no `text` remains. Tested in Task 2.
3. **An ElevenLabs batch that holds a line in a voice pinned to fish.audio, with no fish key.** Expect 428 naming fish.audio before any batch row exists, from the API and from the button. Tested in Task 4.
4. **A quest item whose line is split by voice (`q:5:accept` and `q:5:accept~orc-male`).** Both files are queued, each once. Tested in Task 4.
5. **Another person's batch id, or the owner's batch in another language.** Status and stop answer 404, the same as an unknown id. Tested in Task 6.

---

### Task 1: Tokens can carry `generate`

**Files:**
- Create: `apps/web/migrations/0110_api_token_generate.sql`
- Modify: `apps/web/src/lib/tokens/types.ts`, `apps/web/src/lib/tokens/store.ts`
- Test: `apps/web/src/lib/tokens/store.test.ts`

**Interfaces:**
- Produces: column `"generate" boolean not null default false`; constraint `api_token_access_check` becomes `"access" in ('none', 'read', 'write')`; new constraint `api_token_has_scope` `check ("access" <> 'none' or "generate")`.
- `type TokenAccess = "none" | "read" | "write"`; `ApiToken` gains `generate: boolean`.
- `isTokenAccess(value)` accepts `"none"`.
- `createToken(args: { userId; lang; access: TokenAccess; generate: boolean; label; expiresAt })`; `COLUMNS` includes `t."generate"`, so `findLiveToken`, `listTokens` and `listAllTokens` return it.

- [ ] **Step 1: Write the failing tests** in `store.test.ts`: `createToken({…, access: "none", generate: true})` returns `row.generate === true`, `row.access === "none"`, and `findLiveToken(token)` returns the same; `createToken({…, access: "read", generate: false})` gives `generate: false`; a raw `insert … ("access") values ('none')` with `generate` false through `asSystem` rejects with a check violation; an existing-shaped insert without the column reads back `generate: false`.
- [ ] **Step 2: Run them.** `pnpm --dir apps/web vitest run src/lib/tokens/store.test.ts`. Expected: FAIL, `column "generate" does not exist`.
- [ ] **Step 3: Write the migration** (drop and re-add `api_token_access_check`, add the column and `api_token_has_scope`), then the type and store changes. Existing callers of `createToken` pass `generate: false`.
- [ ] **Step 4: Apply and run.** `deploy/web/bin/migrate.sh $PWD/apps/web` against `spoken_ci_pin`, then the test and `pnpm --dir apps/web typecheck`. Expected: PASS, clean.
- [ ] **Step 5: Commit.** `feat(api): tokens can carry a generate scope`

### Task 2: The guard checks what each route needs

**Files:**
- Modify: `apps/web/src/lib/text-api/guard.ts`
- Modify (call sites): `apps/web/src/app/api/v1/route.ts`, `apps/web/src/app/api/v1/[section]/route.ts`, `apps/web/src/app/api/v1/[section]/[id]/route.ts`, `apps/web/src/app/api/v1/lexicon/route.ts`, `apps/web/src/app/api/v1/lexicon/[grapheme]/route.ts`, `apps/web/src/app/api/v1/batches/route.ts`, `apps/web/src/app/api/v1/batches/[batchId]/restore/route.ts`
- Test: `apps/web/src/lib/text-api/guard.test.ts`

**Interfaces:**
- Consumes: Task 1's `generate`.
- Produces: `type TokenNeed = "read" | "write" | "generate" | "any"`; `requireToken(request, options: { need?: TokenNeed; also?: Capability } = {})`, `need` defaulting to `"read"`. `TokenContext` gains `generate: boolean`.
  - Text ok: `access !== "none"` and `can(viewer, "text", lang)`. Generate ok: `generate` and `can(viewer, "regenerate", lang)`.
  - `read`: text ok. `write`: text ok and `access === "write"`. `generate`: generate ok. `any`: text ok or generate ok.
  - 403 messages: `"this token has no text access"` (access none), `"this token's owner is not a text maintainer in {lang}"`, `"this token is read-only"`, `"this token cannot generate"` (generate false), `"this token's owner does not hold regenerate in {lang}"`, and for `any` with neither, the one for the scope the token has.
- Call sites: `{ write: true }` becomes `{ need: "write" }`; `GET /api/v1` takes `{ need: "any" }`; the rest keep the default.

- [ ] **Step 1: Write the failing tests** in `guard.test.ts` (grants mocked as today): a `generate`-only token with grant `regenerate` passes `need: "generate"` and `need: "any"`, and gets 403 "this token has no text access" on `read`; the same token with no grants gets 403 on `any`; a `read` token with `text` gets 403 "this token cannot generate" on `generate` (Review Focus 1); a `write`+`generate` token passes `generate` while `regenerate` is held and gets 403 "does not hold regenerate in deDE" the moment the grant is removed from the mock (Review Focus 2); the existing read/write cases pass with `need`.
- [ ] **Step 2: Run them.** `pnpm --dir apps/web vitest run src/lib/text-api/guard.test.ts`. Expected: FAIL on the new cases.
- [ ] **Step 3: Implement** the guard and move the call sites.
- [ ] **Step 4: Run** the guard test and `src/app/api/v1` (`pnpm --dir apps/web vitest run src/app/api/v1 src/lib/text-api`). Expected: PASS.
- [ ] **Step 5: Commit.** `feat(api): the token guard checks text or regenerate per route`

### Task 3: People create generate tokens on their profile

**Files:**
- Modify: `apps/web/src/app/api/profile/tokens/route.ts`, `apps/web/src/app/[lang]/profile/page.tsx`, `apps/web/src/components/ApiTokenSection.tsx`, `apps/web/src/components/ApiTokenTable.tsx`, `docs/contributors/TEXT-API.md` (*Getting a token*)
- Test: `apps/web/src/app/api/profile/tokens/route.test.ts`

**Interfaces:**
- Consumes: Task 1's `createToken`, `isTokenAccess`.
- Produces:
  - `POST /api/profile/tokens` body `{lang, access: "none"|"read"|"write", generate?: boolean, label, expiresAt}`. 400 `"a token must read, write or generate"` for `none` without `generate`; 400 when `generate` is present and not a boolean; 403 unless `can(text)` for access read/write and `can(regenerate)` for generate, both in `lang`.
  - `type TokenLang = { lang: Lang; text: boolean; generate: boolean }` exported from `ApiTokenSection.tsx`; the component takes `langs: TokenLang[]`.
  - The profile page shows the section when `langsWhere(viewer, "text")` or `langsWhere(viewer, "regenerate")` is non-empty, and loads tokens then.
  - Form: the Access select offers "No text", "Read", "Read and write", the last two only for a language with `text`; a "Generate audio on my key" checkbox, enabled only for a language with `generate`; Create is disabled while access is "No text" and the box is unticked. Each listed token shows its access and "generate" when set; `ApiTokenTable` (admin) shows the same.
  - The section's paragraph says a generate token spends the owner's own ElevenLabs or fish.audio key, and stops working when the owner loses `regenerate`.

- [ ] **Step 1: Write the failing tests** in `route.test.ts` (session and grants mocked as the file does): with only `regenerate` in deDE, `{access:"none", generate:true}` is 200 with `row.generate` true, and `{access:"read"}` is 403; with only `text`, `{access:"read", generate:true}` is 403; `{access:"none"}` alone is 400; with both grants, `{access:"write", generate:true}` is 200.
- [ ] **Step 2: Run them.** `pnpm --dir apps/web vitest run src/app/api/profile/tokens/route.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** the route, page, form, list badge, admin table and doc paragraph.
- [ ] **Step 4: Run them** and `pnpm --dir apps/web typecheck`. Expected: PASS. In the Paseo browser tab on `spoken_dev`, as a user with `regenerate` but not `text`: the section shows, only "No text" is offered, a generate token is created and listed with "generate".
- [ ] **Step 5: Commit.** `feat(api): create generate-only tokens from the profile`

### Task 4: Batch planning is shared, and a dry run prices it

**Files:**
- Create: `apps/web/src/lib/generation/batch-plan.ts`
- Modify: `apps/web/src/app/api/regenerate/queue/route.ts` (calls the new module; keeps its body format and responses), `apps/web/src/lib/activity/kinds.ts` (`batch.queued` detail gains `apiTokenId?: string`)
- Test: `apps/web/src/lib/generation/batch-plan.test.ts`; `apps/web/src/app/api/regenerate/queue/route.test.ts` must still pass unchanged

**Interfaces:**
- Produces, in `batch-plan.ts`:
  - `type Plan = { jobs: QueueEntry[]; matched: number; dropped: Record<string, number>; unknown: string[] }`. `dropped` counts matched lines that did not become jobs, by reason (`batchPlan`'s reasons for quests; `"no-text"` and `"not-generatable"` for the catalogues; `"hidden"` for a quest item the Explorer's default view leaves out, such as an ignored line). `unknown` holds ids found nowhere (quests as `id` or `id#variant` when variant > 0).
  - `linesForItems(lines: readonly CorpusLine[], items: readonly { id: string; variant: number }[]): { lines: CorpusLine[]; unknown: string[] }`: pure; a line matches when `baseLineId(line.lineId) === id` and `(line.variant ?? 0) === variant`.
  - `planQuestsByFilters(filters: string, lang: Lang, provider: Provider): Promise<Plan>`: today's quests derivation from the queue route, moved; jobs of voices in `pinnedVoices(lang)` carry `provider: "fish"` unless `provider` is already fish.
  - `planQuestsByItems(items, lang, provider): Promise<Plan>`: the corpus narrowed by `linesForItems`, then `matchingLines` with `filtersFromParams(new URLSearchParams(), lang)` (the default view), then `batchPlan`, pinned as above.
  - `planCatalogue(section: "places" | "readables" | "bosses", ids: string[], lang: Lang): Promise<Plan>`: today's three `queue*` functions' lookups, moved.
  - `queuePlan(args: { plan: Plan; section: Source; lang: Lang; userId: string; provider: Provider; label: string; tokenId?: string }): Promise<{ batchId: string; queued: number; alreadyQueued: number } | Response>`: 400 `{error: "nothing to regenerate", kind: "bad-request", unknown}` for no jobs; when a job's provider is `fish` and `provider` is not, `requireApiKey(userId, "fish")`'s 428; then `createBatch`, `enqueue`, `recordActivity("batch.queued", detail {batchId, label, count, apiTokenId?})`, `queueWorker()?.nudge()`. The queue route maps `alreadyQueued` back to its `skipped` field.
  - `estimatePlan(plan: Plan, userId: string, lang: Lang, provider: Provider): Promise<Partial<Record<Provider, Estimate>>>`: jobs grouped by `job.provider ?? provider`, each priced with `estimate(jobs, rate)`, the rate `observedRate(preference.elevenlabs.modelId)` or `observedFishRate(preference.fish.model, lang)` from `readPreference(userId, lang)`.

- [ ] **Step 1: Write the failing tests** in `batch-plan.test.ts`:
  - `linesForItems` over hand-built lines `q:5:accept` (variant 0), `q:5:accept~orc-male` (variant 0), `q:5:accept` (variant 1), `q:6:accept`: item `{id:"q:5:accept", variant:0}` returns the first two lines (Review Focus 4); `{id:"q:9:accept", variant:0}` lands in `unknown`; `{id:"q:5:accept", variant:1}` returns only the variant-1 line.
  - `queuePlan` with `createBatch`/`enqueue` mocked and `requireApiKey` mocked to deny fish: a plan holding one `provider: "fish"` job and `provider: "elevenlabs"` returns a 428 Response and `createBatch` was not called (Review Focus 3); an empty plan returns 400 without `createBatch`; a valid plan records `batch.queued` with `apiTokenId` when `tokenId` is passed.
  - `estimatePlan` with `observedRate` mocked to `{rate: 0.5, samples: 10, modelId: "m"}` and two jobs of 100 and 50 characters on different files returns `elevenlabs.characters === 150`, `elevenlabs.credits === 75`; with one job marked fish it returns both keys.
- [ ] **Step 2: Run them.** `pnpm --dir apps/web vitest run src/lib/generation/batch-plan.test.ts`. Expected: FAIL, module not found.
- [ ] **Step 3: Implement** `batch-plan.ts`, then reduce `/api/regenerate/queue` POST to guard, `requireSpeaker`, body parsing, the matching `plan*` call and `queuePlan`.
- [ ] **Step 4: Run** the new test and `src/app/api/regenerate/queue`. Expected: PASS, with the bosses route test unchanged.
- [ ] **Step 5: Commit.** `refactor(generation): plan and queue batches in one module`

### Task 5: `POST /api/v1/<section>/generate`, and `GET /api/v1/<section>/reference`

**Files:**
- Create: `apps/web/src/app/api/v1/[section]/generate/route.ts`, `apps/web/src/app/api/v1/[section]/reference/route.ts`
- Modify: `apps/web/src/lib/text-api/types.ts` (`ReferenceItem`), `apps/web/src/lib/text-api/respond.ts` (`toReference`), `apps/web/src/app/api/v1/route.ts`, `docs/contributors/TEXT-API.md` (new sections *Reference text* and *Generating audio*; the intro's "Nothing here makes audio or spends credits" becomes true of text routes only)
- Test: `apps/web/src/app/api/v1/[section]/generate/route.test.ts`, `apps/web/src/app/api/v1/[section]/reference/route.test.ts`, `apps/web/src/app/api/v1/route.test.ts`

**Interfaces:**
- Consumes: Task 2's `requireToken({need})`, Task 4's `plan*`, `queuePlan`, `estimatePlan`; `requireSpeaker`, `readPreference`, `readApiKey`, `ensureQueueRunning`.
- Produces:
  - `type ReferenceItem = { id: string; variant?: number; text: string | null; override?: string | null; short?: string | null; name: string | null; group: TextItem["group"] }` and `toReference(item: TextItem): ReferenceItem`.
  - `GET /api/v1/{section}/reference`: `requireToken({need: "any"})`, `sectionOf`, `parseList`, `api.list(BASE_LANG, …)`; returns `{lang: "enUS", items: ReferenceItem[], nextCursor}`; `BadCursor` → 400.
  - `POST /api/v1/{section}/generate`: `requireToken({need: "generate"})`, `ensureQueueRunning()`. Body keys `items`, `filters` (quests only), `label` (string, 1 to 100, default `"API request"`), `dryRun` (boolean); any other key, both or neither of `items`/`filters`, an empty or over-`MAX_ITEMS` `items`, an item without a string `id`, a `variant` outside quests or failing `isVariant` → 400. Dry run: `{dryRun: true, provider, files, characters, matched, dropped, unknown, estimate, missingKeys: Provider[]}`, `provider` from `readPreference`, `missingKeys` the providers the plan's jobs use whose `readApiKey` is null or unreadable. Otherwise `requireSpeaker(userId, lang)` (its 428 as is), then `queuePlan({…, tokenId})`, returning `{batchId, queued, alreadyQueued, matched, dropped, unknown}`.
  - Self-description: `token: {lang, access, generate}`; endpoints `GET /api/v1/{section}/reference`, `POST /api/v1/{section}/generate`; `limits.itemsPerGeneration: MAX_ITEMS`; the "nothing here makes audio" note rewritten to say only `generate` makes audio, on the owner's key, and that a done line asked for again is paid for again.

- [ ] **Step 1: Write the failing tests.**
  - `reference/route.test.ts` (fixtures from `text-api/testing.ts`, grants mocked): a generate-only token with `regenerate` in `koKR` gets 200 for `places?zone={fixtures.map}` with the fixture's English text and `lang: "enUS"`, and no `version` key on items; a `read` token in a language with no rows of its own (`jaJP` row inserted with `asSystem`) gets the same English items; `?lang=deDE` is 400; a token whose owner holds nothing is 403.
  - `generate/route.test.ts` (`createBatch`/`enqueue` mocked, `requireSpeaker` mocked to pass, tokens in `enUS` with `regenerate` mocked): `bosses` with `items: [{id: fixtures.boss.lineId}]` queues one job and returns `batchId`; `dryRun: true` returns `files: 1`, an `estimate.elevenlabs` and no `createBatch` call; a `read` token is 403 and `enqueue` uncalled (Review Focus 1); `filters` on `places` is 400; 1001 items is 400; `{items: [{id: "z:-1"}]}` is 400 "nothing to regenerate" with `unknown: ["z:-1"]` and no `createBatch` call; `requireSpeaker` mocked to 428 returns 428 and no batch.
  - `route.test.ts`: the description lists both new endpoints and `token.generate`.
- [ ] **Step 2: Run them.** `pnpm --dir apps/web vitest run src/app/api/v1`. Expected: FAIL, 404 on the new routes.
- [ ] **Step 3: Implement** the two routes, the projection, the description and the doc sections. The doc's *Generating audio* gives a curl for a dry run and for a quests `filters` run, says the body's `filters` is the query string of an Explorer URL in the language, and lists the drop reasons.
- [ ] **Step 4: Run them**, then `pnpm --dir apps/web typecheck`. Expected: PASS.
- [ ] **Step 5: Commit.** `feat(api): English reference text and generation through a token`

### Task 6: Watching and stopping a generation

**Files:**
- Create: `apps/web/src/lib/generation/batch-status.ts`, `apps/web/src/app/api/v1/generations/route.ts`, `apps/web/src/app/api/v1/generations/[batchId]/route.ts`, `apps/web/src/app/api/v1/generations/[batchId]/stop/route.ts`
- Modify: `apps/web/src/app/api/v1/route.ts`, `docs/contributors/TEXT-API.md` (*Generating audio*: watching and stopping)
- Test: `apps/web/src/lib/generation/batch-status.test.ts`, `apps/web/src/app/api/v1/generations/route.test.ts`

**Interfaces:**
- Consumes: Task 2's guard with `need: "generate"`; `cancelPending`, `createBatch`, `enqueue`, `queryAs`, `isUuid`.
- Produces:
  - `type BatchStatus = { batchId: string; label: string; section: Source; createdAt: string; stoppedAt: string | null; stoppedBecause: string | null; counts: Record<JobState, number>; credits: number; costUsd: number; finished: boolean }`, `finished` meaning no job pending or running.
  - `listOwnBatches(userId: string, lang: Lang, limit = 50): Promise<BatchStatus[]>`, newest first, one grouped query through `queryAs(lang, …)`.
  - `ownBatch(batchId: string, userId: string, lang: Lang): Promise<(BatchStatus & { failures: { lineId: string; message: string }[] }) | null>`, at most 100 failures, newest first; null for another owner's or another language's batch.
  - `GET /api/v1/generations` → `{batches}`; `GET /api/v1/generations/{batchId}` → the batch, 404 `"no such generation"` for a non-uuid or null; `POST /api/v1/generations/{batchId}/stop` → same 404, else `cancelPending("Stopped through the API", {batchId, langs: [lang], by: userId})` and `{cancelled}`.
  - Self-description lists the three endpoints and says batches are kept 30 days.

- [ ] **Step 1: Write the failing tests.**
  - `batch-status.test.ts`: two batches for user A in `koKR` with unique file prefixes (one job each, then one cancelled through `cancelPending`), one batch for user B: `listOwnBatches(A, "koKR")` returns A's two, newest first, with `counts.cancelled` 1 on the stopped one; `ownBatch(B's id, A, "koKR")` is null; `ownBatch(A's id, A, "deDE")` is null (Review Focus 5). `afterEach` cancels pending jobs and deletes the batches.
  - `generations/route.test.ts`: a generate token gets its batch with `counts.pending` 1, then `POST …/stop` returns `cancelled: 1` and a second read shows `finished: true`; another user's batch id is 404 on both; `not-a-uuid` is 404; a `read` token is 403.
- [ ] **Step 2: Run them.** `pnpm --dir apps/web vitest run src/lib/generation/batch-status.test.ts src/app/api/v1/generations`. Expected: FAIL, module not found.
- [ ] **Step 3: Implement** the store, the three routes, the description and the doc paragraph.
- [ ] **Step 4: Run** them and `pnpm --dir apps/web test` on `spoken_ci_pin`, then `make lint`. Expected: PASS. In the Paseo tab on `spoken_dev`, with a generate token and the owner's key set: a dry run for one place returns an estimate, and nothing appears in the regeneration panel.
- [ ] **Step 5: Commit.** `feat(api): read and stop a generation through a token`
