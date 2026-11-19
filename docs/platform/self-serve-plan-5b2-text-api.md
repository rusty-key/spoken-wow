# Self-serve plan 5b2: the text API's override layer

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A token whose owner holds `regenerate` reads the original text with its team's overrides and writes those overrides, in every section. A token whose owner holds `text` writes the original, as today, or its team's overrides on request. Every `/api/v1` text route works for a second team, and undoing a batch restores overrides in the team that wrote them.

**Architecture:** The text API gains a layer. A write goes to the original (under `text`, through `withTextTeam`, as now) or to the token owner's team's overrides (under `regenerate`, inside `asActor` through `withToken`): `line_override` for quests, 5b's `text_override` for places, readables and bosses. `backedScopes` backs a token's text access with either grant and reports which layers it may write; `writeLayer` resolves a request's layer before anything is written. Reads list each item's override from the overlaid catalogues 5b built, which `asActor` points at the owner's team.

**Tech Stack:** node-postgres, Next.js App Router (`apps/web`), Vitest. No migration.

**Spec:** [`SELF-SERVE-TEAMS.md`](SELF-SERVE-TEAMS.md), *Second team in a language* (Tokens), *Calls made without the user* (Tokens that generate); [`TEAMS.md`](TEAMS.md), *Roles*, *Text: original and overrides*. Builds on [plan 5b](self-serve-plan-5b-text-layer.md) (the override store and catalogue overlays), [plan 5a](self-serve-plan-5-second-team.md) (`withToken`, `asActor`, `asTeam`) and [plan 4](self-serve-plan-4-api.md) (the text API).

## Decisions

- **`text` alone writes the original text, in every language. Overrides are team data and stay under `regenerate`, in every team** *(user)*. Current tokens see no change in what they write: the original is still written only under `text`, through `withTextTeam`, as the privileged team.
- **Text maintainers are independent of team membership** *(user)*. A maintainer in a second team writes the original through the text API by default, as the privileged team (`withTextTeam`), and their team's overrides with `"layer": "override"` when they also hold `regenerate`.
- **The token layer** *(My call, set by the controller)*. A token whose owner holds both `text` and `regenerate` writes the original by default, which is today's behaviour, so current tokens do not change. A request may pass `"layer": "override"` to write the owner's team's override instead. An owner without `text` always writes the override. `"layer": "original"` from an owner without `text` is refused with 403. Each item's result says which layer it wrote.
- **A layer is chosen per request, not per item** *(My call)*. `layer` is a top-level body field of `PATCH /api/v1/{section}` and `PATCH /api/v1/{section}/{id}`. One run writes one layer, so one batch undoes one layer.
- **A token reads with `text` or `regenerate`** *(spec, 5a decision)*. `backedScopes` backs a token's text access (`read`/`write`) when its owner holds either. This also lets a `regenerate`-only person in a single-team language make a text token for the first time; it widens nothing they could not already do on the site.
- **Names have no override** *(user)*. A `name` sent with the override layer is `invalid`, and so is `short`, which is never voiced. A readable's spoken title keeps the original name.
- **An override write needs original text to stand on** *(My call, as 5b's site route)*: a line with no text in the language is `invalid` with the untranslated message.
- **`expectedVersion` on an override write guards the original** *(My call)*. An override has no versions. `expectedVersion`, when sent, must equal the original's current version, else `conflict`: the caller is told the original moved under the line they rewrote. The result's `version` is the original's.
- **An override is removed with `"text": null`** *(My call)*: only with the override layer; the field result's status is `"removed"`, or `"unchanged"` when there was none.
- **The override length limit is `MAX_TEXT` (5000) for places, readables and bosses; quests keep `MAX_OVERRIDE_LENGTH` (2000)** *(My call, as 5b)*.
- **Every `/api/v1` text route goes through `withToken`** *(5a decision)*: the section list and item routes, batches, restore, and the lexicon routes (the lexicon is per team; 5a refused them to a second team). `requireToken` stays, with no caller left in `/api/v1`, so a route added later without opting in still fails closed.
- **Batch undo restores an override in the team that wrote it** *(My call)*. `editsOf` returns each activity row's `teamId`, and an override edit is undone inside `asTeam(lang, teamId)`, so a site owner undoing a second team's batch writes into that team, not the privileged one.

## Global Constraints

- No migration. 5b's release runs against the same schema.
- Tests run as `spoken_app` (vitest's default `DATABASE_ROLE`) on `spoken_ci_pin`, never `spoken_dev`. Fish: `set -x DATABASE_URL postgres://localhost/spoken_ci_pin; pnpm --dir apps/web vitest run <file>`.
- Fixtures: `uniqueLang`, `newTeamIn`, `addMember`, `testUser`, `asSystem`, `dropTeam`, `dropLang` from `src/lib/teams/testing.ts`; the section rows from `createFixtures` in `src/lib/text-api/testing.ts`; tokens from `createToken` (`src/lib/tokens/store.ts`). A second team is `newTeamIn(lang, false)`. Never a built-in language code for a second team.
- Nothing spends TTS credits. No test queues a job it does not cancel; generation is not run.
- Known failures to ignore when running wider suites: `admin.test` handOver, the three `search` tests, `missing-audio`, `voices/slots`.
- Every per-team query goes through `withTeam` / `queryAs` / `readAs` (`lib/db.ts`, `lib/teams/store.ts`).
- Exact copy:
  - Untranslated: `` `this line has no ${lang} text yet` ``.
  - No grant: `` `this token's owner holds neither text nor regenerate in ${lang}` `` (403).
  - Layer refused: `` `this token's owner is not a text maintainer in ${lang}, so it writes only its team's overrides` `` (403); `` `this token's owner does not hold regenerate in ${lang}, so it cannot write overrides` `` (403); `layer must be "original" or "override"` (400).
  - Override field refusals: `"short is original text; send it without a layer or with \"layer\": \"original\""`, `"a name is original text; send it without a layer or with \"layer\": \"original\""`, `"an override cannot split a line by the reader's gender; that changes the original text"`.
  - Original moved: `` `the original text is at version ${current}, not ${expected}` `` (conflict).
- Browser checks run on `spoken_dev` in the Paseo tab already open, never a new tab.
- Site changes add no changelog notes (AGENTS.md).

## Review Focus

1. **A second team's token writes the original.** `"layer": "original"` without `text` is 403 and nothing changes; a `regenerate`-only owner's write with no layer lands in their team's override; a both-holder's write with no layer still writes the original. Tested in Task 2.
2. **A site owner undoes a second team's override batch.** Expected: the override is restored in the second team, and the privileged team gains no row. Tested in Task 3.
3. **Current tokens change.** A token whose owner holds `text`, sending no `layer`, writes and reads exactly as before, and its results only gain `layer: "original"`. Tested in Tasks 1 and 2.
4. **A token read lists another team's overrides.** Expected: a GET lists only the owner's team's overrides; a privileged team's token lists none of the second team's. Tested in Task 2.
5. **A quest override through the API lands on another file than the site's.** Expected: `(id, variant)` resolves to the file the Explorer's pencil writes (`audioRelPath` of the language's row, else English's), so the site and the API edit one override. Tested in Task 2.

---

### Task 1: Tokens read and write under `text` or `regenerate`

**Files:**
- Modify: `apps/web/src/lib/text-api/guard.ts`, `apps/web/src/app/api/profile/tokens/route.ts`, `apps/web/src/components/ApiTokenSection.tsx`, `apps/web/src/app/[lang]/profile/page.tsx` (builds `TokenLang[]`)
- Test: `apps/web/src/lib/text-api/guard.test.ts`, `apps/web/src/app/api/profile/tokens/route.test.ts`

**Interfaces:**
- Produces:
  - `type Layer = "original" | "override"`.
  - `backedScopes(viewer, lang, access, generate): { text: boolean; generate: boolean; layers: { original: boolean; override: boolean } }`: `layers.original = can(viewer, "text", lang)`, `layers.override = can(viewer, "regenerate", lang)`, `text = access !== "none" && (layers.original || layers.override)`.
  - `TokenContext.layers: { original: boolean; override: boolean }`, both false when the token has no text access.
  - `writeLayer(context: TokenContext, requested: unknown): Layer | Response`: `undefined` gives `"original"` when `layers.original`, else `"override"`; `"original"` without `layers.original` and `"override"` without `layers.override` are 403 with the exact messages; anything else 400. The `noText` refusal uses the "No grant" message.
  - The token form offers Read and Read and write in a language where the person holds `text` or `regenerate` (`TokenLang.text` means that now), and its explanation says a token without the text grant writes only its team's overrides.

- [ ] **Step 1: Write the failing tests.**
  - `guard.test.ts`: an owner with `regenerate` only and a read token passes `need: "read"` with `layers {original: false, override: true}`; with neither grant, 403 with the "No grant" message; `writeLayer` for that context: `undefined` → `"override"`, `"original"` → 403 with the exact message, `"both"` → 400. For a both-holder, `undefined` → `"original"`; for a `text`-only holder, `"override"` → 403 (Review Focus 3).
  - `profile/tokens/route.test.ts`: a `regenerate`-only user may create a `write` token; a user with neither gets 403.
- [ ] **Step 2: Run them.** `set -x DATABASE_URL postgres://localhost/spoken_ci_pin; pnpm --dir apps/web vitest run src/lib/text-api/guard.test.ts src/app/api/profile/tokens`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run them and `src/app/api/v1`.** Expected: PASS.
- [ ] **Step 5: Commit.** `feat(api): a token reads and writes text under text or regenerate`

### Task 2: The override layer; every text route on `withToken`

**Files:**
- Modify: `apps/web/src/lib/text-api/types.ts`, `apps/web/src/lib/text-api/apply.ts`, `apps/web/src/lib/text-api/places.ts`, `bosses.ts`, `readables.ts`, `quests.ts`, `apps/web/src/lib/quests/overrides.ts` (`audit`), `apps/web/src/app/api/v1/[section]/route.ts`, `apps/web/src/app/api/v1/[section]/[id]/route.ts`, `apps/web/src/app/api/v1/batches/route.ts`, `apps/web/src/app/api/v1/batches/[batchId]/restore/route.ts`, `apps/web/src/app/api/v1/lexicon/route.ts`, `apps/web/src/app/api/v1/lexicon/[grapheme]/route.ts`, `apps/web/src/app/api/v1/route.ts` (endpoint text and notes)
- Test: `apps/web/src/lib/text-api/override-layer.test.ts`, `apps/web/src/app/api/v1/[section]/patch.test.ts`

**Interfaces:**
- Consumes: Task 1's `writeLayer`, `TokenContext.layers`; 5b's `writeTextOverride`, `clearTextOverride` (`lib/text-overrides/store.ts`, both taking `audit?: ApiAudit`) and the overlaid `catalogue(lang)` of each section, whose entries carry `override?: OverrideView`; quests' `writeOverride`, `clearOverride`, `validateOverride`.
- Produces:
  - `TextItem.override?: string | null` for every section (no longer "quests only"): places, bosses and readables from the overlaid entry's `override?.text ?? null`.
  - `SectionApi.saveOverride(args: { lang; id; variant; text: string | null; by: string; expectedVersion: number | null; audit: ApiAudit }): Promise<{ version: number | null; lines: string[]; wrote: boolean; removed: boolean }>`:
    - all sections: `expectedVersion` not null and not the original's current `version(lang, id, variant)` throws a conflict with the exact message;
    - places, bosses, readables: the item's original from `catalogue(lang)`; none throws `Refused` with the untranslated message; `text` null clears, else `writeTextOverride`;
    - quests: `questFileOf(lang, id, variant): Promise<string | null>` (the language's current row's `fileName`, else English's, through `audioRelPath`); `validateOverride` (its `OverrideError` becomes `Refused`; `$G` gives the exact gender message); an untranslated line refuses; `text` null calls `clearOverride`, else `writeOverride` with `audit`.
  - `writeOverride` and `clearOverride` (`lib/quests/overrides.ts`) take an optional `audit?: ApiAudit`, put in the activity detail.
  - `applyItems(section, context, items, note, layer: Layer)` and `applyItem(…, layer)`. With `"override"`: `short` or `name` is `invalid` with the exact messages; `text` may be null. `FieldResult` success gains `layer: Layer` and the status `"removed"`.
  - PATCH routes read `body.layer` through `writeLayer` before anything is written; a single-item PATCH reads it from the body, not the URL.
  - Every route above goes through `withToken`; the `[section]` and `[id]` GETs run in `asActor`, so `override` is the owner's team's.
  - `/api/v1`'s note on overrides becomes: "Every item's override, when not null, is what the token owner's team speaks in place of its text. Writes go to the original text when the owner is a text maintainer, else to the team's overrides; send \"layer\": \"override\" to write the override as a text maintainer. Each text result names its layer."

- [ ] **Step 1: Write the failing tests.**
  - `override-layer.test.ts` (`createFixtures` in a `uniqueLang`; A privileged, B second; U in B with `regenerate`; M with `text` and `regenerate` in A; contexts built as `withToken` builds them):
    - As U, `applyItems("places", ctx(U), [{id: zone, text: "Ours."}], null, "override")`: result `{status: "updated", layer: "override"}`; `lore_line` unchanged; B holds the row; A does not.
    - As U, `{id: zone, short: "x"}` is `invalid` with the exact message; `{id: quest, variant, text: "Well met, $Glad:lass;."}` is `invalid` with the gender message.
    - As U, `{id: boss, text: null}` after a write: `removed`.
    - As U with `expectedVersion` one below the original's: `conflict` with the exact message.
    - As M with `"original"`: the original moves, as today, and `layer` is `"original"` (Review Focus 3).
    - As U, a quest override's `line_override` row has the `file` that `/api/quests/lines/override` writes for that line (Review Focus 5).
  - `patch.test.ts` (through the route): U's write token with no `layer` writes B's override; with `"layer": "original"` it answers 403 with the exact message and nothing changes (Review Focus 1); M's token with no `layer` writes the original; U's token GET of the place lists `override` from B, and a token of V (A) lists none (Review Focus 4).
- [ ] **Step 2: Run them.** `set -x DATABASE_URL postgres://localhost/spoken_ci_pin; pnpm --dir apps/web vitest run src/lib/text-api/override-layer.test.ts src/app/api/v1`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run them and `src/lib/text-api`.** Expected: PASS, the existing section tests unchanged.
- [ ] **Step 5: Commit.** `feat(api): a token writes its team's overrides, and every text route works for a second team`

### Task 3: A batch undo restores overrides in their team

**Files:**
- Modify: `apps/web/src/lib/text-api/batches.ts`, `apps/web/src/app/api/v1/batches/[batchId]/restore/route.ts`
- Test: `apps/web/src/lib/text-api/batches.test.ts`

**Interfaces:**
- Consumes: Task 2's `saveOverride`, and the `override.*` activity carrying `apiBatchId`; 5a's `asTeam` (`lib/teams/acting.ts`).
- Produces:
  - `editsOf` also selects `override.set` and `override.cleared`, and each `Edit` carries `teamId: TeamId | null` and `source`.
  - An override edit is undone inside `asTeam(batch.lang, edit.teamId, …)`: skipped `edited_since` when the team's current override text is not the edit's `text`; otherwise `before` is written back, or the override cleared when `before` is null; status `"restored"` or `"retired"`. `UndoResult.field` gains `"override"`.
  - The restore route checks layers per edit: an original edit needs `layers.original`, an override edit `layers.override` (a site owner holds both); a missing one is `skipped`, reason `"not_allowed"`.

- [ ] **Step 1: Write the failing tests** in `batches.test.ts`:
  - U writes two overrides in one batch, then restores it: the first line's override goes back to its earlier text, the second (new) is cleared.
  - A site owner restores U's batch: B's rows change and A gains none (Review Focus 2).
  - A line whose override was edited after the batch is `skipped`, `edited_since`.
- [ ] **Step 2: Run it.** `set -x DATABASE_URL postgres://localhost/spoken_ci_pin; pnpm --dir apps/web vitest run src/lib/text-api/batches.test.ts src/app/api/v1/batches`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run them.** Expected: PASS.
- [ ] **Step 5: Commit.** `feat(api): undoing a batch restores its overrides in the team that wrote them`

### Task 4: The docs

**Files:**
- Modify: `docs/contributors/TEXT-API.md`, `docs/platform/SELF-SERVE-TEAMS.md`, `docs/platform/TEAMS.md`

**Interfaces:**
- `TEXT-API.md`: `override` on every section; `layer` (values, default, refusals, the result's `layer`, `"text": null` to remove, `expectedVersion` guarding the original); the read rule (`text` or `regenerate`); names and `short` have no override; undo of overrides.
- `SELF-SERVE-TEAMS.md`: the status line names 5b2; *Tokens* drops "Until 5b, the text routes answer 403…" and states the layer rule *(My call, set by the controller)*.
- `TEAMS.md` *Roles → Text maintainers*: a maintainer's token writes the original by default and their team's overrides with `"layer": "override"`.

- [ ] **Step 1: Write the doc edits.**
- [ ] **Step 2: Run everything.** `set -x DATABASE_URL postgres://localhost/spoken_ci_pin; pnpm --dir apps/web test`, then `make lint`. Expected: PASS apart from the known failures. Then in the Paseo tab on `spoken_dev`: as a second team's member, create a write token in `/profile`, `PATCH /api/v1/bosses/{id}` with new text (layer `override` in the result), `GET` it back with the override, and undo the batch.
- [ ] **Step 3: Commit.** `docs(api): the text API's override layer`
