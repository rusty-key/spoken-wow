# Self-serve plan 5b: a team's text layer for every source, on the site

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every team can override the spoken text of a place, readable page or boss story on the site, as it already can a quest line, and the text a team voices, shows as stale and generates from is its override where present, else the original. The original stays `text`'s alone, in every language.

**Architecture:** Quests keep `line_override` (file-keyed, per team). Places, readables and bosses get one new per-team table, `text_override`, keyed by line id, under row-level security like every per-team table. Each of the three catalogues splits in two: a base built only from shared text (memoised per language, as before 5a) and a per-team overlay that replaces `spoken` and `hash` where the acting team has an override, memoised per team with `memoByTeamLang`. Staleness, the dirty mark, the generation planner and `regenerateNarrated` already read `spoken` and `hash` from the catalogue, so they follow the overlay without change. A site route and an Explorer control write the overrides under `regenerate`.

**Tech Stack:** Postgres 16 plain-SQL migrations (`apps/web/migrations`), node-postgres, Next.js App Router (`apps/web`), Vitest with Testing Library.

**Spec:** [`SELF-SERVE-TEAMS.md`](SELF-SERVE-TEAMS.md), *Second team in a language* (Text layer); [`TEAMS.md`](TEAMS.md), *Text: original and overrides*, *Roles*, *Isolation with row-level security*, *Phase 2* (Text layer). Builds on [plan 5a](self-serve-plan-5-second-team.md) (its *Decisions* and the outline of 5b).

## Scope: 5b is two PRs

5b as outlined is two changes of reviewable size each, one plan and one PR each, in order *(My call; separate files per the user)*:

- **This plan (5b):** the store, the three catalogue overlays, the site route and the Explorer's override controls. After it, any team overrides a place, readable or boss line on the site.
- **[Plan 5b2](self-serve-plan-5b2-text-api.md):** the token layer and the text API's override path, every text route on `withToken`, batch undo of overrides. After it, a second team's token reads and writes text.

This plan alone leaves the text API as 5a left it (a second team's token gets 403 on the text routes). Both keep every single-team language as it is.

## Decisions

- **`text` alone writes the original text, in every language. Overrides are team data and stay under `regenerate`, in every team** *(user)*. Current teams see no change in who may write what: the original is still written only under `text`, through `withTextTeam`, as the privileged team. A team's overrides are written by whoever holds `regenerate` in it.
- **A second team inherits the original text and never inherits takes or overrides** *(user)*. Nothing in this plan copies a `text_override` row between teams; `copy_team_settings` (0113) is not touched.
- **Places, readables and bosses get a new table, `text_override`, keyed `(teamId, lang, source, lineId)`; quests keep `line_override`** *(My call)*. `line_override`'s key is `(teamId, lang, file)`, and a places file (`1411/razor-hill`) and a bosses file (`36/edwin-vancleef`) can be the same string, so the three sections cannot share it without a `source` in the key. Re-keying it is not additive: the previous release's `on conflict ("teamId", "lang", "file")` needs that exact unique index. In these three sections one line is one file, so the line id, which is frozen and what the text API and the catalogues address, is the key. A quest override stays file-keyed, because one quest file is spoken by many lines.
- **An override replaces the spoken text only; the shown text stays the original** *(My call, as quests)*. `regenerateNarrated`'s `shown` (word times) is the original, as `regenerate.ts` passes the original `line.text` as `shownText` for a quest override. The pack export (`places-lore-export`, `Books.lua`) is distribution and does not read overrides.
- **A place override covers the prose (`full`); `short` and names have no override** *(user)*. `short` is never voiced, and no section voices a place or boss name. A readable's first page is spoken with its owner's name as title (`spokenWithTitle`); an override replaces the page's text, and the spoken title keeps the original name. Name overrides are out of 5b.
- **An override needs original text to stand on** *(My call, as the quest route)*. A line with no text in the language (`missing.text`, a boss with no story, an untranslated page) refuses an override: 409 `` `this line has no ${lang} text yet` `` on the site, `invalid` in the text API.
- **"Original changed since your override" for every section** *(spec)*. `text_override.originalHash` is `spokenHash(original)` (`lib/generation/spoken-hash.ts`) at save, the same function quests use; `hasDrifted` compares it with the current original. Keeping the override saves the same text again and marks the new original as seen.
- **The site's override length limit is 5000 characters for places, readables and bosses; quests keep `MAX_OVERRIDE_LENGTH` (2000)** *(My call)*: lore and pages are longer than any quest line, and 5000 is the text API's `MAX_TEXT`, which 5b2 uses too.
- **The Explorer's override control appears everywhere, for every `regenerate` holder** *(user)*. Places, bosses and readables already have a pencil that writes the original under `text`. The override control is a second button ("Change what your team says"), gated on `regenerate` as the quest pencil is, in every language, single-team ones included. Someone holding both sees both.

## Global Constraints

- One migration, `0117_text_override.sql`: plain SQL, additive, one transaction, applied by `deploy/web/bin/migrate.sh`. 5a's release must run against it (it never reads `text_override`, and the replaced `move_team_lang` only moves one more table).
- Tests run as `spoken_app` (vitest's default `DATABASE_ROLE`) on `spoken_ci_pin`, never `spoken_dev`. Fish: `set -x DATABASE_URL postgres://localhost/spoken_ci_pin; pnpm --dir apps/web vitest run <file>`. Migrate: `set -x DATABASE_URL postgres://localhost/spoken_ci_pin; deploy/web/bin/migrate.sh $PWD/apps/web`.
- Fixtures: `uniqueLang`, `newTeamIn`, `addMember`, `testUser`, `asSystem`, `dropTeam`, `dropLang` from `src/lib/teams/testing.ts`; the section rows from `createFixtures` in `src/lib/text-api/testing.ts`. A second team is `newTeamIn(lang, false)`. Never a built-in language code for a second team.
- Nothing spends TTS credits. No test queues a job it does not cancel; generation is not run.
- Known failures to ignore when running wider suites: `admin.test` handOver, the three `search` tests, `missing-audio`, `voices/slots`.
- Every per-team query goes through `withTeam` / `queryAs` / `readAs` (`lib/db.ts`, `lib/teams/store.ts`). `text_override` has a `teamId` column, so it is under row-level security (`rls.test.ts` binds them).
- Exact copy:
  - Untranslated: `` `this line has no ${lang} text yet` `` (409 on the site).
- Browser checks run on `spoken_dev` in the Paseo tab already open, never a new tab.
- Site changes add no changelog notes (AGENTS.md).

## Review Focus

1. **A single-team language changes.** With no `text_override` row, each overlaid catalogue returns entries equal (`toEqual`) to its base, so `spoken`, `hash`, staleness and the queue are as before. Tested in Tasks 3 and 4.
2. **A translated catalogue inherits English's overrides.** `buildTranslated` (places) spreads each English entry; if it read the overlaid English catalogue, the English team's `override`, `spoken` and `hash` would ride into every language. Expected: translations are built from the English base. Tested in Task 3.
3. **A second team's override reaches the privileged team.** Expected: a member of the privileged team sees the original `spoken`, `hash` and no `override` on a line the second team overrode, and the line's take state is computed against the original. Tested in Task 3.
4. **An override on a line with no text in the language.** Expected: the site route refuses it with 409 and the untranslated message; a row written anyway (through `asSystem`) is ignored and the line stays unvoiceable. Tested in Tasks 3 and 5.
5. **An override on a minted readable page that is later absorbed.** Expected: `absorb` moves it to the real page's line id; where the real page already has an override in that team and language, the real page's stays and the minted one's is deleted. Tested in Task 4.

---

### Task 1: Migration 0117, the `text_override` table

**Files:**
- Create: `apps/web/migrations/0117_text_override.sql`
- Modify: `apps/web/src/lib/teams/testing.ts` (`STAMPED` and `dropTeam` delete `text_override` rows first)
- Test: `apps/web/src/lib/text-overrides/schema.test.ts`

**Interfaces:**
- Produces:
  - Table `text_override`: `"teamId" uuid not null default spoken_team() references "team" ("id")`, `"lang" text not null`, `"source" text not null check ("source" in ('places', 'readables', 'bosses'))`, `"lineId" text not null`, `"text" text not null`, `"originalHash" text`, `"spokenHash" text`, `"updatedAt" timestamptz not null default now()`, `"updatedBy" text references "user" ("id") on delete set null`, primary key `("teamId", "lang", "source", "lineId")`.
  - `enable` and `force row level security`, and policy `"team_isolation"` with the same `using`/`with check` as 0090.
  - `create or replace function "move_team_lang"`: 0096's body with `'text_override'` added to the moved tables.
- The header comment says why quests stay in `line_override` (file-keyed, one file for many lines; its key cannot change under the previous release) and why this table is keyed by line id.

- [ ] **Step 1: Write the failing tests** in `schema.test.ts` (fixture: `uniqueLang`, privileged team A, second team B):
  - Inserting a row through `withTeam(A, …)` and reading through `withTeam(B, …)` returns nothing; reading through `withTeam(A, …)` returns it.
  - Inserting through `withTeam(B, …)` a row whose `teamId` is A fails (policy `with check`).
  - A row with `source = 'quests'` fails the check.
  - `move_team_lang(lang, C)` with an A row moves it to C.
- [ ] **Step 2: Run it.** `set -x DATABASE_URL postgres://localhost/spoken_ci_pin; pnpm --dir apps/web vitest run src/lib/text-overrides/schema.test.ts`. Expected: FAIL, relation does not exist.
- [ ] **Step 3: Write the migration** and the `testing.ts` cleanup.
- [ ] **Step 4: Migrate, then run it, `src/lib/teams/rls.test.ts` and `src/lib/teams/move.test.ts`.** Expected: PASS.
- [ ] **Step 5: Commit.** `feat(teams): a text_override table for places, readables and bosses`

### Task 2: The override store

**Files:**
- Create: `apps/web/src/lib/text-overrides/store.ts`, `apps/web/src/lib/text-overrides/types.ts` (browser-safe)
- Modify: `apps/web/src/lib/quests/override-drift.ts` (generalise `hasDrifted`), `apps/web/src/lib/activity/kinds.ts` (`override.set` and `override.cleared` gain `& ApiAuditDetail`)
- Test: `apps/web/src/lib/text-overrides/store.test.ts`

**Interfaces:**
- Consumes: Task 1's table; `memoByTeamLang` (`lib/memo.ts`), `readAs`, `queryAs` (`lib/teams/store.ts`), `spokenHash`, `recordActivity`, `auditDetail`.
- Produces, in `types.ts`:
  - `type NarratedSource = "places" | "readables" | "bosses"`.
  - `type TextOverride = { lineId: string; text: string; updatedAt: string; updatedBy: string | null; originalHash: string | null }`.
  - `type OverrideView = { text: string; drifted: boolean; updatedAt: string; updatedBy: string | null }`, what a catalogue entry carries.
- Produces, in `store.ts` (every read and write as the acting team, through `readAs`/`queryAs`):
  - `overrideStamp(source: NarratedSource, lang: Lang): Promise<string>`: `count(*)`, `max("updatedAt")`, `sum(hashtext("lineId"))` and `sum(hashtext(coalesce("originalHash", '')))` of the team's rows, so a delete, an absorbed readable's moved id and a Keep each move it; `"-"` when the language has no team.
  - `readTextOverrides(source, lang): Promise<Map<string, TextOverride>>`, keyed by line id, memoised with `memoByTeamLang` behind `overrideStamp`.
  - `writeTextOverride(args: { source; lang; lineId; text; original: string; userId: string | null; audit?: ApiAudit }): Promise<{ override: TextOverride; wrote: boolean }>`: upsert on the primary key with `originalHash = spokenHash(original)` and `spokenHash` the `hash` the source's catalogue overlay gives the line speaking `text` (`overrideSpokenHash`, the overlay's own function, so a take of the override carries exactly it); `updatedAt` and `updatedBy` move only when the text does, so a Keep refreshes the two hashes alone; `before` read in the same statement as `writeOverride` does; `override.set` `{ text, before, ...auditDetail(audit, null) }` with `source`, `subject` and `lineId` the line id, only when `before !== text`; `wrote` is `before !== text`. Calls `forgetTextOverrides()`.
  - `clearTextOverride(args: { source; lang; lineId; by: string | null; audit?: ApiAudit }): Promise<boolean>`: deletes, logs `override.cleared` `{ before, ...auditDetail(audit, null) }`, so a batch undo finds removals by `apiBatchId` too.
  - `forgetTextOverrides(): void`, for the same-timestamp reason `forgetOverrides` gives.
  - `viewOf(override: TextOverride | undefined, original: string): OverrideView | undefined`.
- `hasDrifted(override: { originalHash?: string | null } | undefined, originalText: string): boolean`: same rule, wider parameter type; quests callers unchanged.

- [ ] **Step 1: Write the failing tests** in `store.test.ts` (A privileged, B second, U in B with `regenerate`, V in A):
  - Inside `asActor(U, …)`, `writeTextOverride({source: "places", lang, lineId: "z:1", text: "New.", original: "Old.", userId: U})` returns `wrote: true`; `readTextOverrides("places", lang)` inside `asActor(U, …)` has it, inside `asActor(V, …)` is empty.
  - Writing the same text again returns `wrote: false` and logs no second `override.set`.
  - The `override.set` row has `teamId` B, `source` `places`, `subject` `z:1`; with `audit: {tokenId: "t", batchId: "b"}` its detail has `apiBatchId: "b"`.
  - `viewOf(o, "Old.").drifted` is false and `viewOf(o, "Older.").drifted` is true; a row with null `originalHash` never drifts.
  - `clearTextOverride` returns true, then false; the second logs nothing.
- [ ] **Step 2: Run it.** `set -x DATABASE_URL postgres://localhost/spoken_ci_pin; pnpm --dir apps/web vitest run src/lib/text-overrides/store.test.ts`. Expected: FAIL, module not found.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run it, `src/lib/quests` and `pnpm --dir apps/web typecheck`.** Expected: PASS.
- [ ] **Step 5: Commit.** `feat(teams): a store for place, readable and boss overrides`

### Task 3: Places and bosses catalogues overlay the acting team's overrides

**Files:**
- Modify: `apps/web/src/lib/places/catalogue.ts`, `apps/web/src/lib/bosses/catalogue.ts`, `apps/web/src/lib/places/search.ts` and `apps/web/src/lib/bosses/search.ts` (carry `override` onto the result line)
- Test: `apps/web/src/lib/places/overlay.test.ts`, `apps/web/src/lib/bosses/overlay.test.ts`

**Interfaces:**
- Consumes: Task 2's `readTextOverrides`, `overrideStamp`, `viewOf`.
- Produces:
  - `CorpusEntry.override?: OverrideView` and `BossEntry.override?: OverrideView`.
  - Places: `baseCatalogue(lang: Lang): Promise<CatalogueEntry[]>`, today's `buildCorpus` behind `memoByLang(baseKey, lang, await stampOf(lang), …)`. `buildTranslated` reads `baseCatalogue(BASE_LANG)`, never `catalogue(BASE_LANG)` (Review Focus 2). `catalogue(lang)` is ``memoByTeamLang(catalogueKey, lang, `${stamp}|${overrideStamp}`, …)`` over the base, the two stamps read together: an entry with an override and original text gets `spoken = toSpokenText(override.text, rules)` (English rules for `enUS`, `{}` otherwise, as the base), `hash = textHash(spoken)` and `override`; `full`, `short` and `file` stay. An entry with `missing.text` ignores its override.
  - Bosses: the same split, `baseCatalogue(lang)` and `catalogue(lang)`; an entry whose `text` is null ignores its override.
  - `ResultLine.override: OverrideView | null` in both searches.
  - `catalogueStamp` keeps meaning the shared text's stamp.
- The base reads only shared tables (`lore_line`, `entity_name`, `boss*`), which is why it is memoised per language; confirm no per-team read is in it before moving it off `memoByTeamLang`.

- [ ] **Step 1: Write the failing tests.**
  - `places/overlay.test.ts` (fixture: `createFixtures` place line translated into a `uniqueLang`; A privileged, B second, U in B, V in A; an override of the zone line written in B through `asSystem`):
    - Inside `asActor(V, …)`, `catalogue(lang)` deep-equals `baseCatalogue(lang)` (Review Focus 1).
    - Inside `asActor(U, …)`, the zone entry's `spoken` is the override's, its `hash` differs from the base's, `full` is the original and `override.text` is the override.
    - A live take in B whose `spokenHash` is the base hash reads as `stale` in `search` inside `asActor(U, …)` and `current` inside `asActor(V, …)` for A's take of the same hash.
    - An override of the same line written in the English team leaves the translated entry's `spoken` and `override` untouched (Review Focus 2).
    - An override on a line the language has not translated leaves `spoken` empty (Review Focus 4).
    - Inside `asActor(V, …)`, the line B overrode has the base's `spoken` and `hash` and no `override` (Review Focus 3).
  - `bosses/overlay.test.ts`: the same two-team case for a boss story; a boss with no story ignores an override.
- [ ] **Step 2: Run them.** `set -x DATABASE_URL postgres://localhost/spoken_ci_pin; pnpm --dir apps/web vitest run src/lib/places/overlay.test.ts src/lib/bosses/overlay.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run them, `src/lib/places`, `src/lib/bosses`, `src/lib/generation/batch-plan.test.ts` and `src/lib/teams/memo-scope.test.ts`.** Expected: PASS.
- [ ] **Step 5: Commit.** `feat(teams): places and bosses speak the acting team's overrides`

### Task 4: The readables catalogue overlays overrides; absorb moves them

**Files:**
- Modify: `apps/web/src/lib/readables/catalogue.ts`, `apps/web/src/lib/readables/search.ts`, `pipelines/readables/tools/lib/absorb.mjs`
- Test: `apps/web/src/lib/readables/overlay.test.ts`, `apps/web/src/lib/readables/absorb.test.ts`

**Interfaces:**
- Consumes: Task 2's store.
- Produces:
  - `BookPage.override?: OverrideView`; `baseCatalogue(lang)` and `catalogue(lang)` split as in Task 3. A translated page with an override gets `voiced(override.text, lang, spokenTitle(pageNumber, title))`'s `spoken`, `hash`, `generatable` and `skipReason`; `text` stays the original. A page with `missing.text` ignores its override.
  - `ResultLine.override: OverrideView | null` in `readables/search.ts`.
  - `absorb(client, { from, to })` also moves `text_override` rows with `source = 'readables'` from `from` to `to`, deleting first any minted row whose `(teamId, lang)` already has a row for `to`.

- [ ] **Step 1: Write the failing tests.**
  - `overlay.test.ts`: the two-team case of Task 3 for a first page (its title is still spoken: `spoken` starts with the title) and for a second page; no override deep-equals the base; an override holding only markup that `isGeneratable` refuses leaves the page `generatable: false`.
  - `absorb.test.ts`: a minted page with a B override is absorbed into a real page with none: the override's `lineId` is the real page's. A minted page with a B override absorbed into a real page that has its own B override: the real page's text stays and the minted row is gone (Review Focus 5).
- [ ] **Step 2: Run them.** `set -x DATABASE_URL postgres://localhost/spoken_ci_pin; pnpm --dir apps/web vitest run src/lib/readables/overlay.test.ts src/lib/readables/absorb.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run them and `src/lib/readables`.** Expected: PASS.
- [ ] **Step 5: Commit.** `feat(teams): readables speak the acting team's overrides, and absorb keeps them`

### Task 5: The site route for overrides

**Files:**
- Create: `apps/web/src/app/api/text-overrides/route.ts`, `apps/web/src/lib/text-overrides/client.ts`
- Test: `apps/web/src/app/api/text-overrides/route.test.ts`

**Interfaces:**
- Consumes: Task 2's store; Tasks 3 and 4's `catalogue` (to find the line and its original).
- Produces:
  - `PUT /api/text-overrides?lang=xx&source=places|readables|bosses`, body `{ lineId: string; text: string }`; `requireIn(request, "regenerate")`. `source` not one of the three: 400. Text trimmed; empty is 400 `"text cannot be empty - remove the override instead"`; over 5000 characters 400. Line not in `catalogue(lang)`: 404 `"unknown line"`. No original text: 409 with the untranslated message. Writes with `original` = the entry's original (`full` / `text`), answers `{ override: OverrideView }`.
  - `DELETE` same query plus `&lineId=`: 404 for an unknown line, else `{ removed: boolean }`.
  - `client.ts`: `saveTextOverride(lang, source, lineId, text): Promise<Response>` and `dropTextOverride(lang, source, lineId): Promise<Response>`, as `override-client.ts`.

- [ ] **Step 1: Write the failing tests** in `route.test.ts` (session mocked as in `src/app/api/quests/lines/override/route.test.ts`; two-team fixture):
  - As U (B, `regenerate`): PUT on a place line answers 200, and the row is in B.
  - As a session with `text` but no `regenerate`: 403, nothing written.
  - PUT on an untranslated line: 409 with the exact message.
  - `source=quests`: 400. Unknown line: 404.
  - DELETE twice: `{removed: true}` then `{removed: false}`.
- [ ] **Step 2: Run it.** `set -x DATABASE_URL postgres://localhost/spoken_ci_pin; pnpm --dir apps/web vitest run src/app/api/text-overrides`. Expected: FAIL, module not found.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run it.** Expected: PASS.
- [ ] **Step 5: Commit.** `feat(teams): override a place, readable or boss line from the site`

### Task 6: The Explorer's override control and drift mark

**Files:**
- Create: `apps/web/src/components/TextOverrideDialog.tsx`, `apps/web/src/components/TextOverrideDrift.tsx`
- Modify: `docs/platform/TEAMS.md`, `docs/platform/SELF-SERVE-TEAMS.md`, `docs/places/README.md`, `docs/readables/README.md`, `docs/bosses/README.md`, `apps/web/src/components/places/Explorer.tsx`, `apps/web/src/components/places/LineRow.tsx` (places and bosses), `apps/web/src/components/readables/Explorer.tsx`, `apps/web/src/components/readables/PageRow.tsx`, `apps/web/src/components/readables/BookList.tsx`
- Test: `apps/web/src/components/TextOverrideDialog.test.tsx`, `apps/web/src/components/places/LineRow.test.tsx`

**Interfaces:**
- Consumes: Task 5's `client.ts`; `ResultLine.override` from Tasks 3 and 4.
- Produces:
  - `TextOverrideDialog({ source, line: { lineId: string; original: string; override: string | null } | null, onSaved(lineId: string, text: string | null), onCancel })`: shows the original beside a draft seeded from the override or the original; Save PUTs, Remove (shown only when an override exists) DELETEs; the route's error is shown in the dialog.
  - `TextOverrideDrift({ source, lineId, text, onAnswered })`: "The original changed since your override." with Keep (save the same text) and Drop, as `OverrideDrift`.
  - A row button, title "Change what your team says", `aria-label` `` `Override the text of ${name}` ``, shown when `canRegenerate` and the line has original text, in every language *(user)*; beside the existing pencil, which keeps its `canEdit` gate. A row with an override shows the override as its spoken line under the original, and `TextOverrideDrift` when `override.drifted`.

- [ ] **Step 1: Write the failing tests.**
  - `TextOverrideDialog.test.tsx` (fetch mocked): saving PUTs `{lineId, text}` to `/api/text-overrides?lang=…&source=bosses` and calls `onSaved`; a 409 shows its message; Remove is absent without an override.
  - `LineRow.test.tsx`: with `canRegenerate` and no `canEdit`, the override button shows and the pencil does not; with `canEdit` only, the reverse; a line with `override.drifted` shows the drift mark.
- [ ] **Step 2: Run them.** `pnpm --dir apps/web vitest run src/components/TextOverrideDialog.test.tsx src/components/places/LineRow.test.tsx`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run them and `src/components`, then `pnpm --dir apps/web typecheck`.** Expected: PASS. In the Paseo tab on `spoken_dev`, as a member with `regenerate` in a second team, override one place line and one readable page, see the row read stale, and see the line unchanged as the privileged team's member.
- [ ] **Step 5: Write the doc edits.**
  - `TEAMS.md` *Text*: "Overrides for places, readables and bosses wait for *Phase 2*" becomes: a team's override of a place's prose, a readable page or a boss story, written by whoever holds `regenerate`, kept per line id; shown text and names stay the original, and a readable's spoken title keeps the original name *(user)*. *Phase 2 → Text layer* says it is built for the site.
  - `SELF-SERVE-TEAMS.md`: the status line names 5b.
  - `docs/places/README.md` (or `LORE.md`, wherever the Explorer's pencil is described), `docs/readables/README.md`, `docs/bosses/README.md`: what the override control does and that it needs `regenerate`.
- [ ] **Step 6: Run everything.** `set -x DATABASE_URL postgres://localhost/spoken_ci_pin; pnpm --dir apps/web test`, then `make lint`. Expected: PASS apart from the known failures.
- [ ] **Step 7: Commit.** `feat(teams): an override control in the places, bosses and readables explorers`
