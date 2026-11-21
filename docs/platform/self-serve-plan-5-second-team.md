# Self-serve plan 5a: a second team in a maintained language

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Approving a request for a language that already has an active team creates a second team beside it, with audio capabilities only and settings either copied from the privileged team or started fresh. Its members voice the language on the site and through generate tokens, isolated from the privileged team. One person works in one team per language.

**Architecture:** A second team is a `team_language` row with `privileged = false`. The team a person works as in a language is derived, not chosen: their membership there, else the privileged team. It reaches the data layer at one point, `ownerOf` in `lib/teams/store.ts`, through which `teamOf`, `ownerOrAll`, `readAs`, `queryAs`, `asTeamOf`, `teamOrEnglish`, `freshOwners` and `byTeam` all resolve. `ownerOf` overlays the acting person's team only for a language that has a second team, so today's languages take the same path as now. The acting person is the session's user, or an explicit scope (`asTeams`/`asActor`) for the queue worker, API token routes and tests. Grants, invites and team activity name their team explicitly, because there the acting person is not always the one the row belongs to.

**Tech Stack:** Postgres 16 plain-SQL migrations (`apps/web/migrations`), node-postgres, Node `AsyncLocalStorage`, Next.js App Router (`apps/web`), Vitest with Testing Library.

**Spec:** [`SELF-SERVE-TEAMS.md`](SELF-SERVE-TEAMS.md), *What approval does* (third row) and *Second team in a language*; [`TEAMS.md`](TEAMS.md), *Roles*, *Who sees what*, *Isolation with row-level security* and *Phase 2*. Builds on [plan 2](self-serve-plan-2-requests.md) (`foundTeam`, `addSecondTeam`, *Notes for plan 5*), [plan 3](self-serve-plan-3-invites.md) and [plan 4](self-serve-plan-4-api.md).

## Scope: plan 5 is split in three

Plan 5 as the spec states it does not fit one reviewable PR. The team itself touches about 130 call sites that resolve a team from a language (measured: `queryAs`, `asTeamOf`, `teamOf`, `readAs`, `ownerOrAll`, `teamOrEnglish`, `byTeam`, `freshOwners` across 35 modules under `apps/web/src/lib`), every per-language memo of team data, the worker, grants and invites. Generalising overrides to places, readables, bosses and entity names is a second change of the same size: a new override store, three catalogue builders, the narrated generation path, staleness per section, four pencils and four text API adapters. The Explorer's team picker needs the public cross-team read of live takes that TEAMS.md designs and nothing builds yet. So *(My call)*:

- **5a (this plan):** the second team exists, is isolated, is managed, and voices every section on its own roster and settings. Its quest overrides already work, because `line_override` is per team. It cannot override place, readable, boss or name text, and its tokens generate but do not read or write text.
- **5b:** per-team overrides for every source, and the text API for a second team. Outline at the end.
- **5c:** the Explorer's team picker. Outline at the end.

Each ships alone. Until 5b, a second team voices the original text in every section but quests; until 5c, each person sees their own team's takes in the Explorer and anonymous visitors see the privileged team's.

## Decisions

- **One team per person per language** (user). Grants stay keyed by person and language; a person's team in a language is whichever team holds their `team_member` rows there. A second membership in the same language is refused at:
  - the database: a constraint trigger on `team_member` (Task 1), the backstop for every writer, `grantOn` in the founding transaction and `move_team_lang` included;
  - a request: `createRequest` (Task 7);
  - approval: `addSecondTeam` (Task 7);
  - a direct grant: `addGrants` (Task 5), which `PUT /api/grants`, `createTeamWithLangs` and `acceptInvite` all go through;
  - invite creation: the existing `invite_open_idx` on `(lang, email)` already allows one open invite per address and language across teams, and a registered address takes the direct-grant path instead of an invite;
  - invite acceptance: `acceptInvite` (Task 6).

  `language_grant` (`text`) has no team and is not limited.
- **Requests already waiting.** Under plan 2 a request for a maintained language is stored, and approving it answers 409 "needs a second team (plan 5)" and leaves it pending (`addSecondTeam` throws inside the approval transaction). Nothing is approved wrongly. Once 5a deploys, those pending requests become approvable as they stand. (code)
- **The team someone works as is derived, never picked** *(My call)*. One team per person per language makes it unique, so no switcher is needed (TEAMS.md: "a header switcher appears only for someone in two teams that share a language"). A site owner who is not a member works as the privileged team; acting inside a second team without joining it is left for 5c's picker.
- **The overlay sits in `ownerOf`, not at every call site** *(My call)*. Threading a team through about 130 call sites and their callers is the explicit alternative; it would touch most of `lib/` for a case that exists in one language. The overlay reads the session only when the language has a second team, so a single-team language never pays for it or behaves differently (spec anti-goal). Its cost is ambience: code that runs as one person on another's behalf (grant writes, invite acceptance, team activity, the worker) must name the team, and this plan lists every such place. This is the design to check first.
- **Token routes opt in** *(My call)*. A request with a bearer token has no session, so the overlay cannot see its owner. `requireToken` refuses a token whose owner works in a second team in the token's language; a route that works for one goes through `withToken`, which runs its work in `asActor(owner)` where the language has a second team. A route nobody converted fails closed (403) instead of writing into the privileged team. In 5a the converted routes are the description, reference, generate and generations routes.
- **Who chooses the starting settings: the site owner, at approval** *(My call)*. Copying exposes the privileged team's private settings (TEAMS.md *Who sees what*) to people who are not in it, which is the site owner's call to make, not a requester's. The default is fresh. The requester can ask for either in the request's note.
- **A second team starts as any new team does** *(user)*: "There shouldn't be any difference. Original text is inherited, but takes and text overrides are not." It reads the shared original text like every team. It never receives the privileged team's takes, recordings or text overrides (`line_override`), whichever start is chosen. *Fresh* is what `adopt_lang` gives a new language today: English's roster, assignments and base settings, no language settings row, no lexicon.
- **What *copy* copies: settings only**, from the schema. The privileged team's roster (`voice`), assignments (`voice_assignment`), base settings (`generation_setting`: model, voice settings, seed strategy, race tags), the language's settings (`generation_setting_locale`) and its lexicon entries (`pronunciation_lexicon_locale.entries`). It does not copy ignores, the lexicon's ElevenLabs dictionary and sync columns (they point into another person's account) or `lexicon_change` *(My call)*. **Voice material is never copied** *(user)*: no `voice_clone`, `voice_sample` or `fish_reference`, so no fish pins. The provider is not a team setting: it is each person's own (`generation_preference`).
- **The text maintainer role is independent of team membership** *(user)*: "The text maintainer role is independent of team membership." Whoever holds `text` in a language sees and handles its text reports and contributions whatever team they act as, and with no team. Contributions already are team-less (`contribution*` has no row-level security). Text reports are `report` rows filed under a team, and today every read goes through `readAs(lang)`, so a maintainer who joins a second team would lose them. Task 8 makes the text queue follow the `text` grant.
- **A second team holds one language, not privileged; its admin gets `admin` and nothing else** (spec: audio capabilities only). Approval does not switch the language (it is on) and does not set `textByTeam`.
- **`canGrant`'s `text` rule narrows to the privileged team's admins** (plan 2, *Notes for plan 5*). `Grant` gains `privileged?: boolean`, false only for a second team's rows.
- **Any number of second teams per language** *(My call)*: each is a site owner's approval, and nothing in the data model counts them.
- **The New team form does not make second teams** *(My call)*. Its language choice still hands a language over. A site owner who wants one approves a request.
- **Activity a site owner's or a joiner's act writes for a second team is filed under that team**: `ActivityEvent` gains `team?: TeamId`, which wins over the lang's owner. *(My call: otherwise approval would file the new admin's `grant.added` in the privileged team's log.)*
- **Releases refuse for a second team** (spec: distribution out of scope). **Splitting a line by the reader's gender refuses for a second team**: it rewrites the original every team voices (TEAMS.md *Text*), and a second team cannot edit the original (spec).
- **`text` alone writes the original text, in every language; overrides stay under `regenerate`** *(user)*. The original is written only under `text` (`language_grant`), never by a team. Overrides are team data, not original text, and keep today's capability, the quest pencil's `regenerate`, for every team, so current teams see no change. This closes the spec's token gap (the token rule wants `text` for every text read and write, and a second team has none): a second team's token reads the original text and writes its team's overrides when its owner holds `regenerate`, and never writes the original. Built in 5b; Task 9 writes it into SELF-SERVE-TEAMS.md now. TEAMS.md *Roles* says a "team-level `edit` … covers the team's text overrides"; that line is superseded, and Task 9 fixes it.
- **Clone names keep their shape** *(My call)*. TEAMS.md *Phase 2* adds the team slug to a second team's clone names, against a clash that needs one person in two teams of one language. One team per person per language prevents it.

## Global Constraints

- One migration, `0113_second_team.sql`: plain SQL, additive, one transaction, applied by `deploy/web/bin/migrate.sh`. A release must run against the schema of the release after it.
- Rolling back past 5a while a second team exists gives its members the privileged team's rows: the older release has no overlay. Accepted *(user)*: the runbook note in Task 9 says so, and no code guards it.
- Tests run as `spoken_app` on `spoken_ci_pin`, never `spoken_dev`. Fish: `set -x DATABASE_URL postgres://localhost/spoken_ci_pin; pnpm --dir apps/web vitest run <file>`. Migrate: `set -x DATABASE_URL postgres://localhost/spoken_ci_pin; deploy/web/bin/migrate.sh $PWD/apps/web`.
- Fixtures: `asSystem`, `testUser`, `dropTeam`, `runningJob` from `src/lib/teams/testing.ts`; languages made fresh per run (`xq` plus two random capitals), never a built-in code. A second team in a fixture is `new_team(…)` plus `insert into "team_language" ("teamId", "lang", "privileged") values ($1, $2, false)` through `asSystem`, then `forgetTeams()`.
- Nothing spends TTS credits: a test that queues cancels its jobs in `afterEach` (`cancelPending`) and deletes the batch.
- Every per-team query goes through `withTeam` / `queryAs` (`lib/db.ts`, `lib/teams/store.ts`). No new table column is named `teamId` unless the table is under row-level security (`rls.test.ts` binds them).
- Exact refusals:
  - One team per language: `` `That person already works on ${langName(lang)} in another team; one person works in one team per language.` `` (409); to a requester, `` `You already work on ${langName(lang)} in ${slug}; one person works in one team per language.` `` (409).
  - Unconverted token route: `"this route does not work for a second team yet"` (403).
  - Release: `"Releases for a second team are not built yet; its takes stay on the site."` (409).
  - Gender split: `"A second team cannot split a line by the reader's gender: that changes the original text every team voices. Ask the language's text maintainers."` (409).
- Browser checks run on `spoken_dev` in the Paseo tab already open, never a new tab.
- Site changes add no changelog notes (AGENTS.md).

## Review Focus

1. **A row the second team's work writes lands in the privileged team.** The ways in: a person acting for another (invite acceptance, approval's grants and activity), the worker, a token route, a memo keyed only by language. Expected: every such row carries the second team's id. Tested in Tasks 2, 3, 4, 5, 6 and 7.
2. **A single-team language changes.** For a language with no second team, `ownerOf` never reads the session and answers what it answers today. Tested in Task 2 with a counting mock.
3. **Two admins grant one person in two teams of one language at once.** Expected: one commit wins, the other fails with 23P01 and the 409 message; the person is in one team. Tested in Task 1.
4. **A second team's admin reaches the privileged team's people.** Listing, removing a capability, resending or revoking an invite of the other team: 403 or 404, nothing changes. Tested in Tasks 5 and 6.
5. **A text maintainer joins a second team.** Expected: the language's text reports still list, count and resolve for them, and they still see none of the privileged team's audio reports. Tested in Task 8. (Copying a lexicon synced to an ElevenLabs dictionary, which leaves `dictionaryId` and the sync columns null, is tested in Task 1.)

---

### Task 1: Migration 0113, one team per person per language and the settings copy

**Files:**
- Create: `apps/web/migrations/0113_second_team.sql`
- Test: `apps/web/src/lib/teams/second-team-schema.test.ts`

**Interfaces:**
- Produces:
  - Function `team_member_one_team()` and `create constraint trigger "team_member_one_team_per_lang" after insert on "team_member" deferrable initially deferred for each row`. It takes `pg_advisory_xact_lock(hashtext('team_member:' || new."userId" || ':' || new."lang"))`, then raises `'% already works on % in another team', new."userId", new."lang"` with `errcode = '23P01'` when a `team_member` row with the same user and language and another `teamId` exists. Deferred so `move_team_lang`'s delete-then-insert passes; locked so two committing transactions cannot both pass (default READ COMMITTED: the second sees the first's row once the lock frees).
  - `"invite"."joinTeamId" uuid references "team" ("id") on delete cascade`, nullable. Null means the language's privileged team, which is what every invite before 0113, and every invite an older release writes, meant.
  - `copy_team_settings(p_from uuid, p_to uuid, p_lang text) returns void`, security invoker: `copy_team_roster(p_from, p_to)`, then `generation_setting_locale` for `p_lang` and `pronunciation_lexicon_locale` (`entries`, `updatedBy` only) from `p_from` to `p_to`, `on conflict do nothing`.
  - A `do` block that raises a notice with the number of `(userId, lang)` pairs already spanning two teams (expected 0).

- [ ] **Step 1: Write the failing tests** in `second-team-schema.test.ts` (fixture language with its adopted team A and a second team B):
  - Inserting `team_member` rows for one user and language in A and in B in one transaction fails at commit with code `23P01`; A alone with two capabilities commits.
  - Two transactions on two clients, one inserting into A and one into B, both reaching `commit` together (`Promise.allSettled`): exactly one fulfils (Review Focus 3).
  - `move_team_lang` of the fixture language from A to a new team C, with a member in A, succeeds (the deferral).
  - `copy_team_settings(A, B, lang)` with A holding one voice, one assignment, a `generation_setting_locale` row and a lexicon row with `dictionaryId = 'd1'`, `syncedDigest = 'x'`: B has the same voice and assignment, the same `modelId`, the same `entries`, and null `dictionaryId`, `versionId`, `syncedDigest` and `syncedAt` (Review Focus 5).
  - An invite inserted without `joinTeamId` reads back null.
- [ ] **Step 2: Run it.** `set -x DATABASE_URL postgres://localhost/spoken_ci_pin; pnpm --dir apps/web vitest run src/lib/teams/second-team-schema.test.ts`. Expected: FAIL, both inserts commit.
- [ ] **Step 3: Write the migration.** A header comment says why the trigger is deferred and locked, and what a null `joinTeamId` means.
- [ ] **Step 4: Migrate and run** it, `src/lib/teams/move.test.ts` and `src/lib/teams/rls.test.ts`. Expected: PASS.
- [ ] **Step 5: Commit.** `feat(teams): one team per person per language, and a settings copy for a second team`

### Task 2: The team someone works as

**Files:**
- Create: `apps/web/src/lib/teams/acting.ts`
- Modify: `apps/web/src/lib/teams/store.ts`
- Test: `apps/web/src/lib/teams/acting.test.ts`, `apps/web/src/lib/teams/store-overlay.test.ts`

**Interfaces:**
- Produces, in `acting.ts` (imports `lib/db`, `lib/session`; never `lib/teams/store`):
  - `memberTeams(userId: string, client?: Pick<ClientBase, "query">): Promise<Map<string, TeamId>>`: `select distinct "lang", "teamId" from "team_member" where "userId" = $1`.
  - `teamIn(userId: string, lang: string, client?): Promise<TeamId | null>`.
  - `asTeams<T>(teams: ReadonlyMap<string, TeamId>, work: () => Promise<T>): Promise<T>`: `AsyncLocalStorage.run`.
  - `asActor<T>(userId: string, work: () => Promise<T>): Promise<T>`: `asTeams(await memberTeams(userId), work)`.
  - `actingTeams(): Promise<ReadonlyMap<string, TeamId>>`: the `asTeams` store when inside one; else, when `await headers()` does not throw, the session user's `memberTeams` (React `cache` per render; no session gives an empty map); else an empty map. Only the `headers()` call is caught, so a database error still throws.
- Produces, in `store.ts`:
  - The memo reads every `team_language` row: the privileged owners as now, plus `secondTeamLangs(): Promise<Set<Lang>>`, the languages with a non-privileged row. `teamLangs()` still returns the privileged map.
  - `ownerOf` and `freshOwners` overlay `actingTeams()` for the requested languages that are in `secondTeamLangs()`, and call it for no other language.
  - `privilegedOf(lang: Lang): Promise<TeamId | undefined>`, the un-overlaid owner; `actsAsSecondTeam(lang: Lang): Promise<boolean>`, true when `ownerOf(lang)` differs from it.

- [ ] **Step 1: Write the failing tests.**
  - `acting.test.ts` (fixture language with A privileged, B second, user U in B with `regenerate`, user V in A):
    - Outside any scope, `ownerOrAll(lang)` is A; inside `asActor(U, …)` it is B; inside `asActor(V, …)` it is A.
    - Inside `asActor(U, …)`, `queryAs(lang, insert into "take" …)` writes a row whose `teamId` is B; `readAs` of it inside `asActor(V, …)` returns nothing.
    - Inside `asActor(U, …)`, `recordActivity({kind: "ignore.set", lang, …})` files under B.
    - `byTeam([lang, "deDE"])` inside `asActor(U, …)` groups the fixture language under B and deDE under its privileged team.
  - `store-overlay.test.ts`, with `./acting` mocked so `actingTeams` counts calls and returns `{lang → B}`: `ownerOrAll("deDE")` and `freshOwners(["deDE", "frFR"])` never call it (Review Focus 2); `ownerOrAll(fixture)` calls it once.
- [ ] **Step 2: Run them.** `set -x DATABASE_URL postgres://localhost/spoken_ci_pin; pnpm --dir apps/web vitest run src/lib/teams/acting.test.ts src/lib/teams/store-overlay.test.ts`. Expected: FAIL, module not found.
- [ ] **Step 3: Implement** `acting.ts` and the overlay. The doc comment on `ownerOf` says which callers must name a team instead (Tasks 4 to 7).
- [ ] **Step 4: Run them, then `src/lib/teams`.** Expected: PASS.
- [ ] **Step 5: Commit.** `feat(teams): a second team's members work as their own team`

### Task 3: Memos of team data are kept per team

**Files:**
- Modify: `apps/web/src/lib/teams/store.ts` (`scopeKey`), and the memo of every module below whose build reads a per-team table: `lib/quests/catalogue.ts` (`cacheKey`, `indexKey`), `lib/quests/overrides.ts`, `lib/quests/ignores.ts`, `lib/contributions/missing-audio.ts`, `lib/places/catalogue.ts` (`catalogueKey`, `byPathKey`), `lib/bosses/catalogue.ts` (both), `lib/readables/catalogue.ts`, `lib/voices/references.ts` (`lists`), `lib/generation/speakers/fish.ts` (`lexicons`). `lib/generation/status.ts` (per provider account), `lib/audio.ts`'s file index and `lib/contributions/book-match.ts` read shared text and stay.
- Test: `apps/web/src/lib/teams/memo-scope.test.ts`

**Interfaces:**
- Produces: `scopeKey(lang: Lang): Promise<string>` = `` `${await ownerOrAll(lang)}:${lang}` ``. Each memo above passes it where it passed `lang` as the slot; the build still gets `lang`. A synchronous forget by language (`forgetReferences(lang)`, the fish lexicon's) drops every slot ending in `` `:${lang}` ``, since another team's copy may be the stale one.
- A memo versioned by a per-team stamp (overrides, ignores, the catalogues) is already right, only rebuilt on every switch between teams; a memo versioned by time (`references.ts`) or not at all (`fish.ts`) serves one team's value to the other. Both move to `scopeKey`.

- [ ] **Step 1: Write the failing test** `memo-scope.test.ts` (Task 2's fixture):
  - A pinned `fish_reference` row in A (through `asSystem`): `pinnedVoices(lang)` inside `asActor(V, …)` holds its voice; right after, inside `asActor(U, …)`, it is empty.
  - `writeOverride` inside `asActor(U, …)`, then `readOverrides(lang)` alternately inside `asActor(V, …)`, `asActor(U, …)` and `asActor(V, …)`: absent, present, absent.
- [ ] **Step 2: Run it.** Expected: FAIL on the first case: the minute-long `lists` memo serves A's references to U.
- [ ] **Step 3: Implement** `scopeKey` and switch the memos.
- [ ] **Step 4: Run it and `src/lib/quests src/lib/places src/lib/bosses src/lib/readables src/lib/voices`.** Expected: PASS.
- [ ] **Step 5: Commit.** `fix(teams): per-language memos keep one copy per team`

### Task 4: The worker runs a job as its team; token routes opt in

**Files:**
- Modify: `apps/web/src/lib/generation/worker.ts` (`run`), `apps/web/src/lib/text-api/guard.ts`, `apps/web/src/app/api/v1/route.ts`, `apps/web/src/app/api/v1/[section]/reference/route.ts`, `apps/web/src/app/api/v1/[section]/generate/route.ts`, `apps/web/src/app/api/v1/generations/route.ts`, `apps/web/src/app/api/v1/generations/[batchId]/route.ts`, `apps/web/src/app/api/v1/generations/[batchId]/stop/route.ts`
- Test: `apps/web/src/lib/generation/worker.test.ts`, `apps/web/src/lib/text-api/guard.test.ts`, `apps/web/src/app/api/v1/[section]/generate/route.test.ts`

**Interfaces:**
- Consumes: Task 2's `asTeams`, `asActor`, `teamIn`, `privilegedOf`.
- Produces:
  - `run(job, lane)` does its work inside `asTeams(new Map([[job.lang, job.teamId]]), …)`, so settings, roster, lexicon, overrides and `commitTake` resolve the job's team.
  - `requireToken(request, options: { need?; also?; noQuery? })`: after the scope checks, when `teamIn(token.userId, token.lang)` is a team other than `privilegedOf(token.lang)`, 403 `"this route does not work for a second team yet"`. `withToken(request, options, work)` skips that refusal and runs `work(context)`, in `asActor(context.userId, …)` only when the language is in `secondTeamLangs()`.
  - The six routes above go through `withToken`.

- [ ] **Step 1: Write the failing tests.**
  - `worker.test.ts`: a bosses job seeded in a second team B of a fixture language (the file's existing bosses fixture, with `teamId` B) commits a take whose `teamId` is B.
  - `guard.test.ts` (with `@/lib/teams/acting` and `privilegedOf` mocked): an owner holding `text` whose team in `deDE` is a second team gets 403 with the exact message on `need: "read"`, and passes `withToken`.
  - `generate/route.test.ts`: a generate token whose owner is in second team B, with `enqueue` real and jobs cancelled in `afterEach`, queues one bosses item; its `regeneration_job."teamId"` is B.
- [ ] **Step 2: Run them.** `set -x DATABASE_URL postgres://localhost/spoken_ci_pin; pnpm --dir apps/web vitest run src/lib/generation/worker.test.ts src/lib/text-api/guard.test.ts src/app/api/v1`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run them.** Expected: PASS.
- [ ] **Step 5: Commit.** `feat(teams): jobs and generate tokens work as a second team`

### Task 5: Grants belong to the granter's team

**Files:**
- Modify: `apps/web/src/lib/permissions.ts` (`Grant`, `canGrant`), `apps/web/src/lib/grants/store.ts`, `apps/web/src/lib/teams/members.ts` (`deleteMember`), `apps/web/src/lib/invites/listing.ts`, `apps/web/src/app/api/grants/route.ts`, `apps/web/src/lib/activity/store.ts` (`team?`), `apps/web/src/lib/teams/admin.ts` (`createTeamWithLangs` maps `OtherTeamError` to `TeamError` 409)
- Test: `apps/web/src/lib/permissions.test.ts`, `apps/web/src/lib/grants/store.test.ts`, `apps/web/src/app/api/grants/route.test.ts`

**Interfaces:**
- Consumes: Task 2's `teamIn`, `privilegedOf`.
- Produces:
  - `Grant = { lang: string; capability: Capability; privileged?: boolean }`. `grantsOf` sets `privileged` from the row's `team_language`; text rows leave it unset.
  - `canGrant(viewer, capability, lang, textByTeam)`: `text` with `textByTeam` needs an `admin` grant in `lang` whose `privileged` is not false. The doc comment drops "everyone with `admin` in the language".
  - `ActivityEvent.team?: TeamId`, used by `rowsOf` in place of the language's owner.
  - `class OtherTeamError extends Error` with the 409 message under *Global Constraints*.
  - `addGrants(userId, lang, capabilities, grantedBy, options: { team?: TeamId; within?: (client: ClientBase) => Promise<void> } = {})`. Member capabilities go to `options.team ?? (await teamIn(grantedBy, lang)) ?? teamOf(lang)`. Before inserting, `teamIn(userId, lang, client)` naming another team throws `OtherTeamError`; a commit failing with `23P01` becomes it too. `grant.added` rows carry `team`. Existing callers pass `{ within }`.
  - `type GrantRow` gains `teamSlug: string | null` (null for `text`). `listGrants(langs?: string[], team?: TeamId)`: with `team`, member rows of that team and no text rows.
  - `removeGrant(userId, lang, capability, removedBy, team?: TeamId)` and `deleteMember(userId, lang, capability, team?: TeamId)`: with `team`, only that team's row is deleted.
  - `listingFor(viewer: Viewer, userId: string, extra?)`: a site owner sees everything; anyone else sees, per language they administer, their own team's rows, plus text rows where they are a privileged admin.
  - `/api/grants`: PUT answers `OtherTeamError` as 409 with its message; DELETE passes the remover's team unless they are a site owner, so another team's row is "not allowed" (403) and stays.

- [ ] **Step 1: Write the failing tests.**
  - `permissions.test.ts`: `canGrant({role: "member", grants: [{lang: "xqAA", capability: "admin", privileged: false}]}, "text", "xqAA", true)` is false; with `privileged: true`, or the field absent, it is true.
  - `grants/store.test.ts` (A privileged, B second, admin W in B, member V in A):
    - `addGrants(fresh, lang, ["regenerate"], W)` puts the row in B, and its `grant.added` activity has `teamId` B.
    - `addGrants(V, lang, ["record"], W)` throws `OtherTeamError` and V holds no B row.
    - `listGrants([lang], B)` has W and the fresh user, not V, and no text rows.
    - `removeGrant(V, lang, "regenerate", W, B)` leaves V's row.
  - `api/grants/route.test.ts` (session mocked as W): GET lists no A rows; PUT for V's email is 409 with the message; DELETE of V's capability is 403. As a site owner, PUT for a fresh user without membership lands in A, as today.
- [ ] **Step 2: Run them.** `set -x DATABASE_URL postgres://localhost/spoken_ci_pin; pnpm --dir apps/web vitest run src/lib/permissions.test.ts src/lib/grants src/app/api/grants`. Expected: FAIL.
- [ ] **Step 3: Implement**, then `TeamMatrix` shows `teamSlug` beside a row only for a site owner.
- [ ] **Step 4: Run them, `src/lib/teams` and `src/components/TeamMatrix.test.tsx`, then `pnpm --dir apps/web typecheck`.** Expected: PASS.
- [ ] **Step 5: Commit.** `feat(teams): a team admin grants into their own team only`

### Task 6: Invites carry their team

**Files:**
- Modify: `apps/web/src/lib/invites/store.ts`, `apps/web/src/lib/invites/manage.ts`, `apps/web/src/lib/invites/listing.ts`, `apps/web/src/app/api/grants/route.ts`, `apps/web/src/app/api/invites/accept/route.ts`
- Test: `apps/web/src/lib/invites/store.test.ts`, `apps/web/src/lib/invites/accept.test.ts`

**Interfaces:**
- Consumes: Task 1's `joinTeamId`; Task 5's `addGrants` options, `ActivityEvent.team`.
- Produces:
  - `InviteRow.teamId: TeamId | null`. `createInvite(args: { …; team: TeamId | null })` stores it as `joinTeamId`; `/api/grants` PUT passes `await teamIn(who.userId, lang)`.
  - `listInvites(langs?: string[], team?: TeamId)`: with `team`, the invites whose `coalesce("joinTeamId", team_of_lang("lang"))` is it.
  - `manageableInvite(id)` answers `noSuchInvite()` (404) when a non-site-owner viewer's `teamIn` differs from the invite's team (null read as the privileged team).
  - `AcceptOutcome` reason gains `"other-team"`. `acceptInvite` resolves the team as `joinTeamId ?? privilegedOf(lang)`, returns `other-team` when `teamIn(user.id, lang)` is another team, and calls `addGrants(…, { team, within: claim })`; `invite.accepted` carries `team`.
  - `/api/invites/accept`: `"other-team"` is 409 with `` `You already work on ${langName(lang)} in another team; one person works in one team per language.` ``.

- [ ] **Step 1: Write the failing tests.**
  - `store.test.ts`: an invite created by B's admin has `teamId` B; `listInvites([lang], A)` leaves it out; `manageableInvite` for A's admin (session mocked) is 404.
  - `accept.test.ts`: accepting B's invite as a fresh user puts the grants in B, and `invite.accepted` and `grant.added` file under B (Review Focus 1); accepting it as a user already in A returns `{ok: false, reason: "other-team"}`, grants nothing, and the invite stays pending; an invite with null `joinTeamId` lands in A, as today.
- [ ] **Step 2: Run them.** `set -x DATABASE_URL postgres://localhost/spoken_ci_pin; pnpm --dir apps/web vitest run src/lib/invites src/app/api/invites`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run them and `src/app/api/grants`.** Expected: PASS.
- [ ] **Step 5: Commit.** `feat(teams): an invite joins the inviter's team`

### Task 7: Approval makes the second team

**Files:**
- Modify: `apps/web/src/lib/teams/found.ts` (`FoundInput`, `addSecondTeam`, `afterFounded`), `apps/web/src/lib/teams/requests.ts` (`createRequest`, `approveRequest`), `apps/web/src/app/api/team-requests/[id]/route.ts`, `apps/web/src/lib/teams/branch-text.ts`, `apps/web/src/components/TeamRequests.tsx`, `apps/web/src/lib/teams/admin.ts` (`listTeams`), `apps/web/src/components/TeamsTable.tsx`, `apps/web/src/lib/activity/kinds.ts`, `apps/web/src/components/ActivityTable.tsx`
- Test: `apps/web/src/lib/teams/found.test.ts`, `apps/web/src/lib/teams/requests.test.ts`, `apps/web/src/app/api/team-requests/route.test.ts`, `apps/web/src/components/TeamRequests.test.tsx`

**Interfaces:**
- Consumes: Task 1's `copy_team_settings`; Task 2's `teamIn`; Task 5's `ActivityEvent.team`.
- Produces:
  - `type Settings = "copy" | "fresh"`; `FoundInput.settings?: Settings` (fresh when absent); `Founded.settings: Settings | null` (null on the other branches).
  - `addSecondTeam(client, input, actorId)`, on the founding client (acting as `ALL_TEAMS`):
    1. `input.adminId` with `teamIn(adminId, lang, client)` set: `TeamError(<requester message>, 409)`.
    2. Slug from `input.team.slug` or `free_team_slug(slugFor(…))`, then `new_team`, through `named` for a taken slug.
    3. `insert into "team_language" ("teamId", "lang", "privileged") values ($1, $2, false)` and `pg_notify('spoken_team_language', $2)`.
    4. `copy_team_settings(team_of_lang(lang), team, lang)` for copy; `copy_team_roster((select "id" from "team" where "slug" = 'english'), team)` for fresh.
    5. `grantOn(client, team, adminId, lang, ["admin"], actorId)` when `adminId` is set.
    Returns `branch: "second-team"`, `from` = the privileged team's slug, `moved: 0`, `switchedOn: false`, `languageName: null`.
  - `afterFounded` for `second-team`: `team.created`, then `team.second_in_language` `{ slug: string; beside: string; settings: Settings }` with `lang` and `team` the new team, and each `grant.added` with `team`.
  - `createRequest` refuses with the requester message (409) when `teamIn(userId, lang)` is set.
  - `approveRequest(id: string, actorId: string, options: { settings?: Settings } = {})`; PATCH `{ decision: "approve", settings?: "copy" | "fresh" }`, any other `settings` 400.
  - `branchText("second-team", name)`: `` `${name} has a team already; approving makes a second team beside it, with audio roles only` ``.
  - `TeamRequests`: a `second-team` row has an unticked checkbox "Start from {privileged team name}'s voices and settings", sent as `settings`. The page passes each pending request's privileged team name.
  - `TeamSummary.alsoIn: Lang[]`, the team's non-privileged languages; `TeamsTable` lists them as "{code} (second team)".

- [ ] **Step 1: Write the failing tests.**
  - `found.test.ts` replaces the plan-2 refusal case (fixture: A privileged with a non-owner member, so the branch is `second-team`; requester R in no team):
    - fresh: `branch` `"second-team"`; `team_language` has the new team with `privileged` false; `team_of_lang` is still A; R holds `admin` in the new team and no `text`; `textByTeam` unchanged; the new team's voices equal English's.
    - copy: the new team has A's `generation_setting_locale.modelId` for the language.
    - with A holding a live take and a `line_override` row in the language, neither start gives the new team a `take`, `recording` or `line_override` row *(user)*.
    - R already in A: `TeamError` 409 with "one person works in one team per language", and after rollback no new team exists.
    - after `afterFounded`, `team.second_in_language` and R's `grant.added` have the new team's `teamId`; A's log has neither (Review Focus 1).
  - `requests.test.ts`: a request by a member of A is refused at creation; approving a second-team request with `{settings: "copy"}` gives `approved` and `approvedTeamId` the new team.
  - `team-requests/route.test.ts`: PATCH with `settings: "all"` is 400.
  - `TeamRequests.test.tsx`: ticking the box on a `second-team` row PATCHes `{decision: "approve", settings: "copy"}`; unticked sends `settings: "fresh"`; other rows send no `settings`.
- [ ] **Step 2: Run them.** `set -x DATABASE_URL postgres://localhost/spoken_ci_pin; pnpm --dir apps/web vitest run src/lib/teams/found.test.ts src/lib/teams/requests.test.ts src/app/api/team-requests src/components/TeamRequests.test.tsx`. Expected: FAIL, approval still answers the plan-2 refusal.
- [ ] **Step 3: Implement.** The doc comment on `addSecondTeam` names the spec row and what it does not copy.
- [ ] **Step 4: Run them, `src/lib/teams`, `src/app/api/teams` and `src/components`, then `pnpm --dir apps/web typecheck`.** Expected: PASS.
- [ ] **Step 5: Commit.** `feat(teams): approving a maintained language's request makes a second team`

### Task 8: Text reports follow the `text` grant, not the team *(user)*

**Files:**
- Modify: `apps/web/src/lib/reports/store.ts` (`listReports`, `openReportCounts`, `reportsForLine`, `reportById`, `reportPlace`, `setQueue`, `setStatus`, `skippedIds`, `skipReports`, `resetSkips`)
- Test: `apps/web/src/lib/reports/text-queue.test.ts`

**Interfaces:**
- Consumes: Task 2's `ownerOrAll` overlay and `asActor`; Task 5's `ActivityEvent.team`.
- Produces:
  - `const REPORT_SCOPE = ("queue" = 'text' or "teamId" = $team)`, applied to each read above, which now runs as `ALL_TEAMS` with `$team = await ownerOrAll(lang)`. The `queues` argument still decides which queues a caller sees (`queuesOf`, so `text` only for a `text` holder); this only stops the text queue being cut to the acting team. Audio reports stay the acting team's.
  - `reportPlace(id)` also returns `teamId: TeamId`. `setQueue` and `setStatus` write a `text`-queue report as its own team (`withTeam(place.teamId, …)`) and an audio report as before (`queryAs(lang, …)`), and log with `team: place.teamId`. `skipReports` and `resetSkips` (`report_skip` has no team) select text reports across teams with the same scope.
  - Contributions need nothing: they have no team.
- Players' reports all file under the privileged team today, so for every language without a second team the rows each read returns are the same as now.

- [ ] **Step 1: Write the failing test** `text-queue.test.ts` (Task 2's fixture; one `wrong_text` report and one `pronunciation` report filed in A through `asSystem`; M holds `text` in the language and `regenerate` in B):
  - Inside `asActor(M, …)`: `listReports(lang, …, ["text"])` returns the text report; `openReportCounts(lang, ["text", "audio"])` counts it and not the audio one; `setStatus(textId, "resolved", M, lang)` resolves it, and its activity row has A's `teamId`; `setStatus(audioId, …)` changes nothing (Review Focus 5).
  - A text maintainer with no team at all gets the same list.
- [ ] **Step 2: Run it.** `set -x DATABASE_URL postgres://localhost/spoken_ci_pin; pnpm --dir apps/web vitest run src/lib/reports/text-queue.test.ts`. Expected: FAIL. Acting as B, `readAs` hides A's text report.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run it and `src/lib/reports src/app/api/reports`.** Expected: PASS, with the existing report tests unchanged.
- [ ] **Step 5: Commit.** `feat(reports): text maintainers keep their language's text reports whatever team they work in`

### Task 9: What a second team may not do yet, and the docs

**Files:**
- Modify: `apps/web/src/app/api/releases/route.ts`, `apps/web/src/app/[lang]/admin/release/page.tsx`, `apps/web/src/app/api/quests/lines/override/route.ts`, `docs/platform/SELF-SERVE-TEAMS.md`, `docs/platform/TEAMS.md`, `deploy/web/README.md` (the runbook)
- Test: `apps/web/src/app/api/releases/route.test.ts`, `apps/web/src/app/api/quests/lines/override/route.test.ts`

**Interfaces:**
- Consumes: Task 2's `actsAsSecondTeam`.
- Produces:
  - `POST /api/releases`: after the capability check, `actsAsSecondTeam(lang)` answers 409 with the release message, before any `release_run` row. The release page shows that sentence in place of `ReleasePanel` for such a viewer.
  - Override `PUT`: text that `branchesOnPlayerGender` from someone for whom `actsAsSecondTeam(lang)` is 409 with the gender-split message, and from anyone else without `text` in `lang` is 403: a split rewrites the original text, which only `text` writes. A plain override is written as today, into their team's layer.
  - `SELF-SERVE-TEAMS.md`: the status line names plan 5a. *Second team in a language* gains:
    - one team per person per language *(user)*;
    - the start: original text inherited, takes and overrides never, settings copied or fresh at the site owner's choice *(user)*;
    - the text maintainer role is independent of team membership: text reports and contributions follow `text` *(user)*;
    - the token rule *(user)*: only `text` writes the original text, in any language. A second team's token reads its language's original text and writes its team's overrides when its owner holds `regenerate`, and never writes the original (5b).

    The *Text layer* bullet's "writes … go to its override layer" names `regenerate`. The *Calls made without the user* paragraph on tokens says text reads and writes need `text`, and override writes need `regenerate`.
  - `TEAMS.md`:
    - *Migration*: "Only a second team in the same language (phase 2) starts empty: original text, a roster with no voices assigned, no settings or lexicon" becomes: "A second team in the same language starts as any new team does: it inherits the original text and never the other team's takes or text overrides, and starts from English's roster and settings as a new language does, or from a copy of the privileged team's settings, as the site owner chooses at approval" *(user)*.
    - *Roles → Audio team members*: "a team-level `edit` that covers the team's text overrides, audio reports and missing audio" becomes "a team-level `edit` that covers the team's audio reports and missing audio", plus a sentence that overrides are written under `regenerate` in every team and the original only under `text` *(user; supersedes the earlier line)*.
    - *Text maintainers*: the role is independent of team membership; a maintainer sees the text queue whatever team they work in *(user)*.
    - *Isolation*: the team for a request is the person's team in that language, else the privileged team.
    - *Voices and clones* and *Phase 2*: clone names keep their shape while one person works in one team per language.
  - Runbook: rolling back past 0113 while a second team exists gives its members the privileged team's rows.

- [ ] **Step 1: Write the failing tests.** `releases/route.test.ts`: a second team's admin POST is 409 with the message and no `release_run` row exists; the privileged admin's POST still dispatches (mocked). `override/route.test.ts`: a second-team member's PUT of `"Well met, $Glad:lass;."` is 409 with the message and the quest line is unchanged; their plain override lands in their team's `line_override` row.
- [ ] **Step 2: Run them.** `set -x DATABASE_URL postgres://localhost/spoken_ci_pin; pnpm --dir apps/web vitest run src/app/api/releases src/app/api/quests/lines/override`. Expected: FAIL.
- [ ] **Step 3: Implement** the two guards, the page and the doc edits.
- [ ] **Step 4: Run everything.** `set -x DATABASE_URL postgres://localhost/spoken_ci_pin; pnpm --dir apps/web test`, then `make lint`. Expected: PASS. Then, in the Paseo tab on `spoken_dev`: as a fresh user, request a team in a maintained language; as a site owner approve it with the box ticked; as the requester, open `/admin?lang=<code>` (the matrix lists only the new team), `/voices` (the copied roster) and the Explorer, regenerate one place line on your own key and see the take in your team only; as the privileged team's admin, see no trace of it in the matrix or `/activity`.
- [ ] **Step 5: Commit.** `feat(teams): a second team cannot release or split the original, and the docs say so`

---

## Outline: plan 5b, the text layer for every source

- **Store.** Per-team overrides keyed by item, not file, for places (`lore_line`, text and `short`), readables (`book_line`), bosses (`boss_line`) and names (`entity_name`), with `originalHash` for "original changed since your override". Either `line_override` gains a `source` and an item key, or a new RLS table `text_override`; decide by how quests' file-keyed rows map to the text API's `(id, variant)`.
- **Readers.** The places, readables and bosses catalogue builders (`buildCorpus`/`build`), `lib/generation/narrated.ts`, each section's staleness (the catalogue `textHash` against the take's `spokenHash`) and the names a line is spoken with read the acting team's override where present.
- **Writers.** A pencil per section in the Explorer, gated on `regenerate` in every team as the quest pencil is today, so current teams see no change *(user)*. The original stays `text`'s alone, in every language *(user)*.
- **Text API** *(user)*. A read token works for an owner holding `text`, or `regenerate` (the original text, plus their team's overrides). A write token writes the original only under `text`. For an owner who holds `regenerate` but not `text`, it writes their team's overrides and never the original. `saveText` gains an override path with the same versions, restore and batches (`lib/text-api/*`), and the text API routes then go through `withToken`. Which of the two a write did shows in each item's result. Open for 5b: whether a token whose owner holds both chooses per request or always writes the original.

## Outline: plan 5c, the Explorer's team picker

- A security-definer function returning only live takes (`isCurrent`) of a named team and language, the "narrow path" TEAMS.md *Isolation* designs; no per-team policy is loosened.
- A picker per language listing the teams that voice it, shown only where a second team exists. `?team=<slug>` selects whose live takes play; the default is the viewer's own team, else the privileged one.
- A site owner acting inside a second team (TEAMS.md: "act inside any team with full rights without being a member") through the same picker.
- The queue panel's finished list and pause list cross teams in one language: each team should see only its own.
- A site owner's Stop reaches only the privileged team's queue, never a second team's.

Distribution and the player side stay out of plan 5 (spec *Non-goals*): pack ids, clone names with slugs, the Manager's index, primary and fallback in the addon, and reports carrying the team.
