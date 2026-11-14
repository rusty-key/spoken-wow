# Self-serve plan 2: requests and approval

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A registered user asks for a team in a language, new or known. A site admin approves or rejects the request on `/admin/teams`. Approval makes a working team with the requester as its admin, and no site admin does anything else.

**Architecture:** A request is a row in a new `team_request` table. Until it is approved nothing else exists: no language, no team, no grant. That is what makes "locked" true by construction. One core step, `foundTeam` in `lib/teams/found.ts`, runs inside the approval's transaction and picks one of three branches by the language's state *at approval*: create the language and its team, hand an unmaintained language over, or (plan 5) add a second team. The "New language…" choice on the New team form calls the same step. A new `language."textByTeam"` flag records that a language's team admins may grant `text` there. `canGrant` reads the flag.

**Tech Stack:** Postgres 16 plain-SQL migrations (`apps/web/migrations`), node-postgres, Next.js App Router (`apps/web`), Vitest with Testing Library.

**Spec:** [`SELF-SERVE-TEAMS.md`](SELF-SERVE-TEAMS.md), sections *What the translator can do* (1 to 3), *What the site owner does*, *What approval does*, *Decisions*, *Anti-goals*. This plan builds on [plan 1](self-serve-plan-1-languages.md) (`addLanguage`, the registry). Invites are plan 3, the API plan 4, the second team plan 5.

## Decisions

- **A request is its own row; nothing else exists until approval.** No pending team, no pending language. "Locked" then needs no checks anywhere else. *(user)*
- **Approval picks the branch, not the request.** The request stores a code, plus English and native names when the code was new when asked. Between asking and approving, the language may have been added or picked up by someone. Approval reads the state again inside its transaction, and a known code ignores the stored names. *(My call)*
- **"Active team", refined.** A language is maintained when one of these holds:
  - its privileged team has a `team_member` row *in that language* held by a user whose role is not `admin`, or
  - it has a `text` maintainer (`language_grant`) whose role is not `admin`.

  Membership counts per language because a team holding deDE and frFR, with people only in frFR, does not look after deDE. Text maintainers count so that a hand-over never gives the requester `text` power over someone the site owner appointed. *(My call; the spec leaves it to the builder.)*
- **The second-team branch refuses in this plan.** A request for a maintained language is accepted and stored. Approving it answers 409 with the message under *Global Constraints*. Plan 5 replaces the body of `addSecondTeam` and changes nothing else. *(user)*
- **`textByTeam` is a column on `language`** (`boolean not null default false`). True means the admins of the language's *privileged* team may grant and remove `text` there. The two branches that hand `text` to a team set it, and nothing in this plan clears it. `canGrant` takes the flag as an explicit, required fourth argument, not from the registry. Built-in languages can be handed over too, and the registry never overwrites a built-in, so a registry field would be wrong for plPL. *(My call)*
- **The requester gives only a team name. The slug is derived at approval:** lowercase, every run of other characters becomes `-`, trimmed to 41 characters, then `free_team_slug`. A name that leaves fewer than two characters or no leading letter (日本語チーム) falls back to `lower(code)`. No slug collides, and a requester never meets the slug rule. The admin form still takes an explicit slug. *(My call)*
- **`bcp47` and `provider` come from the code** (`jaJP` gives `ja-JP` and `ja`) for both request-made and form-made languages. Spec: the form takes code, English name and native name only. *(My call)*
- **`enUS` cannot be requested.** `move_team_lang` refuses to move English, and a second English team is plan 5's question if it is ever one. *(My call)*
- **The New team form's "New language…" runs `foundTeam`.** The language is created switched on and with `textByTeam`, and the named admin, if any, gets `admin` and `text`, exactly as an approval would. Spec: "It runs the same step approval runs" (user, 2026-11-13). The parts of that step a site owner might not expect are the language switching on and `text` going to the team. *(My call; check this)*
- **The request's activity is site-wide and visible only to site admins.** The kinds are `request.made`, `request.withdrawn`, `request.approved` and `request.rejected`, with `lang: null`, `subject` = request id and the language in `detail`. `request.` joins `GLOBAL_ONLY_PREFIXES`. Filed under the language, a request for deDE would land in deDE's team log, which the anti-goals forbid. The requester sees the outcome on the request row itself. *(My call)*
- **Email, kept small.** Site admins get one email per new request, as pack submissions do (`lib/community/store.ts` `emailAdmins`). The requester gets one on approval or rejection. Both go through `sendEmail`. *(My call)*
- **One pending request per user and language**, enforced by a partial unique index. There is no other limit; quotas are a non-goal. An optional free-text note (at most 1000 characters) tells the site admin who is asking and why. *(My call)*
- **A hand-over leaves the old team in place**, with no languages, as `createTeamWithLangs` does today. *(My call)*

## Global Constraints

- Migrations are plain SQL, additive, one transaction each. This plan's single migration is `0108`.
- Language code: `^[a-z]{2}[A-Z]{2}$`. Team slug: `^[a-z][a-z0-9-]{1,40}$`. English name and native name: trimmed, 1 to 60 characters (`described()` in `api/languages/route.ts`). Team name: trimmed, 1 to 60 characters.
- A new code that a page section would shadow is refused (`isPageSection`, plan 1).
- Every per-team write runs under `withTeam`. The approval transaction acts as `ALL_TEAMS` (`actAs`), because `move_team_lang` and `copy_team_roster` are security invoker.
- A site owner is a user whose `role = 'admin'` (`isAdmin`).
- Exact refusal for the second-team branch, status 409: `` `${langName(lang)} already has an active team; approving this request needs a second team (plan 5).` ``
- Tests run as `spoken_app` on `spoken_ci_pin`, never `spoken_dev`. Fixtures use `asSystem`, `testUser`, `dropTeam` and `runningJob` from `src/lib/teams/testing.ts`. Test language codes are made fresh per run (`xq` plus two random capitals), never a built-in code.
- Commands (fish): `DATABASE_URL=postgres://localhost/spoken_ci_pin pnpm --dir apps/web vitest run <file>`. Migrate: `DATABASE_URL=postgres://localhost/spoken_ci_pin deploy/web/bin/migrate.sh $PWD/apps/web`.
- Browser checks run on `spoken_dev` in the Paseo tab, never on `spoken_ci_pin` and never in a new tab.

## Review Focus

1. **Two decisions at once on one request**: two admins approving, or an approval racing a withdrawal. Expected: one wins, the other gets 409 "This request was already approved/withdrawn.", and exactly one team exists. Tested in Task 4 (`Promise.all` of two approvals).
2. **A pending request leaking.** After a request for a new code, `isLang(code)` is false and there is no `language` or `team_language` row and no grant. The `request.made` row does not show in a language admin's `/activity`. Tested in Task 4.
3. **The language changed between request and approval.** A new-code request whose code a site admin has since added (unmaintained, auto team) is handed over, and the request's names are ignored. A hand-over request whose language has since gained a non-owner member hits the second-team refusal. Tested in Task 3.
4. **Approval failing part way.** If a regeneration job is running in the language being handed over, or the admin form's explicit slug is taken, nothing is left behind: no language row, no new team, no grant, and the request is still `pending`. Tested in Task 3 (running job) and Task 4 (request still pending).
5. **`text` granting crossing languages.** The admin of a `textByTeam` language may grant `text` there. They still get 403 in another language they also admin. A deDE admin (flag off) still gets 403. Tested in Task 2.

---

### Task 1: Migration 0108, requests and the `textByTeam` flag

**Files:**
- Create: `apps/web/migrations/0108_team_request.sql`
- Test: `apps/web/src/lib/teams/request-schema.test.ts`

**Interfaces:**
- Produces:
  - `language."textByTeam" boolean not null default false`.
  - Table `team_request`:
    - `"id" uuid pk default gen_random_uuid()`
    - `"userId" text not null references "user" on delete cascade`
    - `"lang" text not null check (~ '^[a-z]{2}[A-Z]{2}$' and <> 'enUS')`
    - `"langName" text`, `"langNative" text`, with `check (("langName" is null) = ("langNative" is null))`
    - `"teamName" text not null`, `"note" text`
    - `"state" text not null default 'pending' check in ('pending','approved','rejected','withdrawn')`
    - `"reason" text`
    - `"approvedTeamId" uuid references "team" on delete set null`
    - `"createdAt" timestamptz not null default now()`, `"decidedAt" timestamptz`, `"decidedBy" text references "user" on delete set null`
    - unique index `team_request_pending_idx` on `("userId", "lang") where "state" = 'pending'`, and an index on `("createdAt") where "state" = 'pending'`
  - The team column is `approvedTeamId`, not `teamId`. `rls.test.ts` binds every table with a `teamId` column to row-level security, and this table is read before any team is set, like `team_member`.

- [ ] **Step 1: Write the failing test** `request-schema.test.ts` (inserts via `asSystem`, cleans up in `afterEach`):
  - A second pending request by one user for one code raises `23505`. It is accepted once the first is `withdrawn`.
  - `lang = 'enUS'` raises `23514`, and so does `langName` set without `langNative`.
  - `select "textByTeam" from "language" where "code" = 'deDE'` is `false`.
- [ ] **Step 2: Run it.** Expected: FAIL, `relation "team_request" does not exist`.
- [ ] **Step 3: Write the migration.** A header comment says why the table has no RLS and why its team column is not named `teamId`.
- [ ] **Step 4: Migrate `spoken_ci_pin` and run the test, then `src/lib/teams/rls.test.ts`.** Expected: PASS.
- [ ] **Step 5: Commit.** `feat(teams): store team requests and which languages' teams grant text`

### Task 2: A `textByTeam` language's admin grants `text`

**Files:**
- Modify: `apps/web/src/lib/permissions.ts` (`canGrant`), `apps/web/src/lib/languages/store.ts`, `apps/web/src/app/api/grants/route.ts`, `apps/web/src/components/TeamMatrix.tsx`, `apps/web/src/app/[lang]/admin/page.tsx`
- Test: `apps/web/src/lib/permissions.test.ts`, `apps/web/src/app/api/grants/route.test.ts`

**Interfaces:**
- Produces:
  - `canGrant(viewer: Viewer | null, capability: Capability, lang: Lang, textByTeam: boolean): boolean`. With the flag on, `text` is grantable by whoever `can(viewer, "admin", lang)`. With it off, the rule is today's. The doc comment says the flag means the *privileged* team's admins, which is everyone with `admin` in the language until plan 5 adds a second team.
  - `textByTeam(lang: string): Promise<boolean>` in `languages/store.ts`. It is false for a language with no row.
  - `TeamMatrix` gets the prop `textByTeam: boolean`. Its lock message stays "Only a site admin appoints a text maintainer" when the flag is off.

- [ ] **Step 1: Write the failing tests.**
  - `permissions.test.ts`: a viewer with `{lang:"xqAA", capability:"admin"}`:
    - `canGrant(viewer, "text", "xqAA", true)` is true.
    - `canGrant(viewer, "text", "xqAA", false)` is false.
    - `canGrant(viewer, "text", "deDE", true)` is false, because they are not admin there.
    - A site admin is true with either flag.
  - `grants/route.test.ts`: with a fixture language `xq…` whose `textByTeam` is true, and the session user as `admin` in it:
    - `PUT {email, lang, capabilities:["text"]}` is 200, and a `language_grant` row exists.
    - `DELETE` of it is 200.
    - The same user, also admin in deDE, gets 403 for `text` in deDE.
- [ ] **Step 2: Run them.** Expected: FAIL. `canGrant` ignores the fourth argument, so the PUT is 403.
- [ ] **Step 3: Implement.** Pass `await textByTeam(lang)` in both route handlers, and from the admin page into `TeamMatrix`.
- [ ] **Step 4: Run both files and `pnpm --dir apps/web typecheck`.** Expected: PASS, with no other `canGrant` callers.
- [ ] **Step 5: Commit.** `feat(teams): a request-made language's team admins appoint text maintainers`

### Task 3: The core step, `foundTeam`, with three branches

**Files:**
- Create: `apps/web/src/lib/teams/found.ts`
- Modify: `apps/web/src/lib/teams/admin.ts` (`TeamError` status gains `404`; `handOver`'s error mapping moves to `moveLang`), `apps/web/src/lib/languages/store.ts`, `apps/web/src/lib/grants/store.ts`
- Test: `apps/web/src/lib/teams/found.test.ts`

**Interfaces:**
- Consumes: `addLanguage`, `LanguageExistsError`, `NewLanguage` (plan 1); `adoptLang`, `forgetTeams`; `forgetLanguages`; `textByTeam` column (Task 1).
- Produces, in `languages/store.ts`:
  - `setEnabledOn(client: ClientBase, lang: string, enabled: boolean, userId: string): Promise<boolean | null>`, which returns the previous state. `setEnabled` becomes a wrapper around it and behaves the same.
  - `describeNew(code: string, name: string, native: string): NewLanguage`, which derives `bcp47` and `provider`.
- Produces, in `grants/store.ts`: `grantOn(client: ClientBase, team: TeamId, userId: string, lang: string, capabilities: readonly Capability[], grantedBy: string): Promise<Capability[]>`. It returns the newly added capabilities and records no activity. `addGrants` becomes `withTeam` + `grantOn` + its activity, and behaves the same.
- Produces, in `admin.ts`: `moveLang(client: ClientBase, lang: string, team: TeamId): Promise<{ moved: number; from: string; to: string }>`. It maps 55006 to `TeamError(…, 409)` and P0001 to `TeamError`. `handOver` calls it.
- Produces, in `found.ts`:
  - `type Branch = "new-language" | "hand-over" | "second-team"`
  - `type FoundInput = { lang: string; language: { name: string; native: string } | null; team: { slug: string | null; name: string }; adminId: string | null }`
  - `type Founded = { branch: Branch; teamId: TeamId; slug: string; lang: string; from: string | null; moved: number; switchedOn: boolean; adminId: string | null; granted: Capability[]; languageName: string | null }`
  - `activeTeamOf(lang: string, client?: ClientBase): Promise<TeamId | null>`: the privileged team when the language is maintained (see *Decisions*), else null.
  - `languageBranch(lang: string, client?: ClientBase): Promise<Branch>`: `new-language` when there is no `language` row, `second-team` when `activeTeamOf` is not null, `hand-over` otherwise.
  - `slugFor(teamName: string, lang: string): string`: the base slug before `free_team_slug`.
  - `foundTeam(client: PoolClient, input: FoundInput, actorId: string): Promise<Founded>`: calls `actAs(client, ALL_TEAMS)`, then dispatches on `languageBranch(input.lang, client)`.
  - `foundLanguage`, `takeOverLanguage` and **`addSecondTeam(client: PoolClient, input: FoundInput, actorId: string): Promise<Founded>`**, one per branch, all with that same signature. **`addSecondTeam` is the function plan 5 fills in.** In this plan it throws `TeamError(<the Global Constraints message>, 409)`.
  - `afterFounded(founded: Founded, actorId: string): Promise<void>`: runs after commit. It calls `forgetLanguages()` and `forgetTeams()`, *then* records the activity, so each row files under the new team: `team.created`, `language.added` (new-language branch), `team.language_moved` (hand-over branch), `language.toggled {enabled:true}` when `switchedOn`, and one `grant.added` per granted capability.

What each branch writes, all on `client`:
- **`foundLanguage`:**
  - Throws `TeamError(…, 400)` when `input.language` is null.
  - Runs `addLanguage(client, describeNew(…), actorId)`, which creates the language's own team through `adopt_lang`. `LanguageExistsError` becomes `TeamError(…, 409)`.
  - Renames that team: `update "team" set "slug" = $slug, "name" = $name where "id" = team_of_lang($lang)`. `$slug` is `input.team.slug`, or `free_team_slug(slugFor(…))` when that is null. 23505 becomes `TeamError("A team is already called …", 409)`.
  - Then `setEnabledOn(…, true, …)` and `textByTeam = true`.
  - Then `grantOn(["admin", "text"])` to `adminId` when it is not null.
- **`takeOverLanguage`:**
  - `new_team(slug, name)`, then `adoptLang` (for a language with no team), then `moveLang`.
  - Then switch on, `textByTeam = true`, and grant `admin` and `text`, as above.

- [ ] **Step 1: Write the failing tests** in `found.test.ts`. Each test runs `foundTeam` inside `withTeam(ALL_TEAMS, …)` and then `afterFounded`. Clean up language rows, teams (`dropTeam`), grants and activity.
  - New code `xqAB`:
    - `branch` is `"new-language"`.
    - The language row is `enabled` and `textByTeam`.
    - `team_of_lang('xqAB')` is the team, and its slug is `slugFor("Japan Crew", "xqAB")` = `"japan-crew"`.
    - The admin holds `admin` and `text` in `xqAB` (`grantsOf`).
    - `isLang("xqAB")` is true after `afterFounded`.
  - `slugFor("日本語チーム", "jaJP")` is `"jajp"`. `slugFor("  Équipe 2!! ", "frFR")` is `"quipe-2"`. Two foundings named "Japan Crew" get `japan-crew` and `japan-crew-2`.
  - Hand-over:
    - Set up `xqAC` with `addLanguage` (so it has an auto team) and a site admin as its member. `branch` is `"hand-over"`, the auto team no longer holds `xqAC`, the new team does, and `textByTeam` is true.
    - With a running job (`runningJob`), the call throws `TeamError` with status 409. After rollback `team_of_lang` is unchanged and no team with the new slug exists.
  - Second team:
    - Add a non-owner `testUser` as `team_member` `regenerate` in `xqAC`. `languageBranch` is `"second-team"`, and `foundTeam` throws `TeamError` 409 whose message contains `"needs a second team (plan 5)"`.
    - Same result for a non-owner `text` maintainer with no team membership.
  - A known code with `language` given: the names are ignored (`langName` unchanged) and the branch is `"hand-over"`.
- [ ] **Step 2: Run it.** Expected: FAIL, module not found.
- [ ] **Step 3: Implement.** Do the extractions in `languages/store.ts`, `grants/store.ts` and `admin.ts` first, then `found.ts`. The doc comment on `addSecondTeam` names plan 5 and the spec row it implements.
- [ ] **Step 4: Run `found.test.ts`, then `src/lib/teams/*.test.ts`, `src/app/api/teams/route.test.ts`, `src/app/api/grants/route.test.ts` and `src/app/api/languages/route.test.ts`** (the extractions must not change their behaviour). Expected: PASS.
- [ ] **Step 5: Commit.** `feat(teams): one step founds a team for a new or unmaintained language`

### Task 4: The request store, its activity and its emails

**Files:**
- Create: `apps/web/src/lib/teams/requests.ts`
- Modify: `apps/web/src/lib/activity/kinds.ts`, `apps/web/src/lib/activity/store.ts` (`GLOBAL_ONLY_PREFIXES`), `apps/web/src/components/ActivityTable.tsx`
- Test: `apps/web/src/lib/teams/requests.test.ts`

**Interfaces:**
- Consumes: Task 1's table; Task 3's `foundTeam`, `afterFounded`, `languageBranch`, `Branch`, `TeamError`.
- Produces, in `requests.ts`:
  - `type RequestState = "pending" | "approved" | "rejected" | "withdrawn"`
  - `type TeamRequest = { id: string; userId: string; email: string; lang: string; langName: string | null; langNative: string | null; teamName: string; note: string | null; state: RequestState; reason: string | null; approvedTeamId: TeamId | null; createdAt: string; decidedAt: string | null; branch: Branch | null }`. `branch` is computed live for pending requests and is null otherwise.
  - `createRequest(userId: string, input: { lang: string; language: { name: string; native: string } | null; teamName: string; note: string | null }): Promise<TeamRequest>`. The input is already validated (Task 5). A known code stores null names. A second pending request becomes `TeamError("You already asked for a team in <name>.", 409)`.
  - `listRequests(filter: { userId?: string; state?: RequestState }): Promise<TeamRequest[]>`, newest first.
  - `withdrawRequest(id: string, userId: string): Promise<TeamRequest>`. Another user's request, or no such request, is `TeamError("No such request.", 404)`.
  - `approveRequest(id: string, actorId: string): Promise<TeamRequest>`. In one `inTransaction`, it locks the row (`for update`) and refuses anything not pending with `TeamError("This request was already <state>.", 409)`. It calls `foundTeam` with `{ lang, language, team: { slug: null, name: teamName }, adminId: userId }`, then sets `state`, `approvedTeamId`, `decidedAt` and `decidedBy`. After commit it calls `afterFounded`, records `request.approved`, and emails the requester.
  - `rejectRequest(id: string, actorId: string, reason: string | null): Promise<TeamRequest>`: the same lock and refusal, then state `rejected`, the reason, `request.rejected`, and an email.
- Activity kinds in `kinds.ts`:
  - `"request.made": { requestId: string; lang: string; teamName: string; newLanguage: boolean }`
  - `"request.withdrawn": { requestId: string; lang: string }`
  - `"request.approved": { requestId: string; lang: string; slug: string; branch: Branch }`
  - `"request.rejected": { requestId: string; lang: string; reason?: string }`
  - All are recorded with `lang: null`, `subject: requestId`. `ActivityTable` gets a row text for each.
- Emails (plain text, with `SITE` as in `lib/community/store.ts`):
  - To site admins on create: subject `Team request: <teamName> (<language>)`, body ending with `Review it here: ${SITE}/admin/teams`.
  - To the requester on approval: subject `Your team for <language> is approved`, with a link to `${SITE}/admin?lang=<code>`.
  - To the requester on rejection: subject `Your team request for <language>`, with the reason when given and a link to the request page.

- [ ] **Step 1: Write the failing tests** in `requests.test.ts`. Mock `@/lib/email` and assert the calls. Use `testUser` for the requester and a second user with role `admin`.
  - A new-code request for `xqAD`:
    - Its state is `pending` and its `branch` is `"new-language"`.
    - No `language` row and no `team_language` row exists, `isLang("xqAD")` is false, and `grantsOf(requester)` is empty.
    - `listActivity` with `global: false` has no `request.` row.
    - One email went to each site admin.
  - The same request again gives a 409 `TeamError`. After `withdrawRequest` a new one is accepted. `withdrawRequest` by another user gives 404.
  - `approveRequest`:
    - The state is `approved` and `approvedTeamId` is the team holding `xqAD`.
    - The requester holds `admin` and `text`.
    - One `request.approved` row exists, and the requester got one email.
  - `Promise.all([approveRequest(id, a), approveRequest(id, a)])`: one fulfils, one rejects with 409, and exactly one team holds `xqAD`.
  - Approving a withdrawn request gives 409. Approving a second-team request gives 409 with the plan 5 message, and that request stays `pending`.
  - `rejectRequest(id, admin, "Not a language")`: the state is `rejected`, the reason is stored, and the requester's email contains the reason.
- [ ] **Step 2: Run it.** Expected: FAIL, module not found.
- [ ] **Step 3: Implement** the store, the kinds with their `ActivityTable` rows, and `"request."` in `GLOBAL_ONLY_PREFIXES`.
- [ ] **Step 4: Run it and `src/lib/activity/*.test.ts`.** Expected: PASS.
- [ ] **Step 5: Commit.** `feat(teams): users request a team, site admins approve or reject`

### Task 5: The requests API

**Files:**
- Create: `apps/web/src/lib/languages/validate.ts`, `apps/web/src/app/api/team-requests/route.ts`, `apps/web/src/app/api/team-requests/[id]/route.ts`
- Modify: `apps/web/src/app/api/languages/route.ts` (uses `validate.ts`)
- Test: `apps/web/src/app/api/team-requests/route.test.ts`

**Interfaces:**
- Consumes: Task 4's store; `withAdmin` and `bad` from `api/teams/guard.ts`; `currentSession`.
- Produces:
  - In `validate.ts`, moved from `api/languages/route.ts`: `LANG_CODE`, `describedName(value: unknown): string | null`, `isPageSection(code: string): boolean`, and `newLanguageError(code: string, name: unknown, native: unknown): string | null`.
  - `GET /api/team-requests`: signed in. Returns `{ requests: TeamRequest[] }`, the caller's own. With `?state=pending` from a site admin, it returns every pending request. Signed out gets 401.
  - `POST /api/team-requests`: signed in. The body is `{ lang, language?: { name, native }, teamName, note? }`.
    - 400 for a bad shape, `enUS`, a known code sent with `language`, an unknown code without valid names, a code that shadows a page, an empty or over-long team name, or a note over 1000 characters.
    - Answers `{ request }`.
    - It calls `await loadLanguages()` before `isLang`.
  - `DELETE /api/team-requests/[id]`: signed in, withdraws. Answers `{ request }`.
  - `PATCH /api/team-requests/[id]`, wrapped in `withAdmin(…, "id")`: the body is `{ decision: "approve" }` or `{ decision: "reject", reason?: string }`, with the reason at most 500 characters. Answers `{ request }`. `TeamError` statuses pass through.

- [ ] **Step 1: Write the failing tests**, with the session mocked as in `api/teams/route.test.ts`:
  - Signed out, GET and POST are 401.
  - As a member:
    - POST for a new `xqAE` with names is 200, and GET lists it.
    - POST for `enUS`, `deDE` with `language`, `xqAF` without names, and a team name of 61 characters are each 400.
    - DELETE of their own request is 200 with state `withdrawn`.
    - PATCH is 403.
  - As a site admin:
    - `GET ?state=pending` includes another user's request.
    - PATCH approve is 200 with state `approved`. PATCH approve again is 409.
    - PATCH reject with a 501-character reason is 400.
  - The existing `api/languages/route.test.ts` still passes.
- [ ] **Step 2: Run them.** Expected: FAIL, module not found.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run `team-requests/route.test.ts` and `languages/route.test.ts`.** Expected: PASS.
- [ ] **Step 5: Commit.** `feat(teams): the team requests API`

### Task 6: The request page

**Files:**
- Create: `apps/web/src/app/[lang]/request-team/page.tsx`, `apps/web/src/components/TeamRequestForm.tsx`, `apps/web/src/components/NewLanguageFields.tsx`
- Modify: `apps/web/src/app/[lang]/profile/page.tsx` (a "Start a team for a language" link)
- Test: `apps/web/src/components/TeamRequestForm.test.tsx`

**Interfaces:**
- Consumes: Task 5's routes, `allLangs`, `langName`.
- Produces:
  - `<NewLanguageFields value={{ code, name, native }} onChange={…} />`: three inputs, the code with `pattern="[a-z]{2}[A-Z]{2}"`. Task 8 reuses it.
  - The page signs a signed-out visitor in, as `/profile` does (redirect to `/login`). It lists the user's requests with state, date, reason, and the live branch for pending ones:
    - `new-language`: "A new language"
    - `hand-over`: "Nobody looks after <name> yet; your team takes it over"
    - `second-team`: "<name> has a team already; a second team is not possible yet"

    Each pending request has a Withdraw button. An approved one links to `/admin?lang=<code>`. The form sits below the list.
  - `<TeamRequestForm languages={{ code, name }[]} />`: the language select lists every known language except English, plus "New language…", which reveals `NewLanguageFields`. Then team name and note. It POSTs, shows the error text from the response, and refreshes on success.

- [ ] **Step 1: Write the failing test** `TeamRequestForm.test.tsx`, with `fetch` mocked:
  - Choosing "New language…" shows the three fields. Submitting with `xqAG`, "Testish", "Testisch" and "Crew" POSTs `{ lang: "xqAG", language: { name: "Testish", native: "Testisch" }, teamName: "Crew" }`.
  - Choosing `deDE` POSTs no `language`.
  - A 409 response's `error` text is shown.
- [ ] **Step 2: Run it.** Expected: FAIL, module not found.
- [ ] **Step 3: Implement** the components, the page and the profile link.
- [ ] **Step 4: Run the test and `pnpm --dir apps/web typecheck`.** Expected: PASS. Then check in the browser on `spoken_dev` as a member: request a new code, see it pending, withdraw it.
- [ ] **Step 5: Commit.** `feat(teams): a page to request a team and follow the request`

### Task 7: The approval queue on `/admin/teams`

**Files:**
- Create: `apps/web/src/components/TeamRequests.tsx`
- Modify: `apps/web/src/app/[lang]/admin/teams/page.tsx`
- Test: `apps/web/src/components/TeamRequests.test.tsx`

**Interfaces:**
- Consumes: `listRequests({ state: "pending" })` (server side), and `PATCH /api/team-requests/[id]`.
- Produces: `<TeamRequests initial={TeamRequest[]} />`, above `TeamsTable`, and rendered only when at least one request is pending. One row per request:
  - requester email, the language (code and name, or "new: <name> / <native>"), team name, note, age, and the branch in the same words as Task 6
  - Approve, and Reject with an optional reason input

  A refusal's message shows inline on the row. On success the row goes away, and the page calls `router.refresh()` so `TeamsTable` shows the new team.

- [ ] **Step 1: Write the failing test** `TeamRequests.test.tsx`, with `fetch` mocked:
  - Reject with "Not a language" PATCHes `{ decision: "reject", reason: "Not a language" }`.
  - A 409 answer shows its `error` on the row, and the row stays.
  - A `second-team` row shows its branch text.
- [ ] **Step 2: Run it.** Expected: FAIL, module not found.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run the test and the typecheck.** Expected: PASS. Then check in the browser on `spoken_dev` with Task 6's flow:
  - Approve a new-code request. The team appears, the language is in the switcher, and the requester's `/admin?lang=<code>` shows the matrix with the `text` column unlocked.
  - Approving a request for a maintained language shows the plan 5 message.
- [ ] **Step 5: Commit.** `feat(teams): site admins approve and reject team requests`

### Task 8: "New language…" on the New team form

**Files:**
- Modify: `apps/web/src/app/api/teams/route.ts`, `apps/web/src/components/TeamsTable.tsx`, `docs/platform/SELF-SERVE-TEAMS.md` (the status line, and the refined "active team" in *What approval does*)
- Test: `apps/web/src/app/api/teams/route.test.ts`

**Interfaces:**
- Consumes: `foundTeam` and `afterFounded` (Task 3), `newLanguageError` (Task 5), `NewLanguageFields` (Task 6), `userByEmail`.
- Produces: `POST /api/teams` also accepts `{ slug, name, adminEmail?, newLanguage: { code, name, native } }`. Then `langs` must be absent or empty, or the answer is 400. Flow:
  1. Validate the slug against `SLUG` and the language with `newLanguageError`.
  2. A code `isLang` already knows is 409.
  3. Resolve the admin by email, or 400 "No user has the email …".
  4. `withTeam(ALL_TEAMS, client => foundTeam(client, { lang, language, team: { slug, name }, adminId }, actorId))`, then `afterFounded`.
  5. Answer `{ team }` from `listTeams(id)`.

  `TeamsTable`'s language select gains "New language…", which reveals `NewLanguageFields` and sends `newLanguage` in place of `langs`.

- [ ] **Step 1: Write the failing tests** in `api/teams/route.test.ts`:
  - As admin, POST `{ slug: "test-xqah-<tag>", name: "Testish", newLanguage: { code: "xqAH", name: "Testish", native: "Testisch" }, adminEmail: <test user> }` is 200.
  - The team holds `xqAH`, the language row is `enabled` and `textByTeam`, and the user holds `admin` and `text`.
  - The same code again is 409.
  - A taken slug with a fresh code `xqAI` is 409, and no `xqAI` row and no new team are left behind.
  - `newLanguage` together with `langs: ["deDE"]` is 400.
  - As a member, the POST is 403.
- [ ] **Step 2: Run them.** Expected: FAIL, 400 "expected { slug, name, langs: [...] … }".
- [ ] **Step 3: Implement** the route branch, the form choice and the doc edits.
- [ ] **Step 4: Run the file, then the whole suite on `spoken_ci_pin`:** `DATABASE_URL=postgres://localhost/spoken_ci_pin pnpm --dir apps/web test`, then `make lint`. Expected: PASS. Then check in the browser on `spoken_dev`: create a team with a new language from `/admin/teams`, and see it switched on in the header.
- [ ] **Step 5: Commit.** `feat(teams): create a team for a new language from the New team form`

## Notes for plan 5

- **Fill `addSecondTeam` in `lib/teams/found.ts`** with the same signature. `languageBranch` already routes maintained languages to it, and `approveRequest` and the admin queue need no change.
- **`activeTeamOf(lang, client)` gives the privileged team the new team sits beside.**
- **`Founded.branch` is `"second-team"`.** `afterFounded` then needs no `language.added` or `team.language_moved` row. Add the second team's own activity there.
- **Narrow `canGrant`'s `textByTeam` rule to the privileged team's admins.** Today every `admin` grant in a language is on its privileged team. Once a second team exists, `Viewer` grants need their team.
