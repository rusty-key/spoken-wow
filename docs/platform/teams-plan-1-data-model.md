# Teams plan 1: data model and isolation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every per-team row belongs to a team, and Postgres row-level security keeps each team's rows to itself, with one team per language so nothing visible changes.

**Architecture:** New `team` and `team_language` tables, seeded one team per group of maintainers. Every per-team table gains `teamId`, filled from a transaction-local setting `spoken.team` that `withTeam()` in `lib/db.ts` sets. In phase 1 a request's team is the privileged team of the language it works in (`teamOf(lang)`), so routes and pages keep their signatures. RLS policies on a non-owner role `spoken_app` make a query outside `withTeam` see nothing.

**Tech Stack:** Postgres 16 plain-SQL migrations (`apps/web/migrations`, `deploy/web/bin/migrate.sh`), node-postgres, Next.js app in `apps/web`, Vitest.

**Spec:** [`TEAMS.md`](TEAMS.md), phase 1. This is plan 1 of 4. Plans 2–4 (roles and text maintainers, text layer and report routing, Release) build on it.

## Global Constraints

- Invisible: same pages, same edit behaviour, same pack folders, no lost take. Every existing test keeps passing.
- Migrations are additive while the previous release still runs (`deploy/web/README.md:262-270`). Anything that drops or re-keys ships in a later deploy (Task 9).
- Migration numbers continue from `0086_take_encoding.sql`.
- Per-team tables (spec, "What is per team"): `take`, `recording`, `take_ack`, `voice`, `voice_assignment`, `voice_clone`, `voice_sample`, `fish_reference`, `generation_setting`, `generation_setting_locale`, `pronunciation_lexicon`, `pronunciation_lexicon_locale`, `lexicon_change`, `line_override`, `line_ignore`, `line_flag`, `line_issue`, `line_issue_line`, `report`, `regeneration_batch`, `regeneration_job`, `regeneration_pause`, `queue_dismissal`, `activity`.
- Shared, never team-scoped: game data and text, `npc*`, `race`/`gender`/`flavor`, `contribution*`, `missing_audio_hit`, users and auth, `elevenlabs_key`, `fish_key`, `generation_preference*`, `take_encoding`, `language`, `language_grant` (plan 2 changes grants).
- Rows that are site-wide today keep `teamId` null: `line_ignore` with null `lang`, `activity` with null `lang`.
- Suites run on `spoken_ci_pin`, never `spoken_dev` (some tests delete whole languages). Queue tests on `spoken_queue_test`.
- Long-running scripts print per-item progress and a summary.
- Pack builds, `release-packs.yaml` and pipelines connect as the owner and bypass RLS; any of them that reads per-team rows filters by the language's privileged team.

## Review Focus

1. **A language enabled after the migration** (`lib/languages/store.ts`) has no team, so `teamOf` would throw and its pages 500. Expected: enabling a language with no team gives it to the English team. Test in Task 2.
2. **A pooled connection carrying one team's setting into the next checkout.** Expected: after `withTeam` returns or throws, the same connection reports no team. Test in Task 3.
3. **Signed-out requests:** the explorer, audio routes and the addon's report endpoint have no session. Expected: they resolve the team from the language and see exactly today's rows. Test in Task 6 (reports) and Task 10 (smoke).
4. **The queue across teams:** the worker claims from every team and must run each job, including `commitTake`, under that job's team; pausing deDE must not pause another team's deDE (phase 2) or any other language. Test in Task 5.
5. **An insert that misses `withTeam` before RLS is on** writes `teamId` null. Expected: Task 9 backfills from `lang` and then sets not null, and Task 10's suite as `spoken_app` fails loudly on any remaining path. Test in Task 9.

---

### Task 1: Team tables and seeding

**Files:**
- Create: `apps/web/migrations/0087_team.sql`
- Create: `deploy/web/bin/team-grouping.sql` (read-only preview of the grouping)
- Test: `apps/web/src/lib/teams/seed.test.ts`

**Interfaces:**
- Produces: tables `team ("id" uuid pk default gen_random_uuid(), "slug" text unique, "name" text, "createdAt")` and `team_language ("teamId" uuid references team on delete cascade, "lang" text, "privileged" boolean not null default true, primary key ("teamId","lang"))`, with unique index `team_language_privileged_idx on team_language ("lang") where "privileged"`. `slug` checked `^[a-z][a-z0-9-]{1,40}$`; `lang` checked `^[a-z]{2}[A-Z]{2}$`.

Seeding, in the migration, deterministic:
- The languages are `language.code` plus every distinct `take.lang`.
- A language's key is the sorted array of `userId`s holding `edit`, `regenerate`, `configure`, `ignore` or `admin` in it in `language_grant` (`record` alone does not make a maintainer).
- enUS, and every language with an empty key, go to one team: slug `english`, name `English`.
- Remaining languages are grouped by equal key. Each group is one team, slug the lower-cased codes joined by `-` in code order (`eses-esmx`), name the codes joined by ` + `.
- Every `team_language` row is privileged.

`team-grouping.sql` runs the same CTE without writing and prints team slug, languages and member emails, so the site owner can confirm the grouping against production (`psql $PROD_DATABASE_URL -f deploy/web/bin/team-grouping.sql`) before deploying.

- [ ] **Step 1: Write `seed.test.ts`**: after migration, every `language.code` and every `take.lang` has exactly one privileged team; enUS's team has slug `english`; two languages share a team only if their key arrays are equal and non-empty.
- [ ] **Step 2: Run it, expect FAIL** (`relation "team" does not exist`): `DATABASE_URL=postgres:///spoken_ci_pin pnpm --filter @spoken/web exec vitest run src/lib/teams/seed.test.ts`
- [ ] **Step 3: Write `0087_team.sql` and `team-grouping.sql`.** Then apply: `DATABASE_URL=postgres:///spoken_ci_pin deploy/web/bin/migrate.sh $PWD/apps/web`
- [ ] **Step 4: Run the test, expect PASS.** Also run `psql postgres:///spoken_ci_pin -f deploy/web/bin/team-grouping.sql` and check the output reads sensibly.
- [ ] **Step 5: Commit** `feat(teams): team tables, seeded one per maintainer group`

### Task 2: `teamOf` and new languages

**Files:**
- Create: `apps/web/src/lib/teams/store.ts`
- Modify: `apps/web/src/lib/languages/store.ts` (`setEnabled`, line 44)
- Test: `apps/web/src/lib/teams/store.test.ts`

**Interfaces:**
- Produces:
  - `type TeamId = string` (uuid).
  - `teamOf(lang: Lang): Promise<TeamId>`: the privileged team of `lang`. It throws `NoTeamError` if there is none. Memoised in-process for 60 s, because two pm2 workers cannot share an invalidation.
  - `teamLangs(): Promise<Map<Lang, TeamId>>`
  - `allTeams(): Promise<TeamId[]>`
  - `forgetTeams(): void`

- [ ] **Step 1: Write tests:**
  - `teamOf("enUS")` equals the `english` team's id.
  - `teamOf` for a code with no `team_language` row rejects with `NoTeamError`.
  - After `setEnabled(code, true, userId)` (`languages/store.ts:44`) enables a code with no team, `teamOf(code)` returns the `english` team (Review Focus 1).
- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement `store.ts`.** In `setEnabled`, in the same statement batch as its upsert, insert `team_language (english team, code, true) on conflict do nothing` when no privileged row exists, then `forgetTeams()`.
- [ ] **Step 4: Run, expect PASS.**
- [ ] **Step 5: Commit** `feat(teams): resolve a language's team`

### Task 3: `withTeam` in `lib/db.ts`

**Files:**
- Modify: `apps/web/src/lib/db.ts`
- Test: `apps/web/src/lib/db.test.ts` (create if absent)

**Interfaces:**
- Consumes: `TeamId` from Task 2.
- Produces:
  - `ALL_TEAMS = "*"`, for system work only: the queue leader's claim, site-owner views, cross-team pipelines invoked from the app.
  - `withTeam<T>(team: TeamId | typeof ALL_TEAMS, work: (client: PoolClient) => Promise<T>): Promise<T>`: `inTransaction` plus a first statement `select set_config('spoken.team', $1, true)`.
  - `queryIn<T>(team, text, params?): Promise<T[]>`
  - Pool config reads `DATABASE_ROLE`: when set, pass `options: "-c role=<value>"` so tests and CI act as `spoken_app` (Task 10).

Convention for every store from Task 5 on: a function that already accepts an optional `client` uses it as is (its caller set the team); otherwise it runs its body in `withTeam(await teamOf(lang), …)`.

- [ ] **Step 1: Write tests:**
  - Inside `withTeam(id)`, `current_setting('spoken.team', true)` equals `id`.
  - When `work` throws, the error propagates and the transaction is rolled back (insert a row, throw, row absent).
  - Review Focus 2: 40 sequential `withTeam` calls, then 40 `db().query("select current_setting('spoken.team', true) as t")`. Every `t` is `''` or null. 40 exceeds `POOL_MAX` 30, so connections are reused.
- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run, expect PASS.**
- [ ] **Step 5: Commit** `feat(db): withTeam sets a transaction-local team`

### Task 4: Expand migration, `teamId` on every per-team table

**Files:**
- Create: `apps/web/migrations/0088_team_scope.sql`
- Test: `apps/web/src/lib/teams/scope.test.ts`

For each table in Global Constraints:
- `add column "teamId" uuid references "team" ("id")`, nullable for now.
- `alter column "teamId" set default nullif(nullif(current_setting('spoken.team', true), ''), '*')::uuid`, so an insert inside `withTeam` fills it without the SQL naming it.
- Backfill:
  - From `lang` via the privileged `team_language`.
  - `voice_sample`: from the language in its clone name (`split_part("clone", '@', 2)`, empty meaning enUS).
  - `line_issue_line`: from its issue.
  - `voice`, `voice_assignment`, `generation_setting`, `pronunciation_lexicon`, `queue_dismissal`: no `lang` column; set to the `english` team.
  - Null-`lang` rows of `line_ignore` and `activity` stay null.
- Beside each existing unique key, a new unique index with `"teamId"` first. The old keys stay until Task 9.
  - `take_current_idx` gets `take_team_current_idx ("teamId","source","lang","file") where "isCurrent"`.
  - The same pattern applies to `take_ack_lang_idx`, `voice_clone_lang_idx`, `line_issue_lang_idx`, `line_ignore_scope_idx`, `regeneration_job_one_per_lang_file`, `voice_assignment_key_idx`, and the primary keys of `fish_reference`, `generation_setting_locale`, `pronunciation_lexicon_locale`, `line_flag`, `line_override`, `regeneration_pause`, `voice_sample` and `voice`.
- An index on `"teamId"` where a table has no unique key leading with it.

- [ ] **Step 1: Write `scope.test.ts`:**
  - Every row of every listed table has a non-null `teamId`, except the two null-`lang` cases.
  - `teamId` equals the privileged team of its `lang`.
  - An insert into `take` inside `withTeam(t)` without naming `teamId` gets `t`.
- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Write the migration and apply it to `spoken_ci_pin`.**
- [ ] **Step 4: Run the test and the full web suite, expect PASS.** Run: `DATABASE_URL=postgres:///spoken_ci_pin pnpm --filter @spoken/web test`
- [ ] **Step 5: Commit** `feat(teams): teamId on every per-team table`

### Task 5: Takes, recordings, acks and the queue run under a team

**Files:**
- Modify: `lib/takes/store.ts`, `lib/takes/commit.ts`, `lib/recordings/store.ts`, `lib/generation/queue.ts`, `lib/generation/worker.ts`, `lib/generation/dirty.ts`, `lib/generation/calibration.ts`, `lib/quests/staleness.ts`, `lib/quests/dirtiness.ts`, `lib/places/catalogue.ts`, `lib/readables/catalogue.ts`, `lib/contributions/missing-audio.ts`, `lib/quests/context.ts` (all under `apps/web/src`)
- Test: beside each, extending the existing `*.test.ts`. The queue test runs on `spoken_queue_test`.

**Interfaces:**
- Consumes: `withTeam`, `queryIn`, `ALL_TEAMS`, `teamOf`.
- Produces:
  - `QueueJob` gains `teamId: TeamId`.
  - `claimNext` runs in `withTeam(ALL_TEAMS)`. Its pause check matches `("teamId","lang")` against `regeneration_pause`.
  - The worker runs each job body in `withTeam(job.teamId)`.
  - `pauseQueue(langs)` and `resumeQueue(langs)` pause each language's team.
  - `dismissThrough(jobId, userId, lang)` gains `lang`.

Every exported function keeps its current parameters except where named here. Each runs per the Task 3 convention. Every `on conflict` target gains `"teamId"` to match the Task 4 indexes: `dirty.ts:193`, `queue.ts:208,486,571`.

- [ ] **Step 1: Write tests:**
  - A job enqueued for deDE reaches `commitTake` with `current_setting('spoken.team')` equal to `teamOf("deDE")`.
  - `pauseQueue(["deDE"])` holds back deDE jobs only.
  - `liveTakes("quests","deDE")` returns the same files as before the change. Compare against the pre-change query, captured in the test as plain SQL filtered by `lang`.
- [ ] **Step 2: Run, expect FAIL** (`teamId` missing on `QueueJob`).
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run the web suite (queue tests on `spoken_queue_test`), expect PASS.**
- [ ] **Step 5: Commit** `feat(teams): takes and queue run under the language's team`

### Task 6: Voices, settings, lexicon, lines, reports, activity

**Files:**
- Modify (all under `apps/web/src`):
  - `lib/voices/roster-store.ts`, `lib/voices/types-store.ts`, `lib/voices/clones.ts`, `lib/voices/samples.ts`, `lib/voices/references.ts`
  - `lib/generation/settings.ts`, `lib/generation/dictionary.ts`
  - `lib/quests/overrides.ts`, `lib/quests/ignores.ts`
  - `lib/reports/store.ts`, `lib/reports/contribute.ts`
  - `lib/activity/store.ts`
  - their callers in `app/[lang]/voices/page.tsx` and `app/api/voices/**`
- Test: the existing `*.test.ts` beside each

**Interfaces:**
- Produces:
  - `loadRoster(lang: Lang)`: was argument-less; the roster becomes per team.
  - `assignVoice(…, lang)` gains `lang`.
  - `addType`, `deleteType`, `addGender`, `addFlavor`, `deleteFlavor` change `voice` rows for every team in one `withTeam(ALL_TEAMS)` transaction, because race types are shared.
  - `readOverrides(lang)` already takes `lang`. `writeOverride` and `clearOverride` gain `lang`; today they are English only, so callers pass `BASE_LANG`.
  - `recordActivity` and `recordActivities` resolve the team from `lang`, null for null.
  - `listActivity` for one language runs in that team. The site-wide view runs in `ALL_TEAMS` and is only reachable by global admins, as today.
  - `createReport` resolves from its `lang`, so the anonymous addon endpoint works unchanged (Review Focus 3).

`generation_setting` and `pronunciation_lexicon` stay single-row per team, not folded into the `_locale` tables. *My call:* folding is a cleanup with no visible effect, and it would rewrite `settings.ts`/`dictionary.ts` for no phase-1 gain. `ELEVENLABS_DICTIONARY_ID` keeps feeding the English team's row.

`on conflict` targets gaining `"teamId"`:
- `ignores.ts:107`
- `overrides.ts:86`
- `samples.ts:174`
- `clones.ts:59`
- `types-store.ts:102,110`
- `settings.ts:243,291`
- `dictionary.ts:211,217`
- `references.ts:262`
- `reports/store.ts:191`

- [ ] **Step 1: Write tests:**
  - `createReport` with no session and `lang: "frFR"` stores `teamId = teamOf("frFR")`.
  - `assignVoice` for deDE does not change enUS's assignment once two teams exist (create a test team with `team_language` for deDE only, not privileged elsewhere).
  - `recordActivity({lang: null})` stores a null team.
- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run the web suite, expect PASS.**
- [ ] **Step 5: Commit** `feat(teams): voices, settings, lines, reports and activity under a team`

### Task 7: Pipelines and pack scripts filter by team

**Files:**
- Modify:
  - `pipelines/quests/tts_cli/corpus_db.py` (voice seeding)
  - `pipelines/places/tools/voice/store.mjs`, `pipelines/places/tools/bosses/store.mjs`
  - `pipelines/readables/tools/lib/lookup.mjs`
  - `scripts/audio/fetch-encodings.mjs`, `scripts/audio/sounds.mjs`, `scripts/audio/acted.mjs`
- Test: the existing tests beside them (`uv run pytest` in `pipelines/quests`, `node --test` for scripts)

Changes:
- Voice seeding inserts a `voice`/`voice_assignment` row for every team: `select t."id", … from "team" t … on conflict do nothing`. These scripts connect as the owner, so the column default is null and `teamId` must be named.
- Readers of `take` add `and "teamId" = (select "teamId" from "team_language" where "lang" = $lang and "privileged")`.
- `absorb.mjs` stays as it is: it must rewrite every team's rows.

- [ ] **Step 1: Extend tests:** seeding a new race inserts one voice row per team; `fetch-encodings` against a DB holding a second, non-privileged team's deDE take ignores it.
- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run `uv run pytest` in `pipelines/quests` and `node --test scripts`, expect PASS.**
- [ ] **Step 5: Commit** `feat(teams): pipelines and pack scripts read the privileged team`

### Task 8: First deploy checkpoint

No code. Tasks 1–7 ship together as deploy 1.

- [ ] **Step 1:** Run `make lint`, the web typecheck, `pnpm --filter @spoken/web test` on `spoken_ci_pin`, `next build`, and `uv run pytest` in `pipelines/quests`. All must pass.
- [ ] **Step 2:** Rehearse on a production copy: `make db-pull`, then `migrate.sh` against `spoken_prod_rehearsal`, then the `scope.test.ts` assertions as SQL. Paste the grouping output from `team-grouping.sql` for the user to confirm before deploying.
- [ ] **Step 3: Commit** any fixes, then open the PR.

### Task 9: Contract migration (deploy 2)

**Files:**
- Create: `apps/web/migrations/0089_team_contract.sql`
- Test: `apps/web/src/lib/teams/contract.test.ts`

Changes, in order:
1. Backfill any `teamId` still null from `lang`, as in Task 4. This catches inserts that missed `withTeam` while deploy 1 ran (Review Focus 5).
2. Set `teamId` not null everywhere except the two null-`lang` cases.
3. Drop the old unique keys and primary keys listed in Task 4, and promote the team-first indexes to primary keys where the old key was one. `voice_assignment.voice` becomes a composite foreign key `("teamId","voice") references voice ("teamId","name")`.
4. Copy the roster to every team other than `english`: `voice` and `voice_assignment` rows, plus `queue_dismissal` (one row per team, keyed by `teamId`).
5. Re-key `generation_setting` and `pronunciation_lexicon` from `"id" boolean` to `"teamId"`.

- [ ] **Step 1: Write tests:**
  - No null `teamId` outside the two cases.
  - Each team has the same roster names as `english`.
  - An insert into `take` with null `teamId` fails.
- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Write and apply.** Update the `on conflict` targets in Tasks 5–6 that still name `"id"`.
- [ ] **Step 4: Run the full web suite, expect PASS.**
- [ ] **Step 5: Commit** `feat(teams): contract the team keys`

### Task 10: Row-level security and the app role (deploy 2)

**Files:**
- Create: `apps/web/migrations/0090_team_rls.sql`
- Modify:
  - `.github/workflows/ci.yaml` (test step env `DATABASE_ROLE: spoken_app`)
  - `apps/web/vitest.config.ts` (default `DATABASE_ROLE=spoken_app` when unset)
  - `deploy/web/bootstrap.sh`
  - `deploy/web/README.md` (runbook below)
  - `deploy/web/ecosystem.config.js` (the app's `DATABASE_URL` is the `spoken_app` login; migrations keep the owner)
- Test: `apps/web/src/lib/teams/rls.test.ts`, plus the whole suite run as `spoken_app`

Migration:
- Create role `spoken_app nologin` if missing.
- Grant it usage on the schema, DML on all tables, and usage on sequences. Add default privileges for future tables.
- SQL functions `spoken_team() returns uuid` (setting parsed, null for `''` or `*`) and `spoken_all_teams() returns boolean` (setting is `*`).
- On every per-team table, `enable` and `force row level security`, with policy `team_isolation`:
  - `using ("teamId" = spoken_team() or spoken_all_teams())`
  - `with check (same)`
- For `line_ignore` and `activity`, `using` additionally allows `"teamId" is null`. `with check` allows null only under `spoken_all_teams()`.

Runbook, for the user to run on the droplet:
1. `alter role spoken_app login password …`
2. Put the app's URL in the secrets read by `ecosystem.config.js`.
3. Restart pm2.

The secret value and the restart are the user's to do.

- [ ] **Step 1: Write `rls.test.ts`**, run as `spoken_app`:
  - Create a second team holding deDE as non-privileged. Insert a take under it.
  - `liveTakes("quests","deDE")` (privileged team) does not include it.
  - `db().query('select count(*) from take')` outside `withTeam` returns 0.
  - The site-wide `listActivity` sees null-team rows.
- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Write and apply the migration.**
- [ ] **Step 4: Run the whole web suite with `DATABASE_ROLE=spoken_app`.** Each failure is a path missing `withTeam`. Fix production code per the Task 3 convention, and test fixtures by wrapping their inserts in `withTeam`. Repeat until it passes. Then `next build`.
- [ ] **Step 5: Smoke as `spoken_app` on `spoken_dev`.** Start the dev server with `DATABASE_ROLE=spoken_app`. Signed out, open `/deDE/quests`, play a take, and post a report. Signed in as an enUS maintainer, open voices, lexicon, activity and the queue. Every page must show what it shows without the role.
- [ ] **Step 6: Commit** `feat(teams): row-level security per team`, then open the deploy-2 PR.
