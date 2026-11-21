# Teams plan 2: members, team creation and language handover

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Teams get members and roles, every language gets a team of its own, and a site owner can create a team and hand a language to it with everything the language has.

**Architecture:** A new `team_member` table holds the audio capabilities (`regenerate`, `configure`, `ignore`, `record`, `admin`) per team and language. `language_grant` keeps `edit`. `grantsOf` merges both into today's `Grant[]`, so `can()` and every caller stay unchanged. One plpgsql function, `move_team_lang(lang, team)`, re-teams every row of a language. The migration uses it to give each English-parked language its own team, and the app uses it for handovers. A Postgres `NOTIFY` makes both pm2 workers drop their team memo when ownership changes.

**Tech Stack:** Postgres 16 plain-SQL migrations (`apps/web/migrations`, one transaction per file), node-postgres, Next.js App Router (`apps/web`), Vitest.

**Spec:** [`TEAMS.md`](TEAMS.md), sections *Roles*, *Migration* and *Not in this plan*. The decisions below were made by the user on 2026-11-01 and override the spec where they differ.

## Decisions

- **No separate bucket.** A language nobody maintains gets a team of its own, like every other language (user, 2026-11-01). This replaces the spec's "go to the English team until handed over" and its *Not in this plan* bucket.
  - 0091 moves every language the `english` team holds, except `enUS`, to a new one-language team, and makes `x@rusty.one` that team's admin in it (user).
  - Languages adopted at runtime (`adoptLang`) get a new team with no members, since site owners act in any team. *(My call.)*
- **A handover moves everything** (user, 2026-11-01): every row of the language switches team in one transaction. Players and packs see no change.
- **`edit` stays in `language_grant`** in this plan, with today's semantics and grantors. Splitting text maintainers from the team-level `edit` belongs with report routing (plan 3). *(My call; keeps single-team languages unchanged.)*
- **`team_member` is not row-level secured.** Like `team_language`, it is read before any team is set (a viewer's grants span teams), and it is written only by `lib/teams/members.ts`. *(My call.)*
- **0091 is additive.** It copies the audio grants into `team_member` and leaves them in `language_grant`, where the new code no longer reads them. Deleting them is a later migration, so a rollback to the current release still works. *(My call.)*

## Global Constraints

- Migrations: plain SQL, next number `0091`, applied by `deploy/web/bin/migrate.sh`, one transaction each, additive.
- Every write to a team table runs under `withTeam` (`apps/web/src/lib/db.ts`). Cross-team system work uses `ALL_TEAMS`.
- Tests run as `spoken_app` (`DATABASE_ROLE`, `vitest.config.ts`) on `spoken_ci_pin`, never `spoken_dev`. Fixtures use `asSystem` from `src/lib/teams/testing.ts`.
- Team slug: `^[a-z][a-z0-9-]{1,40}$` (0087). One privileged team per language (`team_language_privileged_idx`).
- `enUS` never moves: English is one team (spec *Non-goals*).
- Single-team languages see no change: same pages, same grants table in `/[lang]/admin`, same packs.
- Progress output for any loop that takes noticeable time: the migration raises a `notice` per language moved (`3/7 deDE`) and a summary.

## Review Focus

1. **A handover while a job runs.** A `running` `regeneration_job` in the language would commit its take under the old team after the move. Expected: the move refuses with a message naming the job count, and moves nothing. Tested in Task 2.
2. **The other pm2 worker's memo after a move.** It would keep writing the language's rows under the old team for up to 60 s. Expected: the `NOTIFY` clears it within a second. Tested in Task 4.
3. **A user holding both an `edit` grant and an audio capability in one language.** Expected: `/[lang]/admin` lists both, as today, and removing one leaves the other. Tested in Task 3.
4. **Handing a language to a team that has no roster yet.** Expected: the team gets a copy of the source team's voices, assignments, base generation settings and queue dismissal, so the language voices exactly as before. Tested in Task 2.
5. **A team admin granting `admin` in a language outside their team.** Expected: 403. Tested in Task 3.

---

### Task 1: `team_member`, `move_team_lang`, and one team per language

**Files:**
- Create: `apps/web/migrations/0091_team_member.sql`
- Test: `apps/web/src/lib/teams/move.test.ts`, `apps/web/src/lib/teams/rls.test.ts` (exemption)
- Modify: `docs/platform/TEAMS.md` (*Roles*, *Migration* and *Not in this plan* follow the decisions above)

**Interfaces:**
- Produces:
  - table `team_member("teamId" uuid not null references team on delete cascade, "userId" text not null references "user" on delete cascade, "lang" text not null, "capability" text not null check (capability in ('regenerate','configure','ignore','admin','record')), "grantedAt" timestamptz not null default now(), "grantedBy" text references "user" on delete set null, primary key ("teamId","userId","lang","capability"))`, plus an index on `("userId")`. `spoken_app` gets select, insert and delete.
  - function `move_team_lang(p_lang text, p_team uuid) returns integer`: the number of rows moved. It is `security invoker`, so it runs under the caller's RLS. The app calls it under `ALL_TEAMS`.
  - function `new_team(p_slug text, p_name text) returns uuid`: inserts a team with no languages and returns its id. If a team with that slug exists, it returns that team's id.
  - function `adopt_lang(p_lang text) returns void`: if `team_of_lang(p_lang)` is null, calls `new_team(lower(p_lang), p_lang)` and inserts the privileged `team_language` row, then notifies as in step 5. Otherwise it does nothing.

`move_team_lang` must, in order:
1. Refuse `enUS`, an unknown team, a target that already holds `p_lang`, and a language with any `regeneration_job` in state `running`. Each refusal raises an exception naming the reason.
2. Copy the source team's `voice`, `voice_assignment`, `generation_setting` and `queue_dismissal` rows to the target if the target has no `voice` rows. Use the same column lists as `ownTeam` in `src/lib/teams/testing.ts`, with `on conflict do nothing`.
3. Update `"teamId"` from source to target in the 16 tables with a `lang` column (`take`, `recording`, `take_ack`, `voice_clone`, `fish_reference`, `generation_setting_locale`, `pronunciation_lexicon_locale`, `lexicon_change`, `line_ignore`, `line_flag`, `line_issue`, `report`, `regeneration_batch`, `regeneration_job`, `regeneration_pause`, `activity`). Also update `voice_sample` where `clone` ends with `'@' || p_lang`, `line_issue_line` through its issue, and `team_member` rows of `p_lang`.
4. Move the privileged `team_language` row: delete the source's, insert the target's.
5. `perform pg_notify('spoken_team_language', p_lang)`.

The migration body, after creating both functions: for each `team_language` row of team `english` with `lang <> 'enUS'`, ordered by lang:
- create the team with `new_team(lower(lang), lang)`;
- call `move_team_lang(lang, <that team>)`;
- `raise notice '% / % %'`.

Then:
- copy `language_grant` rows whose capability is not `edit` into `team_member`, with the team from `team_of_lang(lang)`;
- insert `admin` for the user whose email is `x@rusty.one`, if present, in every team created here, for its language;
- raise a summary notice.

- [ ] **Step 1: Write the failing tests** in `move.test.ts`, using `asSystem` fixtures and an `ownTeam("deDE")`-style setup:
  - `it("moves every row of the language to the new team")`: seed one row each in `take`, `report`, `voice_clone`, `voice_sample` (clone `x@deDE`) and `line_issue` with a `line_issue_line`. Call `move_team_lang('deDE', target)`. Expect every row's `teamId` to equal `target`, and `team_of_lang('deDE') = target`.
  - `it("copies the roster to a team that has none")`: expect `count(*)` from `voice` for the target to equal the source's, and a `generation_setting` row to exist for the target.
  - `it("refuses while a job runs")`: insert a `running` `regeneration_job` in deDE. Expect the call to reject with `/running/`, and `team_of_lang('deDE')` to be unchanged.
  - `it("refuses enUS")`: rejects with `/enUS/`.
  - `it("leaves another language's rows alone")`: a frFR `take` keeps its team.
  - In `rls.test.ts`, the exemption becomes `c."relname" not in ('team_language', 'team_member')`, with the comment saying both are read before a team is set.
- [ ] **Step 2: Run them to see them fail**
  Run: `cd apps/web && pnpm exec vitest run src/lib/teams/move.test.ts`
  Expected: FAIL with `function move_team_lang(...) does not exist`.
- [ ] **Step 3: Write `0091_team_member.sql`** as specified above, and apply it to `spoken_ci_pin`: `DATABASE_URL=postgres:///spoken_ci_pin deploy/web/bin/migrate.sh $PWD/apps/web`.
- [ ] **Step 4: Run the tests to see them pass**, plus `src/lib/teams` as a whole.
  Run: `cd apps/web && pnpm exec vitest run src/lib/teams`
  Expected: PASS.
- [ ] **Step 5: Check the migration on a copy of `spoken_dev`:** `createdb -T spoken_dev spoken_m91` and migrate it. Expect one notice per English-parked language, then `select t."slug", tl."lang" from team t join team_language tl on tl."teamId" = t."id" order by 2` to show `english` only on `enUS`. Drop the copy.
- [ ] **Step 6: Commit** `feat(teams): team members, and every language a team of its own`.

### Task 2: the team store

**Files:**
- Create: `apps/web/src/lib/teams/admin.ts`, `apps/web/src/lib/teams/admin.test.ts`
- Modify: `apps/web/src/lib/teams/store.ts` (`adoptLang` calls `adopt_lang`), `apps/web/src/lib/activity/kinds.ts`

**Interfaces:**
- Consumes: `move_team_lang`, `new_team` and `adopt_lang` from Task 1; `withTeam` and `ALL_TEAMS`; `recordActivity`; `forgetTeams`.
- Produces:
  - `type TeamSummary = { id: TeamId; slug: string; name: string; langs: Lang[]; members: { userId: string; email: string; name: string | null; lang: Lang; capability: Capability }[] }`
  - `listTeams(): Promise<TeamSummary[]>`
  - `createTeam(input: { slug: string; name: string; adminEmail: string | null }, actorId: string): Promise<TeamId>`: throws `TeamInputError` on a bad or taken slug, or an unknown email.
  - `renameTeam(team: TeamId, name: string, actorId: string): Promise<void>`
  - `handOver(lang: Lang, team: TeamId, actorId: string): Promise<number>`: rows moved. It calls `forgetTeams()` after the commit.
  - `class TeamInputError extends Error`
  - Activity kinds `team.created` (`{ slug: string }`), `team.renamed` (`{ name: string }`) and `team.language_moved` (`{ from: string; to: string }`, slugs).

`createTeam` writes the team only: no languages, no members. Membership is per language, so a team's first admin is granted `admin` in each language after it is handed over. The POST route (Task 5) does create, hand over and grant in one request.

- [ ] **Step 1: Failing tests** in `admin.test.ts`:
  - `createTeam` with slug `Bad Slug` throws `TeamInputError`.
  - A duplicate slug throws `TeamInputError`.
  - `handOver("deDE", t)` returns a number greater than 0, `teamOf("deDE")` equals `t` immediately on this process, and an activity row of kind `team.language_moved` exists.
  - `listTeams()` includes the new team with `langs: ["deDE"]`.
  - `adoptLang` for an unowned code creates a team whose slug is the lowercased code (through `adopt_lang`).
  Restore the fixtures in `afterEach` by handing deDE back.
- [ ] **Step 2: Run them to see them fail:** `pnpm exec vitest run src/lib/teams/admin.test.ts`.
- [ ] **Step 3: Implement `admin.ts`** and the `adoptLang` change. Writes run under `withTeam(ALL_TEAMS, …)`. Map Postgres unique and check violations on `team` to `TeamInputError`.
- [ ] **Step 4: Run `src/lib/teams` and `src/lib/activity`:** both PASS.
- [ ] **Step 5: Commit** `feat(teams): create a team, rename it, hand it a language`.

### Task 3: grants read and write both tables

**Files:**
- Modify: `apps/web/src/lib/grants/store.ts`, `apps/web/src/lib/permissions.ts` (`canGrant`)
- Create: `apps/web/src/lib/teams/members.ts`
- Test: `apps/web/src/lib/grants/store.test.ts`, `apps/web/src/lib/permissions.test.ts`

**Interfaces:**
- Consumes: `team_member` (Task 1), `teamOf` (`lib/teams/store.ts`).
- Produces (signatures unchanged, so `/api/grants`, `UserTable` and `useCan` need no edits):
  - `grantsOf(userId)`: `language_grant` rows with `capability = 'edit'`, unioned with `team_member` rows. Rows of other capabilities in `language_grant`, left there by 0091, are ignored.
  - `listGrants(langs?)`: the same union with user email and name.
  - `addGrants(userId, lang, caps, grantedBy)`: `edit` goes to `language_grant`; the rest go to `team_member` for `teamOf(lang)`. All in one transaction; activity as today.
  - `removeGrant`: routes the same way.
  - `members.ts` exports `insertMembers(client, team, userId, lang, caps, grantedBy): Promise<Capability[]>` (the new rows) and `deleteMember(client, team, userId, lang, cap): Promise<boolean>`. It is the only module that names `team_member`'s columns.
  - `canGrant(viewer, cap, lang)`: a site admin may grant anything; otherwise any capability requires `can(viewer, "admin", lang)`. That holds for `admin` too (spec *Roles*, my call).

- [ ] **Step 1: Failing tests:**
  - `store.test.ts`, `it("keeps an edit grant and a team capability apart")`: `addGrants(u, "deDE", ["edit","regenerate"])` puts one row in `language_grant` and one in `team_member`. `grantsOf(u)` returns both. `removeGrant(u,"deDE","regenerate")` leaves `edit`.
  - `it("ignores audio grants left in language_grant")`: insert a `configure` row in `language_grant` directly; `grantsOf` does not return it.
  - `permissions.test.ts`: a language admin of deDE may grant `admin`, `configure` and `record` in deDE, and none of them in frFR.
- [ ] **Step 2: Run them to see them fail:** `pnpm exec vitest run src/lib/grants src/lib/permissions.test.ts`.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run them, plus `src/app/api/grants`:** PASS.
- [ ] **Step 5: Commit** `feat(teams): audio capabilities live on team membership`.

### Task 4: both workers forget teams on a change

**Files:**
- Create: `apps/web/src/lib/teams/listen.ts`, `apps/web/src/lib/teams/listen.test.ts`
- Modify: `apps/web/src/lib/teams/store.ts` (`teamLangs` starts the listener once)

**Interfaces:**
- Consumes: the `spoken_team_language` notification (Task 1), `forgetTeams`.
- Produces: `listenForTeamChanges(): void`, idempotent per process. It holds one dedicated `pg.Client` (not from the pool) on `DATABASE_URL`, with the same role option as `db()`, runs `LISTEN spoken_team_language`, and calls `forgetTeams()` on each notification. On a connection error it logs, drops the client and retries after 5 s. The 60 s TTL stays as the backstop. `stopListening(): Promise<void>` is for tests.

- [ ] **Step 1: Failing test**, `it("forgets the memo when another connection moves a language")`: warm `teamLangs()`, then run `select pg_notify('spoken_team_language','deDE')` from `asSystem`. Within 1 s (poll every 50 ms), the next `teamLangs()` call issues a fresh read; spy on `query` or compare map identity.
- [ ] **Step 2: Run it to see it fail.**
- [ ] **Step 3: Implement**, and start the listener from the first `teamLangs()` call. Skip it when `process.env.VITEST` is set, unless a test starts it explicitly.
- [ ] **Step 4: Run `src/lib/teams`:** PASS.
- [ ] **Step 5: Commit** `feat(teams): a language changing team reaches every worker`.

### Task 5: the teams page for site owners

**Files:**
- Create: `apps/web/src/app/api/teams/route.ts` (GET list, POST create), `apps/web/src/app/api/teams/[id]/route.ts` (PATCH name), `apps/web/src/app/api/teams/[id]/languages/route.ts` (PUT `{ lang }` hands it over), `apps/web/src/app/[lang]/admin/teams/page.tsx`, `apps/web/src/components/TeamsTable.tsx`
- Modify: `apps/web/src/app/[lang]/admin/page.tsx` (a "Teams" link, shown only to site admins)
- Test: `apps/web/src/app/api/teams/route.test.ts`

**Interfaces:**
- Consumes: Task 2's `listTeams`, `createTeam`, `renameTeam`, `handOver` and `TeamInputError`; Task 3's `addGrants`; `isAdmin`; `currentSession`.
- Produces:
  - Every route answers 403 unless `isAdmin(session.user.role)`.
  - `TeamInputError` maps to 400 `{ error }`.
  - A running-job refusal from `move_team_lang` maps to 409 `{ error }`.
  - POST body is `{ slug, name, langs: Lang[], adminEmail?: string }`. It creates the team, hands over each language, and grants `adminEmail` the capability `admin` in each language. It returns `{ team: TeamSummary }`.

The page lists the teams: slug, name (editable inline), languages, and members grouped by person with their capabilities per language. Each language has a "Move to…" select of the other teams, behind a confirm that says how many takes move. The "New team" form has slug, name, a languages multi-select and an admin email. Reuse `UserTable`'s styling; no new design.

- [ ] **Step 1: Failing route tests:**
  - A member session gets 403 on all four.
  - An admin POST with `{slug:"german", name:"German", langs:["deDE"]}` returns a team with `langs:["deDE"]`.
  - A PUT handing over a language with a running job returns 409.
  - A bad slug returns 400.
  Use the `vi.mock("@/lib/session", …)` pattern from the voice-route tests.
- [ ] **Step 2: Run them to see them fail.**
- [ ] **Step 3: Implement the routes, then the page.**
- [ ] **Step 4: Run the route tests:** PASS. Then `pnpm exec tsc --noEmit`.
- [ ] **Step 5: Check in the browser on `spoken_dev`** (dev server `PORT=3007 pnpm --filter @spoken/web dev`). As a site admin, open `/enUS/admin/teams`. The migrated teams are listed, and `english` holds only `enUS`. Create a throwaway team, hand it a language with no takes, hand it back, and delete the team with `psql`.
- [ ] **Step 6: Commit** `feat(teams): a teams page for site owners`.

### Task 6: runbook

**Files:**
- Modify: `deploy/web/README.md` (a "Teams, members" section)

- [ ] **Step 1:** Write the section:
  - Before merging, preview what 0091 will split: `psql "$PROD_DATABASE_URL" -c "select tl.lang from team_language tl join team t on t.id = tl.\"teamId\" where t.slug = 'english' and tl.lang <> 'enUS'"`.
  - Confirm `x@rusty.one` exists in `user`.
  - Pause the queue: a running job in a moved language aborts the migration and the deploy.
  - After the deploy, check `/enUS/admin/teams`.
  - Rolling back to the previous release works: 0091 only adds.
- [ ] **Step 2: Commit** `docs(deploy): the members release`.

## Not in this plan

- Deleting the audio grants 0091 leaves in `language_grant`, and narrowing its capability check to `edit`.
- The text-maintainer `edit` split from the team-level `edit`, report routing, and pass-to actions (plan 3).
- Deleting a team, and a team admin's own page for their team. Team admins keep using `/[lang]/admin`.
- The Release button (plan 4).
