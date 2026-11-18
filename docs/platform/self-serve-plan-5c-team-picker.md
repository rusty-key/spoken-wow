# Self-serve plan 5c: the Explorer's team picker

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** In a language with a second team, the Explorer lists the teams that voice it and plays whichever team's live takes the visitor picks (`?team=<slug>`), anonymous visitors included. A site owner can act inside a second team, with full rights, through the same picker. The queue panel shows each team only its own finished lines and pauses, and a site owner's Stop reaches every team's queue.

**Architecture:** Another team's live takes are read through one security-definer function, `team_live_takes`, that returns only current takes of a named team and language, never history, cost or authorship. A sibling, `team_live_overrides`, returns that team's override text only for lines it has a live take of, so the text shown matches what is heard. No per-team policy is loosened. Viewing a team other than the one the visitor acts as is read-only: the search routes build the result from the shared original text, that team's live takes and those overrides, with none of the acting team's overrides, reports, dirt or made-by, and the audio routes serve its bytes through the same function. Acting is unchanged for members (their team, derived, 5a). A site owner's choice of team in a language is kept in a cookie, and `actingTeams()` overlays it for site owners only, so every per-team read and write (`ownerOf`) follows it with no new call site. The queue snapshot narrows its finished and paused lists to the acting team only in languages with a second team; `cancelPending` gains an every-team scope for a site owner.

**Tech Stack:** Postgres 16 plain-SQL migrations (`apps/web/migrations`), node-postgres, Node `AsyncLocalStorage`, Next.js App Router (`apps/web`, `next/headers` `cookies()`), Vitest with Testing Library.

**Spec:** [`SELF-SERVE-TEAMS.md`](SELF-SERVE-TEAMS.md), *Second team in a language* (Explorer); [`TEAMS.md`](TEAMS.md), *Roles → Site owners*, *Who sees what*, *Isolation with row-level security*, *Phase 2* (Explorer). Builds on [plan 5a](self-serve-plan-5-second-team.md) (the outline of 5c, `actingTeams`, `ownerOf`'s overlay) and [plan 5b](self-serve-plan-5b-text-layer.md) (`baseCatalogue`).

## Decisions

- **Live takes are public across teams; everything else stays private** *(spec, TEAMS.md "Who sees what")*. `team_live_takes` returns a current take's line id, file, version, spoken hash, characters, duration, bytes and date, plus the archive location the server needs to serve the bytes (never sent to a browser). It does not return credits, cost, model, voice, provider, author, settings or the take count, which would reveal the team's history.
- **A narrow security-definer function, not a looser policy** *(spec, TEAMS.md "Isolation")*. Owned by the migration role, which bypasses row-level security (0090), with `set search_path = public`, executable by `spoken_app` only. It answers nothing for a team that does not voice the language.
- **Viewing another team shows that team's override on lines it has a live take of** *(user)*. The text then matches what is heard. An override on a line with no live take stays private, as overrides in progress are (TEAMS.md). `team_live_overrides` returns the override text and the line's key, nothing else: no author, date or original hash.
- **"A live take of the override" means a live take made at or after the override's last save** *(My call)*. A take made before the override was saved (or before its last edit) was spoken from other words, so showing the override would not match it, and the newer override is still in progress. Such a line shows the original text.
- **Viewing another team is read-only** *(My call)*. Each line reads as voiced or missing: no stale, dirty, made-by, report or recording marks, since each would need that team's private rows. The regenerate, override, ignore, record, report and clear-mark controls are hidden; the pencil that writes the original (`text`) stays, since the original is shared.
- **`?team=<slug>` chooses whose takes play; the default is the team the visitor acts as, else the privileged team** *(spec, 5a outline)*. For an anonymous visitor or someone in no team of the language that is the privileged team, so today's links play what they play now. A slug naming no team of the language is 404 `` `no team ${slug} voices ${lang}` `` from the search and audio routes; the page falls back to the default and the picker shows it.
- **The picker shows only where the language has a second team** *(spec, anti-goal "invisible while a language has one team")*. It reads `secondTeamLangs()` first, so a single-team language makes no extra query.
- **A site owner acts inside a team through the picker, held in a cookie** *(My call)*. TEAMS.md: a site owner may "act inside any team with full rights without being a member". The site's API calls come from many components through `withLang`, and a query parameter on each would have to be threaded through all of them; a cookie reaches every route and page through `actingTeams()`, the one place 5a overlays acting. The cookie `spoken_team` holds `{ [lang]: slug }`, is set by `POST /api/teams/acting`, and is read only when the session's user is a site owner (`isAdmin`); for anyone else it is ignored, so a member cannot act outside their team by editing it. An entry is kept only where it changes who the site owner acts as: choosing the team they would act as anyway (their own, else the privileged team) clears it, so a site owner who is a member of a second team can still act as the main team.
- **A site owner's choice wins over their own membership** *(My call)*: they chose it. One team per person per language still holds for their grants.
- **A site owner sees which team they act as** *(My call)*: while the cookie holds an entry for the page's language, the language header shows "Working as {team name}" on every page of that language, with the picker to change it.
- **The queue panel's finished and paused lists are the acting team's, in languages with a second team** *(5a outline)*. Counts, the per-person queues, running lines and failures stay as they are (they are already scoped by owner, or the site owner sees all). A single-team language's rows pass unfiltered.
- **A site owner's Stop reaches every team** *(5a outline; the Stop route's own comment: "a global admin's halts all of it")*. With no `batchId` it cancels pending work in every team of the languages; with a `batchId` it cancels in the batch's own team. Pause and Resume stay with the acting team (a site owner pauses a second team by acting in it) *(My call)*.
- **The quests view of another team builds its corpus as that team, and may reveal its voices** *(user)*. A quest line's file depends on the team's voice roster (`{file}-{voice}` stems), so the files whose takes play are that team's. Only the corpus is built inside `asTeam(lang, team, …)`; ignores, reports and the rest are not read, and overrides come from `team_live_overrides` alone. The voice-named files show which voice speaks which line, which is acceptable.
- **Landing pages (`/r/…`) keep the default team** *(My call)*. They are what the addon links to, and the player side is out of scope.

## Global Constraints

- One migration, `0115_team_live_takes.sql`: plain SQL, additive, one transaction, applied by `deploy/web/bin/migrate.sh`. 5b's release must run against it (it never calls the function).
- Tests run as `spoken_app` (vitest's default `DATABASE_ROLE`) on `spoken_ci_pin`, never `spoken_dev`. Fish: `set -x DATABASE_URL postgres://localhost/spoken_ci_pin; pnpm --dir apps/web vitest run <file>`. Migrate: `set -x DATABASE_URL postgres://localhost/spoken_ci_pin; deploy/web/bin/migrate.sh $PWD/apps/web`.
- Fixtures: `uniqueLang`, `newTeamIn`, `addMember`, `testUser`, `asSystem`, `systemRows`, `runningJob`, `dropTeam`, `dropLang` from `src/lib/teams/testing.ts`. Takes are inserted through `asSystem`, never generated.
- Nothing spends TTS credits. A test that queues cancels its jobs in `afterEach` (`cancelPending`) and deletes the batch.
- Known failures to ignore when running wider suites: `admin.test` handOver, the three `search` tests, `missing-audio`, `voices/slots`.
- Every per-team query goes through `withTeam` / `queryAs` / `readAs`. The only cross-team read added is `team_live_takes`, called through `query` (it needs no team set).
- Exact copy: unknown team `` `no team ${slug} voices ${lang}` `` (404); picker label "Team"; viewing note `` `You are listening to ${name}. Their takes play; their work is theirs.` ``; site owner banner `` `Working as ${name}` ``.
- Browser checks run on `spoken_dev` in the Paseo tab already open, never a new tab.
- Site changes add no changelog notes (AGENTS.md).

## Review Focus

1. **A private column or override leaks through the functions.** Expected: their result columns are exactly the lists in Task 1; no route sends `archiveFile` or `sha256` to a browser; an override on a line with no live take, or saved after its live take, is never returned. Tested in Tasks 1 and 3.
2. **Someone viewing another team acts on it.** A member with `?team=` of the other team, or with a forged `spoken_team` cookie, regenerates, overrides or pauses. Expected: every write goes to their own team; the cookie is ignored for anyone but a site owner. Tested in Tasks 4 and 5.
3. **A single-team language changes.** No picker, no cookie or membership read in `actingTeams` beyond what 5a reads, and the snapshot returns the same finished and paused rows. Tested in Tasks 2, 5 and 6.
4. **A site owner stops a second team's batch by id.** Expected: its pending jobs are cancelled and the batch stamped, though the site owner acts as the privileged team. Tested in Task 7.
5. **A slug of a team that voices another language.** `?team=` naming a real team that does not hold the page's language. Expected: 404 from the routes, the function returns nothing, and the page falls back to the default. Tested in Tasks 1 and 3.

---

### Task 1: Migration 0115, `team_live_takes` and `team_live_overrides`

**Files:**
- Create: `apps/web/migrations/0115_team_live_takes.sql`
- Test: `apps/web/src/lib/takes/team-live.test.ts`

**Interfaces:**
- Produces `team_live_takes(p_team uuid, p_lang text, p_source text, p_file text default null) returns table ("lineId" text, "file" text, "version" <take's type>, "spokenHash" text, "characters" <take's type>, "durationSec" <take's type>, "bytes" <take's type>, "createdAt" timestamptz, "archiveFile" text, "sha256" text)`, `language sql stable security definer set search_path = public`: current `take` rows of `p_team`, `p_lang`, `p_source` (and `p_file` when given), only when `team_language` has `(p_team, p_lang)`. `revoke all … from public; grant execute … to "spoken_app"`. Column types are the `take` table's own. The header comment says why these are functions (TEAMS.md "Isolation") and why each column is or is not returned.
- Produces `team_live_overrides(p_team uuid, p_lang text, p_source text) returns table ("key" text, "text" text)`, same attributes and grants *(user)*. Only when `team_language` has `(p_team, p_lang)`:
  - `p_source = 'quests'`: `line_override` rows of `p_team`, `p_lang`, keyed by `file`, where a current quests `take` of `p_team` and `p_lang` has that file or a voice file of it (`left(t."file", length(o."file") - 4) || '-'` prefix with `.mp3` suffix, as `overrideOf` resolves a voice's file to its line's) and `t."createdAt" >= o."updatedAt"`.
  - other sources: `text_override` rows of `p_team`, `p_lang`, `p_source`, keyed by `lineId`, where a current `take` of `p_team`, `p_lang`, `p_source` has that `lineId` and `t."createdAt" >= o."updatedAt"`.

- [ ] **Step 1: Write the failing tests** in `team-live.test.ts` (`uniqueLang`; A privileged, B second; through `asSystem`, B has a current and an older take of one places file, A one take of another):
  - Called through `query` (no team set), `team_live_takes(B, lang, 'places')` returns one row, the current one.
  - Its column names are exactly the ten above (Review Focus 1).
  - `team_live_takes(B, otherLang, 'places')`, where B does not voice `otherLang`, returns nothing, even with a take row there (Review Focus 5).
  - With `p_file`, only that file.
  - `team_live_overrides(B, lang, 'places')` with B overrides on three lines: one with a live take made after the override (returned), one with no take (not returned), one whose override was saved after its live take (not returned) (Review Focus 1). Its columns are exactly `key` and `text`.
  - `team_live_overrides(B, lang, 'quests')` returns a `line_override` whose live take is a voice file of it (`{stem}-{voice}.mp3`).
- [ ] **Step 2: Run it.** `set -x DATABASE_URL postgres://localhost/spoken_ci_pin; pnpm --dir apps/web vitest run src/lib/takes/team-live.test.ts`. Expected: FAIL, function does not exist.
- [ ] **Step 3: Write the migration.**
- [ ] **Step 4: Migrate and run it and `src/lib/teams/rls.test.ts`.** Expected: PASS.
- [ ] **Step 5: Commit.** `feat(teams): functions read a team's live takes and the overrides they speak, and only those`

### Task 2: Which teams voice a language, and which one is viewed

**Files:**
- Create: `apps/web/src/lib/teams/viewing.ts`
- Modify: `apps/web/src/lib/teams/store.ts` (the memo keeps each language's second teams), `apps/web/src/lib/takes/store.ts`
- Test: `apps/web/src/lib/teams/viewing.test.ts`

**Interfaces:**
- Consumes: Task 1's function; `ownerOrAll`, `privilegedOf`, `secondTeamLangs`.
- Produces:
  - In `store.ts`: `Mapping.seconds: Map<Lang, TeamId[]>`; `secondTeamLangs()` derived from it; `everyTeamOf(langs: readonly Lang[]): Promise<Map<TeamId, Lang[]>>`, each language grouped under its privileged team and every second team.
  - In `viewing.ts`:
    - `type TeamChoice = { id: TeamId; slug: string; name: string; privileged: boolean }`.
    - `teamsVoicing(lang: Lang): Promise<TeamChoice[]>`: `[]` without a query when `lang` is not in `secondTeamLangs()`; otherwise `team_language` joined to `team`, privileged first, then by name.
    - `viewedTeam(lang: Lang, slug: string | null): Promise<{ team: TeamId; slug: string; name: string; own: boolean } | null>`: `slug` null gives the acting team (`ownerOrAll`), else the privileged team; a slug not in `teamsVoicing(lang)` gives null; `own` is `team === await ownerOrAll(lang)`. For a single-team language with `slug` null, it returns the privileged team with `own: true` and reads nothing beyond the memo.
  - In `viewing.ts`: `teamLiveOverrides(team: TeamId, source: Source, lang: Lang): Promise<Map<string, string>>`, the function's rows as key → text *(user)*.
  - In `takes/store.ts`: `type PublicTake = { lineId; file; version; spokenHash: string | null; characters: number | null; durationSec: number | null; bytes: number; createdAt: Date }`; `teamLiveTakes(team: TeamId, source: Source, lang: Lang): Promise<PublicTake[]>`; `teamLivePath(team, source, file, lang): Promise<TakeBytes>` (through `located`).

- [ ] **Step 1: Write the failing tests** in `viewing.test.ts` (A privileged, B second, U in B):
  - `teamsVoicing(lang)` is `[A, B]` with A first; `teamsVoicing("deDE")` is `[]` and, with `query` spied, makes no query (Review Focus 3).
  - `viewedTeam(lang, null)` inside `asActor(U, …)` is B with `own: true`; outside, A with `own: true`; `viewedTeam(lang, A's slug)` inside `asActor(U, …)` is A with `own: false`; a slug of a team in another language is null.
  - `everyTeamOf([lang])` maps A and B to `[lang]`.
  - `teamLiveTakes(B, "places", lang)` has B's take and no `credits` key.
  - `teamLiveOverrides(B, "places", lang)` maps the taken line to its override text.
- [ ] **Step 2: Run it.** `set -x DATABASE_URL postgres://localhost/spoken_ci_pin; pnpm --dir apps/web vitest run src/lib/teams/viewing.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run it and `src/lib/teams`.** Expected: PASS.
- [ ] **Step 5: Commit.** `feat(teams): the teams voicing a language, and the one a visitor views`

### Task 3: Search and audio routes serve another team's takes

**Files:**
- Modify: `apps/web/src/app/api/places/search/route.ts`, `apps/web/src/app/api/bosses/search/route.ts`, `apps/web/src/app/api/readables/search/route.ts`, `apps/web/src/app/api/quests/search/route.ts`, `apps/web/src/app/api/quests/search/lines/route.ts`, `apps/web/src/app/api/places/audio/[...path]/route.ts`, `apps/web/src/app/api/bosses/audio/[...path]/route.ts`, `apps/web/src/app/api/readables/audio/[...path]/route.ts`, `apps/web/src/app/api/quests/audio/[...path]/route.ts`, `apps/web/src/lib/places/catalogue.ts` (`publicContext`), `apps/web/src/lib/readables/catalogue.ts` (`publicContext`), `apps/web/src/lib/quests/context.ts` (`publicSearchContext`)
- Test: `apps/web/src/app/api/places/search/team.test.ts`, `apps/web/src/app/api/quests/search/team.test.ts`, `apps/web/src/app/api/places/audio/team.test.ts`

**Interfaces:**
- Consumes: Task 2's `viewedTeam`, `teamLiveTakes`, `teamLivePath`, `teamLiveOverrides`; 5b's `baseCatalogue` (places, bosses, readables) and `OverrideView`.
- Produces:
  - Each route reads an optional `team` query parameter. `viewedTeam` null: 404 with the exact message. `own: true`: today's path, unchanged.
  - `own: false`, places/bosses/readables: entries from `baseCatalogue(lang)`, each line in `teamLiveOverrides` given `override: { text, drifted: false, updatedAt: "", updatedBy: null }` so the row shows what is heard *(user)* (`spoken` and `hash` stay the base's: the view computes no staleness); context from `publicContext(source, lang, team): Promise<SearchContext>` with `takes` from `teamLiveTakes` (`credits: null`, `modelId: null`, `voiceId: null`, `takes: 1`), `reports` empty, `dirt` `NO_DIRT`, no `madeBy`, no `recordings`; the made-by, recorded, dirty and stale filters are dropped as `seesMadeBy` drops them; a line with a take reads `current`.
  - `own: false`, quests: `asTeam(lang, team, () => corpus(lang))` for the corpus; `publicSearchContext(lang, team)` with `voiced`, `takes` and `generatedAt` from `teamLiveTakes`, `overrides` from `teamLiveOverrides` (as `LineOverride`s with `originalHash: null`, so none reads as drifted) *(user)*, the rest `NO_CONTEXT`.
  - Audio routes, `own: false`: `serveTake(request, await teamLivePath(team, source, file, lang), …)`.

- [ ] **Step 1: Write the failing tests.**
  - `places/search/team.test.ts` (no session; A privileged with a take of line 1, B second with a take of line 2 made after B's override of line 2, and a B override of line 3, which has no take, all through `asSystem`): `?team=<B slug>` lists line 2 `current` with B's override text, line 1 `missing`, line 3 with `override` null *(user)*, and the body holds no `archiveFile`, `sha256` or `credits` (Review Focus 1); no `team` lists A's takes, as today; `?team=nope` is 404 with the exact message; a real team of another language is 404 (Review Focus 5).
  - `quests/search/team.test.ts`: `?team=<B slug>` marks B's voiced file and not A's, and shows B's override on that file and on no file without a B take.
  - `places/audio/team.test.ts`: `?team=<B slug>` serves B's take (the archived file through `asSystem`, as `src/lib/takes/serve.test.ts` seeds one); without `team`, A's.
- [ ] **Step 2: Run them.** `set -x DATABASE_URL postgres://localhost/spoken_ci_pin; pnpm --dir apps/web vitest run src/app/api/places src/app/api/quests/search`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run them and `src/app/api/bosses src/app/api/readables src/lib/takes`.** Expected: PASS.
- [ ] **Step 5: Commit.** `feat(teams): the explorer's routes play another team's live takes`

### Task 4: The picker and the read-only view

**Files:**
- Create: `apps/web/src/components/TeamPicker.tsx`
- Modify: `apps/web/src/app/[lang]/quests/page.tsx`, `apps/web/src/app/[lang]/places/page.tsx`, `apps/web/src/app/[lang]/bosses/page.tsx`, `apps/web/src/app/[lang]/readables/page.tsx`, `apps/web/src/components/Explorer.tsx`, `apps/web/src/components/places/Explorer.tsx`, `apps/web/src/components/readables/Explorer.tsx`, the audio URL helpers each player uses
- Test: `apps/web/src/components/TeamPicker.test.tsx`, `apps/web/src/components/places/Explorer.team.test.tsx`

**Interfaces:**
- Consumes: Task 2's `teamsVoicing`, `viewedTeam`; Task 3's `team` parameter.
- Produces:
  - Each page resolves `teams = await teamsVoicing(lang)` and `viewed = await viewedTeam(lang, searchParams.team ?? null)` (null falls back to `viewedTeam(lang, null)`) and passes `{ teams, viewed }` to its Explorer.
  - `TeamPicker({ teams, viewed, onPick(slug: string) })`: renders nothing for fewer than two teams; a select labelled "Team", the privileged team marked "(main)".
  - Explorers: picking sets `?team=<slug>` (removed when it is the default) and every search and audio request carries `team` while `viewed.own` is false. With `viewed.own` false, `canRegenerate`, the override control, ignore, record and clear-mark are off; the original pencil keeps its `text` gate; a line with an override shows it as its spoken line, with no drift mark; the viewing note shows.

- [ ] **Step 1: Write the failing tests.**
  - `TeamPicker.test.tsx`: one team renders nothing; two render a select with the main team first; picking calls `onPick` with the slug.
  - `Explorer.team.test.tsx` (fetch mocked, `useCan` granting `regenerate` and `text`): with `viewed.own` false, the search request carries `team=<slug>`, no regenerate or override button renders, the original pencil does, and audio `src`s carry `team=` (Review Focus 2); with `own` true, today's controls render and no `team` is sent.
- [ ] **Step 2: Run them.** `pnpm --dir apps/web vitest run src/components/TeamPicker.test.tsx src/components/places/Explorer.team.test.tsx`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run them, `src/components` and `pnpm --dir apps/web typecheck`.** Expected: PASS.
- [ ] **Step 5: Commit.** `feat(teams): a team picker in the explorer, read-only for another team`

### Task 5: A site owner acts inside a team

**Files:**
- Create: `apps/web/src/lib/teams/acting-cookie.ts`, `apps/web/src/app/api/teams/acting/route.ts`
- Modify: `apps/web/src/lib/teams/acting.ts` (`sessionTeams`), `apps/web/src/components/TeamPicker.tsx`, `apps/web/src/app/[lang]/layout.tsx` (the banner)
- Test: `apps/web/src/lib/teams/acting-cookie.test.ts`, `apps/web/src/app/api/teams/acting/route.test.ts`

**Interfaces:**
- Consumes: Task 2's `teamsVoicing`; `isAdmin` (`lib/permissions.ts`); the cookie pattern of `lib/invites/cookie.ts`.
- Produces:
  - `ACTING_COOKIE = "spoken_team"`, JSON `{ [lang]: slug }`, `httpOnly`, `sameSite: "lax"`, path `/`, a year.
  - `chosenTeams(): Promise<Map<string, TeamId>>`: the cookie's entries whose slug names a team voicing that language (one query over `team_language` join `team`, only for languages in `secondTeamLangs()`); a malformed cookie is an empty map.
  - `sessionTeams` becomes: `memberTeams(userId)`, overlaid with `chosenTeams()` when `isAdmin(session.user.role)`. `cookies()` is read only for a site owner, and only when `secondTeamLangs()` is not empty.
  - `POST /api/teams/acting` `{ lang: string; team: string | null }`: site owners only (403 `"not allowed"` otherwise); a slug not voicing `lang` 404 with the exact message; a privileged slug or null removes `lang`'s entry; answers `{ team: slug | null }`.
  - For a site owner, `TeamPicker` POSTs before navigating, so the view and the acting team are the same; the `[lang]` layout shows "Working as {name}" with the picker while the cookie names a non-privileged team for that language.

- [ ] **Step 1: Write the failing tests.**
  - `acting-cookie.test.ts` (`next/headers` and `@/lib/session` mocked; A privileged, B second): a site owner with cookie `{lang: B slug}` gets `ownerOrAll(lang)` B and `queryAs(lang, insert into "line_ignore" …)` writes B's row; a member of A with the same cookie gets A (Review Focus 2); a site owner with `{lang: "nope"}` gets A; with no second team anywhere, `cookies` is never called (Review Focus 3).
  - `route.test.ts`: a site owner's POST sets the cookie; a member's is 403; `team` null clears the entry; a team of another language is 404.
- [ ] **Step 2: Run them.** `set -x DATABASE_URL postgres://localhost/spoken_ci_pin; pnpm --dir apps/web vitest run src/lib/teams/acting-cookie.test.ts src/app/api/teams/acting`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run them, `src/lib/teams` and `src/app/api/v1/[section]/generate`.** Expected: PASS.
- [ ] **Step 5: Commit.** `feat(teams): a site owner works inside a second team through the picker`

### Task 6: The queue panel lists only the acting team's finished lines and pauses

**Files:**
- Modify: `apps/web/src/lib/generation/queue.ts` (`snapshot`), `apps/web/src/app/api/regenerate/queue/route.ts`
- Test: `apps/web/src/lib/generation/queue-teams.test.ts`

**Interfaces:**
- Consumes: `secondTeamLangs`, `freshOwners`.
- Produces:
  - `snapshot(since, options: { viewerId?; maxActive?; linesOf?; teams?: ReadonlyMap<Lang, TeamId> })`. `teams` is passed to the SQL as `$3::jsonb` (`{lang: teamId}`); `finished_page` and `pauses` keep a row when `not ($3 ? "lang") or "teamId" = ($3 ->> "lang")::uuid`. Absent `teams` is `{}`, which keeps every row.
  - The GET route passes `teams = await freshOwners([...await secondTeamLangs()])`, so only languages with a second team are narrowed, to the team the viewer acts as (the site owner's chosen one, Task 5).
  - The `cursor` rule (a full page ends at its own last row) is unchanged and applies to the narrowed page.

- [ ] **Step 1: Write the failing test** `queue-teams.test.ts` (A privileged, B second; one done job with a version in each, one pause in each, through `asSystem`):
  - `snapshot(null, {teams: new Map([[lang, B]])})`: `finished` holds B's job only and `paused` B's pause only.
  - `snapshot(null)`: both of each.
  - A done job in a single-team fixture language stays in `finished` whatever `teams` holds for another language (Review Focus 3).
- [ ] **Step 2: Run it.** `set -x DATABASE_URL postgres://localhost/spoken_ci_pin; pnpm --dir apps/web vitest run src/lib/generation/queue-teams.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run it, `src/lib/generation/queue.test.ts` and `src/app/api/regenerate`.** Expected: PASS, with the pooled-query count the existing test pins unchanged.
- [ ] **Step 5: Commit.** `fix(teams): the queue panel shows each team its own finished lines and pauses`

### Task 7: A site owner's Stop reaches every team

**Files:**
- Modify: `apps/web/src/lib/generation/queue.ts` (`cancelPending`), `apps/web/src/app/api/regenerate/queue/stop/route.ts`
- Test: `apps/web/src/app/api/regenerate/queue/stop/route.test.ts`

**Interfaces:**
- Consumes: Task 2's `everyTeamOf`.
- Produces:
  - `cancelPending(because, scope: { batchId?; langs?; by?; everyTeam?: boolean })`: with `everyTeam`, the teams are `everyTeamOf(langs)` instead of `byTeam(langs)`; with a `batchId` and `everyTeam`, only the batch's own team (read as `ALL_TEAMS` from `regeneration_batch`).
  - The Stop route passes `everyTeam: isAdmin(session.user.role)`. Anyone else's Stop is unchanged.

- [ ] **Step 1: Write the failing tests** in `stop/route.test.ts` (session mocked; A privileged, B second; one pending job in each through `asSystem`, cancelled in `afterEach`):
  - A site owner's Stop with no body cancels both, and B's batch has `stoppedBecause` set.
  - A site owner's Stop with B's `batchId` cancels B's job only (Review Focus 4).
  - A member of A with `regenerate` stops A's job only, as today.
- [ ] **Step 2: Run it.** `set -x DATABASE_URL postgres://localhost/spoken_ci_pin; pnpm --dir apps/web vitest run src/app/api/regenerate/queue/stop`. Expected: FAIL, B's job stays pending.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run it and `src/lib/generation/queue.test.ts`.** Expected: PASS.
- [ ] **Step 5: Commit.** `fix(teams): a site owner's Stop reaches a second team's queue`

### Task 8: The docs, and everything run

**Files:**
- Modify: `docs/platform/SELF-SERVE-TEAMS.md`, `docs/platform/TEAMS.md`

**Interfaces:**
- `SELF-SERVE-TEAMS.md`: the status line names 5c; *Explorer* says how the picker works: whose takes play, the default, read-only for another team, and a site owner acting through it.
- `TEAMS.md`: *Isolation* names `team_live_takes` and `team_live_overrides` as the narrow path and what each returns; *Who sees what* says a team's override is public on a line it has a live take of, made since the override's last save, and private otherwise *(user)*; *Roles → Site owners* says acting inside a team is done through the picker and lasts until changed; *Phase 2 → Explorer* says it is built.

- [ ] **Step 1: Write the doc edits.**
- [ ] **Step 2: Run everything.** `set -x DATABASE_URL postgres://localhost/spoken_ci_pin; pnpm --dir apps/web test`, then `make lint`. Expected: PASS apart from the known failures. Then in the Paseo tab on `spoken_dev`, in a language with a second team: signed out, the places Explorer shows the picker and plays the main team's takes; picking the second team plays its takes and shows no controls; as a member of the second team, the default is your team; as a site owner, pick the second team, see "Working as …" on `/voices`, regenerate one line on your own key and see the take in the second team, then press Stop with a job pending in each team and see both cancelled.
- [ ] **Step 3: Commit.** `docs(teams): the explorer's team picker`

## Settled with the user (2026-11-17)

- The quests view of another team may reveal its voices through file names *(user)*.
- Another team's view shows that team's override text on lines it has a live take of; overrides on lines with no live take stay private *(user)*. Tasks 1 and 3 carry it.
